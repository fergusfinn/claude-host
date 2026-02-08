import Database from "better-sqlite3";
import { execFileSync, spawnSync } from "child_process";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

export interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
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
  }

  private tmuxExists(name: string): boolean {
    return spawnSync(TMUX, ["has-session", "-t", name], { stdio: "pipe" }).status === 0;
  }

  list(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as any[];
    return rows.map((row) => ({ ...row, alive: this.tmuxExists(row.name) }));
  }

  create(name: string, description = "", command = "claude"): Session {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }
    if (this.tmuxExists(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const r = spawnSync(TMUX, ["new-session", "-d", "-s", name, "-x", "200", "-y", "50"], {
      stdio: "pipe",
    });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }

    // Hide status bar — the web UI is the chrome
    spawnSync(TMUX, ["set-option", "-t", name, "status", "off"], { stdio: "pipe" });

    // Enable mouse so scroll-wheel scrolls tmux scrollback instead of being
    // forwarded to the application as arrow-key events.
    spawnSync(TMUX, ["set-option", "-t", name, "mouse", "on"], { stdio: "pipe" });

    // Launch command
    spawnSync(TMUX, ["send-keys", "-t", name, command, "Enter"], { stdio: "pipe" });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command) VALUES (?, ?, ?)")
      .run(name, description, command);

    return { name, description, command, created_at: new Date().toISOString(), alive: true };
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
}

// Singleton — survives Next.js hot reloads in dev
const SCHEMA_VERSION = 2; // bump to force re-creation after class changes
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
