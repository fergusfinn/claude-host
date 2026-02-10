import { spawnSync, execFileSync } from "child_process";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import {
  mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, openSync,
  closeSync, readSync, writeSync, fstatSync, watch, statSync, rmSync,
  constants as fsConstants,
  type FSWatcher,
} from "fs";
import { dirname, join } from "path";

/**
 * Rich-mode bridge: runs `claude -p` inside a tmux session for process
 * persistence across server restarts. Communication uses:
 *   - A FIFO (named pipe) for sending prompts to claude's stdin
 *   - An append-only NDJSON file for capturing claude's stdout events
 *
 * The wrapper script (scripts/rich-wrapper.sh) manages the claude process
 * lifecycle inside tmux, automatically restarting with --resume if it exits.
 *
 * Protocol (client <-> server over WebSocket):
 *   Client -> Server:  { type: "prompt", text: string }
 *   Server -> Client:  { type: "event", event: object }
 *   Server -> Client:  { type: "turn_complete" }
 *   Server -> Client:  { type: "error", message: string }
 *   Server -> Client:  { type: "session_state", streaming: boolean, process_alive: boolean }
 */

const TMUX = (() => {
  try {
    return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim();
  } catch {
    return "tmux";
  }
})();

// Strip TMUX env var to avoid nesting issues
delete process.env.TMUX;

const WRAPPER_SCRIPT = join(process.cwd(), "scripts", "rich-wrapper.sh");
const RICH_DATA_DIR = join(process.env.DATA_DIR || join(process.cwd(), "data"), "rich");

interface RichState {
  sessionId: string | null;
  eventsFilePath: string;
  fifoPath: string;
  byteOffset: number;
  clients: Set<WebSocket>;
  turning: boolean;
  initReceived: boolean;
  command: string;
  // File tailing
  tailWatcher: FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  lineBuffer: string; // partial line from last read
  lastPromptText: string | null; // dedup user events echoed by claude
  // Interrupt debounce
  lastInterruptTime: number;
  // Health check
  healthCheckTimer: ReturnType<typeof setInterval> | null;
  lastProcessAlive: boolean;
}

// --- SQLite persistence ---

const DB_PATH = join(process.env.DATA_DIR || join(process.cwd(), "data"), "sessions.db");

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
        byte_offset INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `);
    // Migration: add byte_offset if missing
    try {
      _db.exec(`ALTER TABLE rich_sessions ADD COLUMN byte_offset INTEGER DEFAULT 0`);
    } catch {
      // Column already exists
    }
  }
  return _db;
}

function loadState(name: string): { sessionId: string | null; byteOffset: number; events: object[] } | null {
  const db = getDb();
  const row = db.prepare("SELECT session_id, byte_offset, events FROM rich_sessions WHERE name = ?").get(name) as
    | { session_id: string | null; byte_offset: number; events: string }
    | undefined;
  if (!row) return null;
  let events: object[] = [];
  try { events = JSON.parse(row.events); } catch {}
  return { sessionId: row.session_id, byteOffset: row.byte_offset ?? 0, events };
}

function saveState(name: string, sessionId: string | null, byteOffset: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO rich_sessions (name, session_id, byte_offset, events, updated_at)
    VALUES (?, ?, ?, '[]', unixepoch())
    ON CONFLICT(name) DO UPDATE SET
      session_id = excluded.session_id,
      byte_offset = excluded.byte_offset,
      updated_at = excluded.updated_at
  `).run(name, sessionId, byteOffset);
}

function deleteState(name: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rich_sessions WHERE name = ?").run(name);
}

// --- In-memory state ---

const sessions = new Map<string, RichState>();

function sessionDir(name: string): string {
  return join(RICH_DATA_DIR, name);
}

