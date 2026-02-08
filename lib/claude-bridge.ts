import { spawn, type ChildProcess } from "child_process";
import { WebSocket } from "ws";

/**
 * Rich-mode bridge: spawns a long-lived `claude -p` process with
 * bidirectional stream-json I/O, relays events over WebSocket.
 *
 * The process stays alive across turns — prompts are written to stdin
 * as NDJSON, and events are read from stdout. This enables multi-turn
 * conversations within a single process, which is required for features
 * like AskUserQuestion (the CLI auto-denies it in per-turn mode, but
 * the user can answer and send a follow-up in the same session).
 *
 * Session state (event log, session ID) persists across WS reconnects
 * so page refreshes restore the full conversation.
 *
 * Protocol (client <-> server over WebSocket):
 *   Client -> Server:  { type: "prompt", text: string }
 *   Server -> Client:  { type: "event", event: object }
 *   Server -> Client:  { type: "turn_complete" }
 *   Server -> Client:  { type: "error", message: string }
 *   Server -> Client:  { type: "session_state", streaming: boolean }
 */

interface RichState {
  sessionId: string | null;
  events: object[];
  proc: ChildProcess | null;
  ws: WebSocket | null;
  turning: boolean;
  initReceived: boolean;
}

// Module-level state survives across WS connections
const sessions = new Map<string, RichState>();

function getOrCreate(name: string): RichState {
  let state = sessions.get(name);
  if (!state) {
    state = {
      sessionId: null,
      events: [],
      proc: null,
      ws: null,
      turning: false,
      initReceived: false,
    };
    sessions.set(name, state);
  }
  return state;
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Ensure a long-lived claude process exists for this session.
 * If the process died (crash, etc.), restart with --resume to
 * restore conversation context.
 */
function ensureProcess(state: RichState): ChildProcess {
  if (state.proc) return state.proc;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  // Resume previous conversation if process restarted
  if (state.sessionId) {
    args.push("--resume", state.sessionId);
  }

  const proc = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  state.proc = proc;
  let buffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);

        // Capture session_id from init events
        if (event.session_id && !state.sessionId) {
          state.sessionId = event.session_id;
        }

        // Skip subagent internal events
        if (event.parent_tool_use_id != null) continue;

        // Skip duplicate init events (one per turn, only show first)
        if (event.type === "system" && event.subtype === "init") {
          if (state.initReceived) continue;
          state.initReceived = true;
        }

        // Handle turn completion
        if (event.type === "result") {
          state.turning = false;
          state.events.push(event);
          if (state.ws) {
            send(state.ws, { type: "event", event });
            send(state.ws, { type: "turn_complete" });
          }
          continue;
        }

        // Don't persist ephemeral stream deltas
        if (event.type !== "stream_event") {
          state.events.push(event);
        }
        if (state.ws) send(state.ws, { type: "event", event });
      } catch {
        const raw = { type: "raw", text: trimmed };
        state.events.push(raw);
        if (state.ws) send(state.ws, { type: "event", event: raw });
      }
    }
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      const event = { type: "stderr", text };
      state.events.push(event);
      if (state.ws) send(state.ws, { type: "event", event });
    }
  });

  proc.on("close", (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        if (event.session_id && !state.sessionId) {
          state.sessionId = event.session_id;
        }
        state.events.push(event);
        if (state.ws) send(state.ws, { type: "event", event });
      } catch {}
    }
    buffer = "";
    state.proc = null;
    state.turning = false;
    state.initReceived = false; // Reset so next process gets its init shown
    // Don't send error for clean exits (code 0) — process may have been
    // intentionally stopped. Non-zero means unexpected crash.
    if (code !== 0 && code !== null && state.ws) {
      send(state.ws, { type: "error", message: `Process exited (code ${code})` });
    }
  });

  proc.on("error", (err) => {
    state.proc = null;
    state.turning = false;
    state.initReceived = false;
    if (state.ws) send(state.ws, { type: "error", message: err.message });
  });

  return proc;
}

export function bridgeRichSession(ws: WebSocket, sessionName: string): void {
  const state = getOrCreate(sessionName);

  // Disconnect previous client if any
  if (state.ws && state.ws !== ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }
  state.ws = ws;

  // Replay stored events
  for (const event of state.events) {
    send(ws, { type: "event", event });
  }

  // Tell client whether a turn is currently in progress
  send(ws, { type: "session_state", streaming: state.turning });

  // Handle incoming messages
  ws.on("message", (msg: Buffer | string) => {
    const str = msg.toString();
    let parsed: { type: string; text?: string };
    try {
      parsed = JSON.parse(str);
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (parsed.type === "interrupt") {
      if (state.proc && state.turning) {
        state.proc.kill("SIGINT");
      }
      return;
    }

    if (parsed.type === "prompt" && parsed.text) {
      if (state.turning) {
        send(ws, { type: "error", message: "A turn is already in progress" });
        return;
      }

      let proc: ChildProcess;
      try {
        proc = ensureProcess(state);
      } catch (e: any) {
        send(ws, { type: "error", message: `Failed to spawn claude: ${e.message}` });
        return;
      }

      state.turning = true;

      const userMsg = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: parsed.text }],
        },
      };

      proc.stdin!.write(JSON.stringify(userMsg) + "\n");
    }
  });

  const cleanup = () => {
    // Only clear the ws ref if it's still us
    if (state.ws === ws) {
      state.ws = null;
    }
    // Do NOT kill the claude process — it should finish its turn
    // and events will be stored for the next connection
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

/** Clean up all state for a rich session (called on session delete) */
export function cleanupRichSession(name: string): void {
  const state = sessions.get(name);
  if (!state) return;
  if (state.proc) {
    try {
      state.proc.stdin?.end();
      state.proc.kill();
    } catch {}
  }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }
  sessions.delete(name);
}

/** Check if a rich session has state (for alive status) */
export function richSessionExists(name: string): boolean {
  return sessions.has(name);
}
