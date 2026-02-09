import { spawn, type ChildProcess } from "child_process";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

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
 * Session state (event log, session ID) persists to SQLite across both
 * WS reconnects and server restarts, so conversations survive crashes.
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
  spawning: boolean;
  dirty: boolean; // true when events need to be flushed to DB
  command: string;
}

// --- SQLite persistence ---

const DB_PATH = join(process.cwd(), "data", "sessions.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS rich_sessions (
        name TEXT PRIMARY KEY,
        session_id TEXT,
        events TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);
  }
  return _db;
}

function loadState(name: string): { sessionId: string | null; events: object[] } | null {
  const db = getDb();
  const row = db.prepare("SELECT session_id, events FROM rich_sessions WHERE name = ?").get(name) as
    | { session_id: string | null; events: string }
    | undefined;
  if (!row) return null;
  try {
    return { sessionId: row.session_id, events: JSON.parse(row.events) };
  } catch {
    return { sessionId: row.session_id, events: [] };
  }
}

function saveState(name: string, sessionId: string | null, events: object[]): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO rich_sessions (name, session_id, events, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(name) DO UPDATE SET
      session_id = excluded.session_id,
      events = excluded.events,
      updated_at = excluded.updated_at
  `).run(name, sessionId, JSON.stringify(events));
}

function deleteState(name: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rich_sessions WHERE name = ?").run(name);
}

// --- In-memory state ---

// Module-level state survives across WS connections
const sessions = new Map<string, RichState>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced flush: batches rapid event writes into one DB write per 2s */
function schedulePersist(name: string, state: RichState): void {
  state.dirty = true;
  if (flushTimers.has(name)) return;
  flushTimers.set(
    name,
    setTimeout(() => {
      flushTimers.delete(name);
      if (state.dirty) {
        saveState(name, state.sessionId, state.events);
        state.dirty = false;
      }
    }, 2000),
  );
}

/** Immediately flush pending state to DB */
function flushPersist(name: string, state: RichState): void {
  const timer = flushTimers.get(name);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(name);
  }
  if (state.dirty) {
    saveState(name, state.sessionId, state.events);
    state.dirty = false;
  }
}

function getOrCreate(name: string, command = "claude"): RichState {
  let state = sessions.get(name);
  if (!state) {
    // Try to restore from DB first
    const saved = loadState(name);
    state = {
      sessionId: saved?.sessionId ?? null,
      events: saved?.events ?? [],
      proc: null,
      ws: null,
      turning: false,
      initReceived: false,
      spawning: false,
      dirty: false,
      command,
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
function ensureProcess(name: string, state: RichState): ChildProcess {
  if (state.proc) return state.proc;
  if (state.spawning) throw new Error("Process is already starting");
  state.spawning = true;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
  ];

  if (state.command.includes("--dangerously-skip-permissions")) {
    args.push("--dangerously-skip-permissions");
  }

  // Resume previous conversation if process restarted
  if (state.sessionId) {
    args.push("--resume", state.sessionId);
  }

  const proc = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  console.log(`[rich:${name}] Spawned claude process (pid=${proc.pid}), resume=${state.sessionId ?? "none"}`);
  state.proc = proc;
  state.spawning = false;
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
          schedulePersist(name, state);
          if (state.ws) {
            send(state.ws, { type: "event", event });
            send(state.ws, { type: "turn_complete" });
          }
          // Flush immediately at turn boundaries for reliability
          flushPersist(name, state);
          continue;
        }

        // Don't persist ephemeral stream deltas
        if (event.type !== "stream_event") {
          state.events.push(event);
          schedulePersist(name, state);
        }
        if (state.ws) send(state.ws, { type: "event", event });
      } catch {
        const raw = { type: "raw", text: trimmed };
        state.events.push(raw);
        schedulePersist(name, state);
        if (state.ws) send(state.ws, { type: "event", event: raw });
      }
    }
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      const event = { type: "stderr", text };
      state.events.push(event);
      schedulePersist(name, state);
      if (state.ws) send(state.ws, { type: "event", event });
    }
  });

  // Stream error handlers — without these, stream errors are unhandled and
  // can cause the process to silently stop delivering data.
  proc.stdout!.on("error", (err) => {
    console.error(`[rich:${name}] stdout error:`, err.message);
    if (state.ws) send(state.ws, { type: "error", message: `stdout error: ${err.message}` });
  });
  proc.stderr!.on("error", (err) => {
    console.error(`[rich:${name}] stderr error:`, err.message);
  });
  proc.stdin!.on("error", (err) => {
    // EPIPE is expected if the process exits before we finish writing — the
    // close handler will take care of notifying the client.
    if ((err as NodeJS.ErrnoException).code === "EPIPE") {
      console.warn(`[rich:${name}] stdin EPIPE (process likely exited)`);
    } else {
      console.error(`[rich:${name}] stdin error:`, err.message);
      if (state.ws) send(state.ws, { type: "error", message: `stdin error: ${err.message}` });
    }
  });

  proc.on("close", (code, signal) => {
    const wasTurning = state.turning;
    const pid = proc.pid;

    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        if (event.session_id && !state.sessionId) {
          state.sessionId = event.session_id;
        }
        state.events.push(event);
        if (state.ws) send(state.ws, { type: "event", event });
      } catch (e) {
        console.warn(`[rich:${name}] Failed to parse remaining buffer on close:`, buffer.trim());
      }
    }
    buffer = "";
    state.proc = null;
    state.turning = false;
    state.initReceived = false; // Reset so next process gets its init shown
    // Flush on close to ensure all events are persisted
    flushPersist(name, state);

    if (code !== 0 && code !== null) {
      console.warn(`[rich:${name}] Process (pid=${pid}) exited with code ${code}, signal=${signal}, wasTurning=${wasTurning}`);
      if (state.ws) {
        send(state.ws, { type: "error", message: `Process exited (code ${code})` });
      }
    } else if (wasTurning) {
      // Process exited cleanly mid-turn — something went wrong (OOM, context
      // exhaustion, API error handled internally, etc.). Must notify client
      // or the UI will stay stuck in streaming state forever.
      console.warn(`[rich:${name}] Process (pid=${pid}) exited cleanly (code=${code}, signal=${signal}) while turn was in progress`);
      if (state.ws) {
        send(state.ws, { type: "error", message: "Agent process exited unexpectedly" });
      }
    } else {
      console.log(`[rich:${name}] Process (pid=${pid}) exited cleanly (code=${code}, signal=${signal})`);
    }

    // Always send turn_complete if we were mid-turn so the client exits streaming state
    if (wasTurning && state.ws) {
      send(state.ws, { type: "turn_complete" });
    }
  });

  proc.on("error", (err) => {
    console.error(`[rich:${name}] Process error (pid=${proc.pid}):`, err.message);
    state.proc = null;
    state.spawning = false;
    state.turning = false;
    state.initReceived = false;
    if (state.ws) send(state.ws, { type: "error", message: err.message });
  });

  return proc;
}

export function bridgeRichSession(ws: WebSocket, sessionName: string, command = "claude"): void {
  const state = getOrCreate(sessionName, command);

  // Disconnect previous client if any
  if (state.ws && state.ws !== ws && state.ws.readyState === WebSocket.OPEN) {
    console.log(`[rich:${sessionName}] Disconnecting previous WS client`);
    state.ws.close();
  }
  console.log(`[rich:${sessionName}] WS client connected (proc=${state.proc?.pid ?? "none"}, turning=${state.turning}, events=${state.events.length})`);
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
        proc = ensureProcess(sessionName, state);
      } catch (e: any) {
        send(ws, { type: "error", message: `Failed to spawn claude: ${e.message}` });
        return;
      }

      const userMsg = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: parsed.text }],
        },
      };

      // Check stdin is still writable before committing to the turn
      if (!proc.stdin || proc.stdin.destroyed) {
        console.error(`[rich:${sessionName}] stdin is destroyed, cannot send prompt`);
        send(ws, { type: "error", message: "Agent process stdin is closed" });
        return;
      }

      state.turning = true;
      try {
        proc.stdin.write(JSON.stringify(userMsg) + "\n");
      } catch (e: any) {
        console.error(`[rich:${sessionName}] stdin.write() threw:`, e.message);
        state.turning = false;
        send(ws, { type: "error", message: `Failed to send prompt: ${e.message}` });
      }
    }
  });

  const cleanup = (reason?: string) => {
    // Only clear the ws ref if it's still us
    if (state.ws === ws) {
      console.log(`[rich:${sessionName}] WS client disconnected (reason=${reason ?? "unknown"}, turning=${state.turning})`);
      state.ws = null;
    }
    // Do NOT kill the claude process — it should finish its turn
    // and events will be stored for the next connection
  };

  ws.on("close", (code: number, reason: Buffer) => cleanup(`close:${code}`));
  ws.on("error", (err: Error) => cleanup(`error:${err.message}`));
}

/** Clean up all state for a rich session (called on session delete) */
export function cleanupRichSession(name: string): void {
  const state = sessions.get(name);
  if (!state) {
    // Even if not in memory, clean up DB
    deleteState(name);
    return;
  }
  if (state.proc) {
    try {
      state.proc.stdin?.end();
      state.proc.kill();
    } catch {}
  }
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }
  const timer = flushTimers.get(name);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(name);
  }
  sessions.delete(name);
  deleteState(name);
}

/** Check if a rich session has state (for alive status) */
export function richSessionExists(name: string): boolean {
  if (sessions.has(name)) return true;
  // Check DB for persisted sessions that survived a restart
  return loadState(name) !== null;
}