function getOrCreate(name: string, command = "claude"): RichState {
  let state = sessions.get(name);
  if (!state) {
    const dir = sessionDir(name);
    const saved = loadState(name);

    state = {
      sessionId: saved?.sessionId ?? null,
      eventsFilePath: join(dir, "events.ndjson"),
      fifoPath: join(dir, "prompt.fifo"),
      byteOffset: saved?.byteOffset ?? 0,
      clients: new Set(),
      turning: false,
      initReceived: false,
      command,
      tailWatcher: null,
      pollTimer: null,
      lineBuffer: "",
      lastPromptText: null,
      lastInterruptTime: 0,
      healthCheckTimer: null,
      lastProcessAlive: false,
    };

    // Migrate old SQLite-stored events to file if needed
    if (saved?.events && saved.events.length > 0 && !existsSync(state.eventsFilePath)) {
      mkdirSync(dir, { recursive: true });
      const content = saved.events.map(e => JSON.stringify(e)).join("\n") + "\n";
      writeFileSync(state.eventsFilePath, content);
      state.byteOffset = Buffer.byteLength(content);
      // Extract session_id from migrated events
      for (const evt of saved.events) {
        const sid = (evt as any).session_id;
        if (sid) { state.sessionId = sid; break; }
      }
      saveState(name, state.sessionId, state.byteOffset);
    }

    sessions.set(name, state);
  }
  return state;
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(state: RichState, msg: object) {
  const json = JSON.stringify(msg);
  for (const ws of state.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

// --- tmux session management ---

function tmuxName(sessionName: string): string {
  return `rich-${sessionName}`;
}

function tmuxExists(sessionName: string): boolean {
  return spawnSync(TMUX, ["has-session", "-t", tmuxName(sessionName)], { stdio: "pipe" }).status === 0;
}

function ensureTmuxSession(name: string, state: RichState): void {
  const tName = tmuxName(name);
  if (tmuxExists(name)) return;

  const dir = sessionDir(name);
  mkdirSync(dir, { recursive: true });

  // Build claude args for the wrapper
  const claudeArgs = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
  ];

  if (state.command.includes("--dangerously-skip-permissions")) {
    claudeArgs.push("--dangerously-skip-permissions");
  }

  // Extract --settings from command if present
  const settingsMatch = state.command.match(/--settings\s+'([^']+)'/);
  if (settingsMatch) {
    claudeArgs.push("--settings", settingsMatch[1]);
  }

  // Extract --resume and --fork-session for forked rich sessions
  const resumeMatch = state.command.match(/--resume\s+(\S+)/);
  if (resumeMatch) {
    claudeArgs.push("--resume", resumeMatch[1]);
  }
  if (state.command.includes("--fork-session")) {
    claudeArgs.push("--fork-session");
  }

  // Create tmux session running the wrapper script
  const r = spawnSync(TMUX, [
    "new-session", "-d", "-s", tName, "-x", "200", "-y", "50",
    "-c", process.cwd(),
    "bash", WRAPPER_SCRIPT,
    state.eventsFilePath, state.fifoPath, ...claudeArgs,
  ], { stdio: "pipe" });

  if (r.status !== 0) {
    throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
  }

  // Configure tmux session
  spawnSync(TMUX, ["set-option", "-t", tName, "status", "off"], { stdio: "pipe" });
  spawnSync(TMUX, ["set-option", "-t", tName, "remain-on-exit", "off"], { stdio: "pipe" });

  console.log(`[rich:${name}] Created tmux session ${tName}`);
}

// --- Event file tailing ---

/** Read new bytes from the events file starting at byteOffset */
function readNewEvents(name: string, state: RichState): void {
  if (!existsSync(state.eventsFilePath)) return;

  let fd: number;
  try {
    fd = openSync(state.eventsFilePath, "r");
  } catch {
    return;
  }

  try {
    const stat = fstatSync(fd);
    if (stat.size <= state.byteOffset) return;

    const buf = Buffer.alloc(stat.size - state.byteOffset);
    readSync(fd, buf, 0, buf.length, state.byteOffset);
    state.byteOffset = stat.size;

    processEventChunk(name, state, buf.toString());
  } finally {
    closeSync(fd);
  }
}

/** Parse NDJSON chunk, relay events to WS client */
function processEventChunk(name: string, state: RichState, chunk: string): void {
  const data = state.lineBuffer + chunk;
  const lines = data.split("\n");
  state.lineBuffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);

      // Capture session_id
      if (event.session_id && !state.sessionId) {
        state.sessionId = event.session_id;
      }

      // Dedup user events echoed by claude that we already wrote to the events file
      if (event.type === "user" && state.lastPromptText) {
        const content = event.message?.content;
        if (Array.isArray(content) && content.length === 1
            && content[0].type === "text" && content[0].text === state.lastPromptText) {
          state.lastPromptText = null;
          continue;
        }
      }

      // Handle restart marker from wrapper
      if (event.type === "system" && event.subtype === "restart") {
        state.initReceived = false;
        state.turning = false;
        broadcast(state, { type: "event", event });
        continue;
      }

      // Skip duplicate init events
      if (event.type === "system" && event.subtype === "init") {
        if (state.initReceived) continue;
        state.initReceived = true;
      }

      // Handle turn completion
      if (event.type === "result") {
        state.turning = false;
        state.lastInterruptTime = 0;
        broadcast(state, { type: "event", event });
        broadcast(state, { type: "turn_complete" });
        // Persist offset at turn boundaries
        saveState(name, state.sessionId, state.byteOffset);
        continue;
      }

      // Forward event to all WS clients
      broadcast(state, { type: "event", event });
    } catch {
      // Non-JSON line — skip
    }
  }
}

