import Database from "better-sqlite3";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import type { Session, ExecutorInfo, SessionLiveness } from "../shared/types";
import { LocalExecutor } from "./executor-interface";
import { cleanupRichSession } from "./claude-bridge";

// Cache local git version at startup
let localVersion: string | undefined;
try {
  localVersion = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).trim();
} catch {
  // Not a git repo or git not available
}

export type { Session };

const LOCAL_EXECUTOR_ENABLED = process.env.DISABLE_LOCAL_EXECUTOR !== "1";

class SessionManager {
  private db: Database.Database;
  private localExecutor = LOCAL_EXECUTOR_ENABLED ? new LocalExecutor() : null;
  private _registry: import("./executor-registry").ExecutorRegistry | null = null;

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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        labels TEXT DEFAULT '[]',
        status TEXT DEFAULT 'offline',
        last_seen INTEGER DEFAULT 0
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
    // Migration: add executor column
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN executor TEXT DEFAULT 'local'`);
    } catch {
      // Column already exists
    }
    // Migration: add job columns
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN job_prompt TEXT DEFAULT NULL`);
    } catch {
      // Column already exists
    }
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN job_max_iterations INTEGER DEFAULT NULL`);
    } catch {
      // Column already exists
    }
    // Migration: add position column for stable tab ordering
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN position INTEGER DEFAULT 0`);
      // Backfill existing sessions: assign positions based on created_at DESC
      this.db.exec(`
        UPDATE sessions SET position = (
          SELECT COUNT(*) FROM sessions s2 WHERE s2.created_at > sessions.created_at
        )
      `);
    } catch {
      // Column already exists
    }
  }

  /** Set the executor registry (called by server.ts after startup) */
  setRegistry(registry: import("./executor-registry").ExecutorRegistry): void {
    this._registry = registry;
  }

  get registry() {
    return this._registry;
  }

  list(): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY position ASC, created_at DESC")
      .all() as any[];
    const alive: Session[] = [];
    const deadNames: string[] = [];
    for (const row of rows) {
      const executor = row.executor || "local";
      const mode = row.mode || "terminal";
      if (executor === "local") {
        // Rich sessions use tmux via wrapper — alive as long as the DB row exists
        if (mode === "rich") {
          alive.push({
            ...row,
            mode,
            parent: row.parent || null,
            executor: "local",
            last_activity: row.last_activity || Math.floor(new Date(row.created_at).getTime() / 1000),
            alive: true,
            job_prompt: row.job_prompt || null,
            job_max_iterations: row.job_max_iterations || null,
            needs_input: false,
          });
          continue;
        }
        if (!this.localExecutor) { deadNames.push(row.name); continue; }
        // Direct tmux check (existing behavior)
        if (this.localExecutor.tmuxExists(row.name)) {
          alive.push({
            ...row,
            mode,
            parent: row.parent || null,
            executor: "local",
            last_activity: this.localExecutor.getPaneActivity(row.name),
            alive: true,
            job_prompt: row.job_prompt || null,
            job_max_iterations: row.job_max_iterations || null,
            needs_input: false,
          });
        } else {
          deadNames.push(row.name);
        }
      } else {
        // Remote executor: use heartbeat-cached liveness data
        const liveness = this._registry?.getSessionLiveness(executor, row.name);
        if (liveness) {
          alive.push({
            ...row,
            parent: row.parent || null,
            executor,
            last_activity: liveness.last_activity,
            alive: liveness.alive,
            job_prompt: row.job_prompt || null,
            job_max_iterations: row.job_max_iterations || null,
            needs_input: false,
          });
        } else {
          // Executor offline or session not reported — show as offline
          const executorOnline = this._registry?.isExecutorOnline(executor) ?? false;
          if (!executorOnline) {
            alive.push({
              ...row,
              parent: row.parent || null,
              executor,
              last_activity: 0,
              alive: false,
              job_prompt: row.job_prompt || null,
              job_max_iterations: row.job_max_iterations || null,
              needs_input: false,
            });
          } else {
            // Executor online but session not in heartbeat yet.
            // Grace period: keep recently-created sessions (heartbeat may
            // not have reported them yet).
            const createdAt = new Date(row.created_at).getTime();
            const ageMs = Date.now() - createdAt;
            if (ageMs > 60_000) {
              deadNames.push(row.name);
            } else {
              alive.push({
                ...row,
                parent: row.parent || null,
                executor,
                last_activity: Math.floor(createdAt / 1000),
                alive: true,
                job_prompt: row.job_prompt || null,
                job_max_iterations: row.job_max_iterations || null,
                needs_input: false,
              });
            }
          }
        }
      }
    }
    // Auto-cleanup dead sessions from DB
    if (deadNames.length > 0) {
      const del = this.db.prepare("DELETE FROM sessions WHERE name = ?");
      for (const name of deadNames) del.run(name);
    }
    return alive;
  }

  async create(name: string, description = "", command = "claude", executor = "local", mode: "terminal" | "rich" = "terminal"): Promise<Session> {
    // Inject theme settings for claude commands
    let finalCommand = command;
    if (command.split(/\s+/)[0] === "claude") {
      finalCommand = `${command} ${this.getClaudeThemeArg()}`;
    }

    if (mode === "rich") {
      const exec = this.getExecutor(executor);
      await exec.createRichSession({ name, command: finalCommand });

      this.db
        .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, mode, position) VALUES (?, ?, ?, ?, ?, ?)")
        .run(name, description, finalCommand, executor, "rich", this.nextPosition());

      return {
        name,
        description,
        command: finalCommand,
        mode: "rich",
        parent: null,
        executor,
        last_activity: Math.floor(Date.now() / 1000),
        created_at: new Date().toISOString(),
        alive: true,
        job_prompt: null,
        job_max_iterations: null,
        needs_input: false,
      };
    }

    const exec = this.getExecutor(executor);

    const result = await exec.createSession({ name, description, command: finalCommand });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, position) VALUES (?, ?, ?, ?, ?)")
      .run(name, description, result.command, executor, this.nextPosition());

    return {
      name,
      description,
      command: result.command,
      mode: "terminal",
      parent: null,
      executor,
      last_activity: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      alive: true,
      job_prompt: null,
      job_max_iterations: null,
      needs_input: false,
    };
  }

  async createJob(name: string, prompt: string, maxIterations = 50, executor = "local", skipPermissions = true): Promise<Session> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }

    let command = skipPermissions ? "claude --dangerously-skip-permissions" : "claude";
    command = `${command} ${this.getClaudeThemeArg()}`;
    const exec = this.getExecutor(executor);

    await exec.createJob({ name, prompt, maxIterations, command });

    // Insert into DB with job fields
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, job_prompt, job_max_iterations, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(name, prompt.slice(0, 200), command, executor, prompt, maxIterations, this.nextPosition());

    return {
      name,
      description: prompt.slice(0, 200),
      command,
      mode: "terminal" as const,
      parent: null,
      executor,
      last_activity: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      alive: true,
      job_prompt: prompt,
      job_max_iterations: maxIterations,
      needs_input: false,
    };
  }

  async delete(name: string): Promise<void> {
    const mode = this.getMode(name);
    if (mode === "rich") {
      cleanupRichSession(name);
    } else {
      const executor = this.getSessionExecutorId(name);
      const exec = this.getExecutor(executor);
      await exec.deleteSession(name);
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

  async snapshot(name: string): Promise<string> {
    const mode = this.getSessionMode(name);
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    if (mode === "rich") {
      if (executor === "local") return this.snapshotRichSession(name);
      return exec.snapshotRichSession(name);
    }
    return exec.snapshotSession(name);
  }

  async summarize(name: string): Promise<string> {
    const mode = this.getSessionMode(name);
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);

    let snapshotText: string;
    if (mode === "rich") {
      try {
        snapshotText = executor === "local"
          ? this.snapshotRichSession(name, 200)
          : await exec.snapshotRichSession(name);
      } catch {
        return "";
      }
    } else {
      const executor = this.getSessionExecutorId(name);
      const exec = this.getExecutor(executor);
      try {
        snapshotText = await exec.snapshotSession(name, 200);
      } catch {
        return "";
      }
    }
    if (!snapshotText.trim()) return "";

    const prompt = mode === "rich"
      ? "You are looking at a conversation log from a Claude coding session. " +
        "Summarize what this session is working on in one brief sentence (max 80 chars). " +
        "Output ONLY the summary sentence, nothing else."
      : "You are looking at terminal output from a coding session. " +
        "Summarize what this session is working on in one brief sentence (max 80 chars). " +
        "Output ONLY the summary sentence, nothing else.";

    const { execFile } = await import("child_process");
    const description = await new Promise<string>((resolve) => {
      const child = execFile("claude", ["-p", prompt], { timeout: 60000 }, (err, stdout) => {
        if (err || !stdout) { resolve(""); return; }
        resolve(stdout.trim());
      });
      child.stdin?.write(snapshotText);
      child.stdin?.end();
    });

    if (description) {
      this.db.prepare("UPDATE sessions SET description = ? WHERE name = ?").run(description, name);
    }
    return description;
  }

  private getSessionMode(name: string): "terminal" | "rich" {
    const row = this.db.prepare("SELECT mode FROM sessions WHERE name = ?").get(name) as
      | { mode?: string }
      | undefined;
    return (row?.mode as "terminal" | "rich") || "terminal";
  }

  private snapshotRichSession(name: string, maxLines = 50): string {
    const eventsPath = join(process.cwd(), "data", "rich", name, "events.ndjson");
    if (!existsSync(eventsPath)) return "";
    let content: string;
    try {
      content = readFileSync(eventsPath, "utf-8");
    } catch {
      return "";
    }
    const lines: string[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "user") {
          for (const block of event.message?.content || []) {
            if (block.type === "text") lines.push(`User: ${block.text}`);
          }
        } else if (event.type === "assistant") {
          for (const block of event.message?.content || []) {
            if (block.type === "text") lines.push(`Assistant: ${block.text}`);
            if (block.type === "tool_use") lines.push(`[Tool: ${block.name}]`);
          }
        } else if (event.type === "result") {
          if (event.result) lines.push(`Result: ${event.result}`);
        }
      } catch {}
    }
    return lines.slice(-maxLines).join("\n");
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

  async fork(sourceName: string, newName: string): Promise<Session> {
    // Get source session info from DB
    const sourceRow = this.db
      .prepare("SELECT command, executor, mode FROM sessions WHERE name = ?")
      .get(sourceName) as { command: string; executor: string; mode: string } | undefined;
    const sourceCommand = sourceRow?.command || "claude";
    const sourceExecutor = sourceRow?.executor || "local";
    const sourceMode = (sourceRow?.mode || "terminal") as "terminal" | "rich";

    if (sourceMode === "rich") {
      return this.forkRichSession(sourceName, newName, sourceCommand, sourceExecutor);
    }

    // Fork targets the same executor as the source
    const exec = this.getExecutor(sourceExecutor);

    // Get source CWD (for local executor, direct tmux query)
    let sourceCwd: string | null = null;
    if (sourceExecutor === "local" && this.localExecutor) {
      sourceCwd = this.localExecutor.getPaneCwd(sourceName);
    }

    const hooks = this.getForkHooks();
    const result = await exec.forkSession({
      sourceName,
      newName,
      sourceCommand,
      sourceCwd,
      forkHooks: hooks,
    });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent, executor, mode, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, result.command, sourceName, sourceExecutor, "terminal", this.nextPosition());

    return {
      name: newName,
      description: `forked from ${sourceName}`,
      command: result.command,
      mode: "terminal" as const,
      parent: sourceName,
      executor: sourceExecutor,
      last_activity: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      alive: true,
      job_prompt: null,
      job_max_iterations: null,
      needs_input: false,
    };
  }

  private async forkRichSession(sourceName: string, newName: string, sourceCommand: string, sourceExecutor: string): Promise<Session> {
    // Get the Claude session_id from rich_sessions table
    const richRow = this.db
      .prepare("SELECT session_id FROM rich_sessions WHERE name = ?")
      .get(sourceName) as { session_id: string | null } | undefined;

    if (!richRow?.session_id) {
      throw new Error(`Cannot fork rich session "${sourceName}": no session ID found (session may not have been started yet)`);
    }

    // Build fork command: base command + --resume <id> --fork-session
    // Strip any existing --resume/--fork-session/--session-id from the source command
    const cleanCommand = sourceCommand
      .replace(/--resume\s+\S+/g, "")
      .replace(/--fork-session/g, "")
      .replace(/--session-id\s+\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const forkCommand = `${cleanCommand} --resume ${richRow.session_id} --fork-session`;

    // Create runtime directory for the new rich session
    mkdirSync(join(process.cwd(), "data", "rich", newName), { recursive: true });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent, executor, mode, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, forkCommand, sourceName, sourceExecutor, "rich", this.nextPosition());

    return {
      name: newName,
      description: `forked from ${sourceName}`,
      command: forkCommand,
      mode: "rich" as const,
      parent: sourceName,
      executor: sourceExecutor,
      last_activity: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      alive: true,
      job_prompt: null,
      job_max_iterations: null,
      needs_input: false,
    };
  }

  /** Attach a user's WebSocket to a session's terminal */
  attachSession(name: string, userWs: import("ws").WebSocket, cols?: number, rows?: number): void {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    exec.attachSession(name, userWs, cols, rows);
  }

  /** Attach a user's WebSocket to a rich session */
  attachRichSession(name: string, userWs: import("ws").WebSocket): void {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    const command = this.getCommand(name);
    exec.attachRichSession(name, command, userWs);
  }

  /** List registered executors */
  listExecutors(): ExecutorInfo[] {
    const executors: ExecutorInfo[] = [];
    if (this.localExecutor) {
      const localCount = (this.db.prepare("SELECT COUNT(*) as c FROM sessions WHERE executor = 'local'").get() as any).c;
      executors.push({ id: "local", name: "local", labels: [], status: "online", last_seen: Math.floor(Date.now() / 1000), version: localVersion, sessionCount: localCount });
    }
    if (this._registry) {
      executors.push(...this._registry.listExecutors());
    }
    return executors;
  }

  /** Update executor info in DB (called by registry on register/heartbeat) */
  upsertExecutor(info: { id: string; name: string; labels: string[]; status: string }): void {
    this.db
      .prepare("INSERT OR REPLACE INTO executors (id, name, labels, status, last_seen) VALUES (?, ?, ?, ?, ?)")
      .run(info.id, info.name, JSON.stringify(info.labels), info.status, Math.floor(Date.now() / 1000));
  }

  /** Adopt sessions reported by a remote executor that don't exist in the DB */
  adoptOrphanedSessions(executorId: string, sessions: SessionLiveness[]): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO sessions (name, description, command, executor, position) VALUES (?, ?, ?, ?, ?)"
    );
    for (const s of sessions) {
      insert.run(s.name, "", "claude", executorId, this.nextPosition());
    }
  }

  /** Reorder sessions: accepts an ordered array of session names */
  reorder(names: string[]): void {
    const stmt = this.db.prepare("UPDATE sessions SET position = ? WHERE name = ?");
    const tx = this.db.transaction(() => {
      for (let i = 0; i < names.length; i++) {
        stmt.run(i, names[i]);
      }
    });
    tx();
  }

  /** Get the next position value for a new session */
  private nextPosition(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM sessions").get() as { pos: number };
    return row.pos;
  }

  getMode(name: string): "terminal" | "rich" {
    const row = this.db.prepare("SELECT mode FROM sessions WHERE name = ?").get(name) as
      | { mode: string }
      | undefined;
    return (row?.mode as "terminal" | "rich") || "terminal";
  }

  getCommand(name: string): string {
    const row = this.db.prepare("SELECT command FROM sessions WHERE name = ?").get(name) as
      | { command: string }
      | undefined;
    return row?.command || "claude";
  }

  // --- Private helpers ---

  /** Build --settings flag to set Claude Code's theme to use ANSI palette colors.
   *  Always use dark-ansi: it uses default terminal fg/bg for user messages and
   *  ANSI palette colors for syntax/diffs, so it adapts to both dark and light
   *  terminal themes. light-ansi uses \e[30m\e[40m for user messages (black on
   *  black) which creates jarring dark bubbles on light backgrounds. */
  private getClaudeThemeArg(): string {
    return `--settings '{"theme":"dark-ansi"}'`;
  }

  private getSessionExecutorId(name: string): string {
    const row = this.db.prepare("SELECT executor FROM sessions WHERE name = ?").get(name) as
      | { executor: string }
      | undefined;
    return row?.executor || "local";
  }

  private getExecutor(id: string): import("../shared/types").ExecutorInterface {
    if (id === "local") {
      if (!this.localExecutor) throw new Error("Local executor is disabled (DISABLE_LOCAL_EXECUTOR=1)");
      return this.localExecutor;
    }
    if (!this._registry) throw new Error(`No executor registry available`);
    return this._registry.getRemoteExecutor(id);
  }
}

// Singleton — survives Next.js hot reloads in dev
const SCHEMA_VERSION = 8; // bump to force re-creation after class changes
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
