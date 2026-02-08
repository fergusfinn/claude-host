import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type { Session, ExecutorInfo } from "../shared/types";
import { LocalExecutor } from "./executor-interface";
import { cleanupRichSession, richSessionExists } from "./claude-bridge";

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
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
      .all() as any[];
    const alive: Session[] = [];
    const deadNames: string[] = [];
    for (const row of rows) {
      const executor = row.executor || "local";
      const mode = row.mode || "terminal";
      if (executor === "local") {
        // Rich sessions have no tmux — always alive
        if (mode === "rich") {
          alive.push({
            ...row,
            mode,
            parent: row.parent || null,
            executor: "local",
            last_activity: Math.floor(Date.now() / 1000),
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
    if (mode === "rich") {
      // Rich sessions don't need tmux — just insert the DB row
      this.db
        .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, mode) VALUES (?, ?, ?, ?, ?)")
        .run(name, description, command, executor, "rich");

      return {
        name,
        description,
        command,
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
    // Only pass defaultCwd for local executor — remote executors use their own default
    const defaultCwd = executor === "local" ? (this.getConfig("defaultCwd") || undefined) : undefined;

    const result = await exec.createSession({ name, description, command, defaultCwd });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor) VALUES (?, ?, ?, ?)")
      .run(name, description, result.command, executor);

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

  async createJob(name: string, prompt: string, maxIterations = 50, executor = "local"): Promise<Session> {
    const { spawnSync } = await import("child_process");
    const defaultCwd = this.getConfig("defaultCwd") || join(process.env.HOME || "/tmp", "workspace");
    mkdirSync(defaultCwd, { recursive: true });

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error("Name must be alphanumeric, hyphens, underscores only");
    }

    if (!this.localExecutor) throw new Error("Local executor is disabled (DISABLE_LOCAL_EXECUTOR=1)");

    if (this.localExecutor.tmuxExists(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    // Create tmux session (same setup as regular sessions)
    const r = spawnSync("tmux", ["new-session", "-d", "-s", name, "-x", "200", "-y", "50", "-c", defaultCwd], { stdio: "pipe" });
    if (r.status !== 0) {
      throw new Error(`Failed to create tmux session: ${r.stderr?.toString()}`);
    }
    // Configure: status off, mouse on, scrollback
    spawnSync("tmux", ["set-option", "-t", name, "status", "off"], { stdio: "pipe" });
    spawnSync("tmux", ["set-option", "-t", name, "mouse", "on"], { stdio: "pipe" });
    spawnSync("tmux", ["set-option", "-t", name, "history-limit", "50000"], { stdio: "pipe" });

    const cwd = this.localExecutor.getPaneCwd(name) || defaultCwd;

    // Write ralph-loop state file
    const claudeDir = join(cwd, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const stateContent = [
      "---",
      `max_iterations: ${maxIterations}`,
      `promise: DONE`,
      "---",
      "",
      prompt,
      "",
    ].join("\n");
    writeFileSync(join(claudeDir, "ralph-loop.local.md"), stateContent);

    // Write prompt to temp file (avoids shell escaping)
    const sessionId = randomUUID();
    const promptFile = `/tmp/claude-job-${sessionId}-prompt.txt`;
    writeFileSync(promptFile, prompt);

    // Write launcher script
    const launcherScript = `/tmp/claude-job-${sessionId}.sh`;
    writeFileSync(launcherScript, [
      "#!/bin/bash",
      `PROMPT=$(cat ${JSON.stringify(promptFile)})`,
      `exec claude --dangerously-skip-permissions --session-id ${sessionId} "$PROMPT"`,
      "",
    ].join("\n"));

    // Store session ID in tmux environment
    spawnSync("tmux", ["set-environment", "-t", name, "CLAUDE_SESSION_ID", sessionId], { stdio: "pipe" });

    // Launch via tmux send-keys
    spawnSync("tmux", ["send-keys", "-t", name, `bash ${launcherScript}`, "Enter"], { stdio: "pipe" });

    // Insert into DB with job fields
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, job_prompt, job_max_iterations) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, prompt.slice(0, 200), "claude", "local", prompt, maxIterations);

    return {
      name,
      description: prompt.slice(0, 200),
      command: "claude",
      mode: "terminal" as const,
      parent: null,
      executor: "local",
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
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    return exec.snapshotSession(name);
  }

  async summarize(name: string): Promise<string> {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    const description = await exec.summarizeSession(name);
    if (description) {
      this.db.prepare("UPDATE sessions SET description = ? WHERE name = ?").run(description, name);
    }
    return description;
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
      .prepare("SELECT command, executor FROM sessions WHERE name = ?")
      .get(sourceName) as { command: string; executor: string } | undefined;
    const sourceCommand = sourceRow?.command || "claude";
    const sourceExecutor = sourceRow?.executor || "local";

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
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent, executor, mode) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, result.command, sourceName, sourceExecutor, "terminal");

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

  /** Attach a user's WebSocket to a session's terminal */
  attachSession(name: string, userWs: import("ws").WebSocket): void {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    exec.attachSession(name, userWs);
  }

  /** List registered executors */
  listExecutors(): ExecutorInfo[] {
    const executors: ExecutorInfo[] = [];
    if (this.localExecutor) {
      executors.push({ id: "local", name: "local", labels: [], status: "online", last_seen: Math.floor(Date.now() / 1000) });
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

  getMode(name: string): "terminal" | "rich" {
    const row = this.db.prepare("SELECT mode FROM sessions WHERE name = ?").get(name) as
      | { mode: string }
      | undefined;
    return (row?.mode as "terminal" | "rich") || "terminal";
  }

  // --- Private helpers ---

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
const SCHEMA_VERSION = 7; // bump to force re-creation after class changes
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