/** Replay all events from file to a WebSocket client */
function replayEventsFromFile(state: RichState, ws: WebSocket): void {
  if (!existsSync(state.eventsFilePath)) return;

  let content: string;
  try {
    content = readFileSync(state.eventsFilePath, "utf-8");
  } catch {
    return;
  }

  // Track init for dedup during replay
  let initSeen = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);

      // Skip stream deltas on replay
      if (event.type === "stream_event") continue;

      // Dedup init events
      if (event.type === "system" && event.subtype === "init") {
        if (initSeen) continue;
        initSeen = true;
      }

      send(ws, { type: "event", event });
    } catch {
      // Skip unparseable lines
    }
  }
}

/** Start tailing the events file for live updates */
function startTailing(name: string, state: RichState): void {
  stopTailing(state);

  // Read any events that accumulated while we weren't watching
  readNewEvents(name, state);

  // Watch for changes with fs.watch (backed by inotify/kqueue)
  try {
    if (existsSync(state.eventsFilePath)) {
      state.tailWatcher = watch(state.eventsFilePath, () => {
        readNewEvents(name, state);
      });
      state.tailWatcher.on("error", () => {
        // Watcher failed — poll timer will handle it
      });
    }
  } catch {
    // fs.watch not available — fall through to poll timer
  }

  // Fallback poll timer for reliability (fs.watch can be flaky)
  state.pollTimer = setInterval(() => {
    readNewEvents(name, state);
  }, 500);
}

