import Database from "better-sqlite3";
import { execFileSync, spawnSync, execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

export interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
  parent: string | null;
  last_activity: number; // unix timestamp (seconds)
  alive: boolean;
}

const TMUX = (() => {
  try {
    return execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim();
  } catch {
    return "tmux";
  }
})();

class SessionManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT DEFAULT '',
        command TEXT NOT NULL DEFAULT 'claude'
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    // Migration: add mode column if missing
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'terminal'`);
    } catch {
      // Column already exists
    }
    // Migration: add parent column for fork lineage
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN parent TEXT DEFAULT NULL`);
    } catch {
      // Column already exists
    }
  }

  private tmuxExists(name: string): boolean {
    return spawnSync(TMUX, ["has-session", "-t", name], { stdio: "pipe" }).status === 0;
  }

  private getPaneActivity(name: string): number {
    try {
      const r = spawnSync(TMUX, ["display-message", "-t", name, "-p", "#{pane_last_activity}"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      const ts = parseInt(r.stdout?.trim() || "0", 10);
      return ts || Math.floor(Date.now() / 1000);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }

  list(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as any[];
    const alive: Session[] = [];
    const deadNames: string[] = [];
    for (const row of rows) {
      if (this.tmuxExists(row.name)) {
        alive.push({
          ...row,
          parent: row.parent || null,
          last_activity: this.getPaneActivity(row.name),
          alive: true,
        });
      } else {
        deadNames.push(row.name);
      }
    }
    // Auto-cleanup dead sessions from DB
    if (deadNames.length > 0) {
      const del = this.db.prepare("DELETE FROM sessions WHERE name = ?");
      for (const name of deadNames) del.run(name);
    }
    return alive;
  }

  create(name: string, description = "", command = "claude"): Session {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }

    if (this.tmuxExists(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const tmuxArgs = ["new-session", "-d", "-s", name, "-x", "200", "-y", "50"];
    const defaultCwd = this.getConfig("defaultCwd") || join(process.env.HOME || "/tmp", "workspace");
    mkdirSync(defaultCwd, { recursive: true });
    tmuxArgs.push("-c", defaultCwd);
    const r = spawnSync(TMUX, tmuxArgs, {
      stdio: "pipe",
    });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    // Hide status bar — the web UI is the chrome
    spawnSync(TMUX, ["set-option", "-t", name, "status", "off"], { stdio: "pipe" });

    // Enable mouse so tmux receives scroll-wheel events and enters
    // copy-mode for scrollback browsing.  The default WheelUpPane
    // binding enters copy-mode at a shell prompt, and forwards mouse
    // events to apps that have mouse tracking enabled (e.g. claude CLI).
    spawnSync(TMUX, ["set-option", "-t", name, "mouse", "on"], { stdio: "pipe" });

    // Large scrollback buffer
    spawnSync(TMUX, ["set-option", "-t", name, "history-limit", "50000"], { stdio: "pipe" });

    // Exit copy-mode automatically when scrolling back to the bottom
    spawnSync(TMUX, ["set-option", "-t", name, "copy-mode-exit-on-bottom", "on"], { stdio: "pipe" });

    // Emit OSC 52 on copy so the browser client can write to the clipboard
    spawnSync(TMUX, ["set-option", "-s", "set-clipboard", "on"], { stdio: "pipe" });

    // For claude commands, generate a session ID so fork hooks can find the conversation
    let launchCommand = command;
    const baseCommand = command.split(/\s+/)[0];
    if (baseCommand === "claude") {
      const sessionId = randomUUID();
      launchCommand = `${command} --session-id ${sessionId}`;
      spawnSync(TMUX, ["set-environment", "-t", name, "CLAUDE_SESSION_ID", sessionId], {
        stdio: "pipe",
      });
    }

    // Launch command
    spawnSync(TMUX, ["send-keys", "-t", name, launchCommand, "Enter"], { stdio: "pipe" });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command) VALUES (?, ?, ?)")
      .run(name, description, command);

    return { name, description, command, parent: null, last_activity: Math.floor(Date.now() / 1000), created_at: new Date().toISOString(), alive: true };
  }

  delete(name: string): void {
    if (this.tmuxExists(name)) {
      spawnSync(TMUX, ["kill-session", "-t", name], { stdio: "pipe" });
    }
    this.db.prepare("DELETE FROM sessions WHERE name = ?").run(name);
  }

  getConfig(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  getAllConfig(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM config").all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  snapshot(name: string): string {
    if (!this.tmuxExists(name)) return "[session not running]";
    try {
      const r = spawnSync(TMUX, ["capture-pane", "-t", name, "-p", "-S", "-50"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      return r.stdout || "[empty]";
    } catch {
      return "[capture failed]";
    }
  }

  /** Summarize a session using claude -p and store the result as its description */
  async summarize(name: string): Promise<string> {
    if (!this.tmuxExists(name)) return "";

    let snapshot: string;
    try {
      const r = spawnSync(TMUX, ["capture-pane", "-t", name, "-p", "-S", "-200"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      snapshot = r.stdout || "";
    } catch {
      return "";
    }

    if (!snapshot.trim()) return "";

    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      const child = execFile("claude", [
        "-p",
        "You are looking at terminal output from a coding session. " +
          "Summarize what this session is working on in one brief sentence (max 80 chars). " +
          "Output ONLY the summary sentence, nothing else.",
      ], { timeout: 60000 }, (err, stdout) => {
        if (err || !stdout) { resolve(""); return; }
        const description = stdout.trim();
        this.db.prepare("UPDATE sessions SET description = ? WHERE name = ?").run(description, name);
        resolve(description);
      });
      child.stdin?.write(snapshot);
      child.stdin?.end();
    });
  }

  /**
   * Snapshot existing JSONL files, then spawn a background shell script that
   * polls for a new file and sets CLAUDE_SESSION_ID on the tmux session.
   */
  private discoverNewSessionId(sessionName: string, cwd: string): void {
    const encodedCwd = cwd.replace(/\//g, "-");
    const projectDir = join(process.env.HOME || "/tmp", ".claude", "projects", encodedCwd);
    if (!existsSync(projectDir)) return;

    // Snapshot existing files
    const before = new Set<string>();
    try {
      const r = spawnSync("ls", [projectDir], { encoding: "utf-8", timeout: 2000 });
      for (const f of (r.stdout || "").split("\n")) {
        if (f.endsWith(".jsonl")) before.add(f);
      }
    } catch { return; }

    const beforeList = [...before].join("\n");

    // Spawn a background process that polls for the new file
    const { spawn: spawnAsync } = require("child_process");
    const child = spawnAsync("bash", ["-c", `
      for i in $(seq 1 20); do
        sleep 0.5
        for f in "${projectDir}"/*.jsonl; do
          [ -f "$f" ] || continue
          name=$(basename "$f")
          if ! echo "${beforeList}" | grep -qF "$name"; then
            sid="\${name%.jsonl}"
            ${TMUX} set-environment -t "${sessionName}" CLAUDE_SESSION_ID "$sid" 2>/dev/null
            exit 0
          fi
        done
      done
    `], { stdio: "ignore", detached: true });
    child.unref();
  }

  /** Get the current working directory of a tmux session's active pane */
  private getPaneCwd(name: string): string | null {
    if (!this.tmuxExists(name)) return null;
    try {
      const r = spawnSync(TMUX, ["display-message", "-t", name, "-p", "#{pane_current_path}"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      return r.stdout?.trim() || null;
    } catch {
      return null;
    }
  }

  /** Get configured fork hooks: command prefix -> hook script path */
  getForkHooks(): Record<string, string> {
    const raw = this.getConfig("forkHooks");
    if (!raw) {
      // Default: bundled claude fork hook
      return { claude: join(process.cwd(), "hooks", "fork-claude.sh") };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  setForkHooks(hooks: Record<string, string>): void {
    this.setConfig("forkHooks", JSON.stringify(hooks));
  }

  /**
   * Fork a session: create a new session by running a fork hook (if configured)
   * or falling back to the same command in the same CWD.
   */
  fork(sourceName: string, newName: string): Session {
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }
    if (this.tmuxExists(newName)) {
      throw new Error(`Session "${newName}" already exists`);
    }

    // Get source session info
    const sourceRow = this.db
      .prepare("SELECT command FROM sessions WHERE name = ?")
      .get(sourceName) as { command: string } | undefined;
    const sourceCommand = sourceRow?.command || "claude";
    const sourceCwd = this.getPaneCwd(sourceName);

    // Resolve fork hook
    const hooks = this.getForkHooks();
    let forkCommand = sourceCommand;

    // Find matching hook: check if the source command starts with any hook key
    const hookKey = Object.keys(hooks).find((key) =>
      sourceCommand.split(/\s+/)[0] === key
    );

    if (hookKey) {
      const hookPath = hooks[hookKey];
      // Resolve relative paths from the app's root
      const resolvedHook = hookPath.startsWith("/")
        ? hookPath
        : resolve(process.cwd(), hookPath);

      if (existsSync(resolvedHook)) {
        try {
          const result = execSync(`bash "${resolvedHook}"`, {
            encoding: "utf-8",
            timeout: 5000,
            env: {
              ...process.env,
              SOURCE_SESSION: sourceName,
              SOURCE_CWD: sourceCwd || process.cwd(),
              SOURCE_COMMAND: sourceCommand,
            },
          });
          const cmd = result.trim();
          if (cmd) forkCommand = cmd;
        } catch {
          // Hook failed — fall back to source command
        }
      }
    }

    // Create tmux session, optionally in the source CWD
    const tmuxArgs = ["new-session", "-d", "-s", newName, "-x", "200", "-y", "50"];
    if (sourceCwd) {
      tmuxArgs.push("-c", sourceCwd);
    }
    const r = spawnSync(TMUX, tmuxArgs, { stdio: "pipe" });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    spawnSync(TMUX, ["set-option", "-t", newName, "status", "off"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", newName, "mouse", "on"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", newName, "history-limit", "50000"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-t", newName, "copy-mode-exit-on-bottom", "on"], { stdio: "pipe" });
    spawnSync(TMUX, ["set-option", "-s", "set-clipboard", "on"], { stdio: "pipe" });

    spawnSync(TMUX, ["send-keys", "-t", newName, forkCommand, "Enter"], { stdio: "pipe" });

    // For forked claude sessions, discover the new session ID after launch.
    // --fork-session generates a new ID internally; we poll for the newest
    // JSONL file to appear in the project directory and store it.
    const forkBaseCommand = forkCommand.split(/\s+/)[0];
    if (forkBaseCommand === "claude" && sourceCwd) {
      this.discoverNewSessionId(newName, sourceCwd);
    }

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent) VALUES (?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, forkCommand, sourceName);

    return {
      name: newName,
      description: `forked from ${sourceName}`,
      command: forkCommand,
      parent: sourceName,
      last_activity: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      alive: true,
    };
  }
}

// Singleton — survives Next.js hot reloads in dev
const SCHEMA_VERSION = 5; // bump to force re-creation after class changes
const globalForSessions = globalThis as unknown as {
  __sessions?: SessionManager;
  __sessionsVersion?: number;
};

export function getSessionManager(): SessionManager {
  if (!globalForSessions.__sessions || globalForSessions.__sessionsVersion !== SCHEMA_VERSION) {
    const dbPath = join(process.cwd(), "data", "sessions.db");
    globalForSessions.__sessions = new SessionManager(dbPath);
    globalForSessions.__sessionsVersion = SCHEMA_VERSION;
  }
  return globalForSessions.__sessions;
}