/** Stop tailing the events file */
function stopTailing(state: RichState): void {
  if (state.tailWatcher) {
    try { state.tailWatcher.close(); } catch {}
    state.tailWatcher = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

// --- Process health check ---

function startHealthCheck(name: string, state: RichState): void {
  stopHealthCheck(state);
  state.lastProcessAlive = tmuxExists(name);

  state.healthCheckTimer = setInterval(() => {
    const alive = tmuxExists(name);
    if (alive !== state.lastProcessAlive) {
      state.lastProcessAlive = alive;
      broadcast(state, { type: "session_state", streaming: state.turning, process_alive: alive });
    }
  }, 5000);
}

function stopHealthCheck(state: RichState): void {
  if (state.healthCheckTimer) {
    clearInterval(state.healthCheckTimer);
    state.healthCheckTimer = null;
  }
}

// --- FIFO prompt writing ---

function sendPromptViaFifo(name: string, state: RichState, promptJson: string): boolean {
  try {
    // O_WRONLY | O_NONBLOCK — fails immediately with ENXIO if no reader
    const fd = openSync(state.fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK);
    try {
      const buf = Buffer.from(promptJson + "\n");
      let written = 0;
      while (written < buf.length) {
        // writeSync with offset to handle partial writes
        const n = writeSync(fd, buf, written, buf.length - written);
        written += n;
      }
      return true;
    } finally {
      closeSync(fd);
    }
  } catch (err: any) {
    if (err.code === "ENXIO") {
      console.error(`[rich:${name}] FIFO has no reader — wrapper may have died`);
      return false;
    }
    console.error(`[rich:${name}] FIFO write error:`, err.message);
    return false;
  }
}

// --- Interrupt ---

function sendInterrupt(name: string): void {
  const tName = tmuxName(name);
  spawnSync(TMUX, ["send-keys", "-t", tName, "C-c"], { stdio: "pipe" });
}

// --- Public API ---

export function bridgeRichSession(ws: WebSocket, sessionName: string, command = "claude"): void {
  const state = getOrCreate(sessionName, command);

  // Add this client to the set
  state.clients.add(ws);

  // Replay events from the file to this new client
  replayEventsFromFile(state, ws);

  // If this is the first client, start tailing from current file position
  if (state.clients.size === 1) {
    if (existsSync(state.eventsFilePath)) {
      try {
        state.byteOffset = statSync(state.eventsFilePath).size;
      } catch {}
    }
    state.initReceived = false;
    startTailing(sessionName, state);
    startHealthCheck(sessionName, state);
  }

  // Tell this client whether a turn is currently in progress
  const processAlive = tmuxExists(sessionName);
  send(ws, { type: "session_state", streaming: state.turning, process_alive: processAlive });

  console.log(`[rich:${sessionName}] WS client connected (clients=${state.clients.size}, tmux=${tmuxExists(sessionName)}, turning=${state.turning})`);

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
      const now = Date.now();
      if (state.turning && tmuxExists(sessionName) && now - state.lastInterruptTime > 2000) {
        state.lastInterruptTime = now;
        sendInterrupt(sessionName);
      }
      return;
    }

    if (parsed.type === "restart") {
      if (tmuxExists(sessionName)) {
        send(ws, { type: "session_state", streaming: state.turning, process_alive: true });
        return;
      }
      try {
        ensureTmuxSession(sessionName, state);
        if (!state.pollTimer) {
          startTailing(sessionName, state);
        }
        startHealthCheck(sessionName, state);
        broadcast(state, { type: "session_state", streaming: false, process_alive: true });
        console.log(`[rich:${sessionName}] Restarted tmux session`);
      } catch (e: any) {
        send(ws, { type: "error", message: `Failed to restart: ${e.message}` });
      }
      return;
    }

    if (parsed.type === "prompt" && parsed.text) {
      // Ensure tmux session is running
      try {
        ensureTmuxSession(sessionName, state);
      } catch (e: any) {
        send(ws, { type: "error", message: `Failed to start session: ${e.message}` });
        return;
      }

      // Ensure we're tailing (may not have started if tmux was just created)
      if (!state.pollTimer) {
        startTailing(sessionName, state);
      }

      // Broadcast process_alive: true now that tmux is running (fixes race
      // where initial session_state sent process_alive: false before the
      // first prompt spawned the tmux session)
      if (!state.lastProcessAlive) {
        state.lastProcessAlive = true;
        broadcast(state, { type: "session_state", streaming: state.turning, process_alive: true });
      }

      const isQueued = state.turning;
      const userMsg: Record<string, any> = {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: parsed.text }],
        },
      };
      if (isQueued) {
        userMsg.queued = true;
      }

      // Wait briefly for the FIFO to become available (wrapper needs time to start)
      const maxWait = 5000;
      const start = Date.now();
      const tryWrite = () => {
        const ok = sendPromptViaFifo(sessionName, state, JSON.stringify(userMsg));
        if (ok) {
          state.turning = true;
          // Broadcast immediately so clients see the message without waiting for file tailing
          broadcast(state, { type: "event", event: userMsg });
          // Also persist to the events file for replay on reconnect
          const userLine = JSON.stringify(userMsg) + "\n";
          appendFileSync(state.eventsFilePath, userLine);
          state.byteOffset += Buffer.byteLength(userLine);
          state.lastPromptText = parsed.text as string;
          return;
        }

        if (Date.now() - start < maxWait) {
          setTimeout(tryWrite, 200);
        } else {
          send(ws, { type: "error", message: "Failed to send prompt — wrapper not responding" });
        }
      };
      tryWrite();
    }
  });

  const cleanup = (reason?: string) => {
    state.clients.delete(ws);
    console.log(`[rich:${sessionName}] WS client disconnected (reason=${reason ?? "unknown"}, remaining=${state.clients.size})`);
    if (state.clients.size === 0) {
      // Stop tailing and health checks when no clients are connected (saves resources).
      // Events are still captured by the wrapper in the file.
      stopTailing(state);
      stopHealthCheck(state);
      // Persist current offset
      saveState(sessionName, state.sessionId, state.byteOffset);
    }
  };

  ws.on("close", (code: number) => cleanup(`close:${code}`));
  ws.on("error", (err: Error) => cleanup(`error:${err.message}`));
}

/** Clean up all state for a rich session (called on session delete) */
export function cleanupRichSession(name: string): void {
  const state = sessions.get(name);
  if (state) {
    stopTailing(state);
    stopHealthCheck(state);
    for (const ws of state.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
    state.clients.clear();
    sessions.delete(name);
  }

  // Kill tmux session
  if (tmuxExists(name)) {
    spawnSync(TMUX, ["kill-session", "-t", tmuxName(name)], { stdio: "pipe" });
  }

  // Remove runtime files
  const dir = sessionDir(name);
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  deleteState(name);
}

/** Check if a rich session has state (for alive status) */
export function richSessionExists(name: string): boolean {
  if (sessions.has(name)) return true;
  // Check DB for persisted sessions that survived a restart
  return loadState(name) !== null;
}

/** Check if the rich session's tmux process is actively running */
export function richSessionTmuxAlive(name: string): boolean {
  return tmuxExists(name);
}
