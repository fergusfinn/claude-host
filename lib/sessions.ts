import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { Session, ExecutorInfo, SessionLiveness, RichProvider } from "../shared/types";
import { generateName } from "./names";
import { DEFAULT_COMMAND } from "../shared/constants";

export interface ExecutorKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  expires_at: number | null;
  last_used: number | null;
  revoked: boolean;
}

export type { Session };

class SessionManager {
  private db: Database.Database;
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
    // Migration: add user_id to sessions
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT NULL`);
    } catch {
      // Column already exists
    }
    // Migration: add user_id to executors
    try {
      this.db.exec(`ALTER TABLE executors ADD COLUMN user_id TEXT DEFAULT NULL`);
    } catch {
      // Column already exists
    }
    // Migration: per-user config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_config (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `);
    // Migration: add provider column for rich session backend (claude vs codex)
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'`);
    } catch {
      // Column already exists
    }
    // Executor keys table for per-user executor authentication
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executor_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used INTEGER,
        revoked INTEGER DEFAULT 0
      )
    `);
  }

  /** Assign all unowned sessions/executors to the given user (first-login migration) */
  adoptUnownedResources(userId: string): void {
    this.db.prepare("UPDATE sessions SET user_id = ? WHERE user_id IS NULL").run(userId);
    this.db.prepare("UPDATE executors SET user_id = ? WHERE user_id IS NULL").run(userId);
    // Migrate global config to per-user config
    const globalRows = this.db.prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
    if (globalRows.length > 0) {
      const insert = this.db.prepare("INSERT OR IGNORE INTO user_config (user_id, key, value) VALUES (?, ?, ?)");
      for (const row of globalRows) {
        insert.run(userId, row.key, row.value);
      }
    }
  }

  // --- Executor key management ---

  /** Generate a new executor key. Returns the raw token (shown only once). */
  createExecutorKey(userId: string, name: string, expiresAt: number | null): { id: string; token: string; key_prefix: string } {
    const id = randomUUID();
    const raw = randomBytes(32).toString("hex");
    const token = `chk_${raw}`;
    const keyPrefix = raw.slice(0, 8);
    const keyHash = createHash("sha256").update(token).digest("hex");
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(
      "INSERT INTO executor_keys (id, user_id, name, key_hash, key_prefix, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, userId, name, keyHash, keyPrefix, now, expiresAt);

    return { id, token, key_prefix: keyPrefix };
  }

  /** Validate an executor token. Returns user info if valid, null otherwise. */
  validateExecutorKey(rawToken: string): { userId: string; keyId: string } | null {
    if (!rawToken.startsWith("chk_")) return null;
    const prefix = rawToken.slice(4, 12);
    const hash = createHash("sha256").update(rawToken).digest("hex");
    const now = Math.floor(Date.now() / 1000);

    const rows = this.db.prepare(
      "SELECT id, user_id, key_hash, expires_at, revoked FROM executor_keys WHERE key_prefix = ?"
    ).all(prefix) as Array<{ id: string; user_id: string; key_hash: string; expires_at: number | null; revoked: number }>;

    for (const row of rows) {
      if (row.revoked) continue;
      if (row.expires_at && row.expires_at < now) continue;
      if (timingSafeEqual(Buffer.from(row.key_hash), Buffer.from(hash))) {
        this.db.prepare("UPDATE executor_keys SET last_used = ? WHERE id = ?").run(now, row.id);
        return { userId: row.user_id, keyId: row.id };
      }
    }
    return null;
  }

  /** List all executor keys for a user. */
  listExecutorKeys(userId: string): ExecutorKeyInfo[] {
    const rows = this.db.prepare(
      "SELECT id, name, key_prefix, created_at, expires_at, last_used, revoked FROM executor_keys WHERE user_id = ? ORDER BY created_at DESC"
    ).all(userId) as Array<{ id: string; name: string; key_prefix: string; created_at: number; expires_at: number | null; last_used: number | null; revoked: number }>;

    return rows.map((r) => ({ ...r, revoked: !!r.revoked }));
  }

  /** Revoke an executor key. */
  revokeExecutorKey(userId: string, keyId: string): boolean {
    const result = this.db.prepare(
      "UPDATE executor_keys SET revoked = 1 WHERE id = ? AND user_id = ?"
    ).run(keyId, userId);
    return result.changes > 0;
  }

  /** Check if a session belongs to a user */
  isOwnedBy(name: string, userId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM sessions WHERE name = ? AND user_id = ?").get(name, userId);
    return !!row;
  }

  /** Set the executor registry (called by server.ts after startup) */
  setRegistry(registry: import("./executor-registry").ExecutorRegistry): void {
    this._registry = registry;
  }

  get registry() {
    return this._registry;
  }

  // NOTE: Liveness logic differs by mode. Two cases:
  //   rich     — always alive (rich tmux sessions are lazily created, filtered from heartbeat)
  //   terminal — heartbeat-cached liveness from ExecutorRegistry
  list(userId: string): Session[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY position ASC, created_at DESC")
      .all(userId) as any[];
    const alive: Session[] = [];
    const deadNames: string[] = [];
    for (const row of rows) {
      const executor = row.executor || "local";
      const mode = row.mode || "terminal";
      const provider = (row.provider || "claude") as RichProvider;

      // Rich sessions — always alive (tmux session is lazily created)
      if (mode === "rich") {
        alive.push({
          ...row,
          mode,
          provider,
          parent: row.parent || null,
          executor,
          last_activity: row.last_activity || Math.floor(new Date(row.created_at).getTime() / 1000),
          alive: true,
          job_prompt: row.job_prompt || null,
          job_max_iterations: row.job_max_iterations || null,
          needs_input: false,
        });
        continue;
      }

      // Terminal sessions — use heartbeat-cached liveness data
      const liveness = this._registry?.getSessionLiveness(executor, row.name);
      if (liveness) {
        alive.push({
          ...row,
          provider,
          parent: row.parent || null,
          executor,
          last_activity: liveness.last_activity,
          alive: liveness.alive,
          job_prompt: row.job_prompt || null,
          job_max_iterations: row.job_max_iterations || null,
          needs_input: false,
        });
      } else {
        // Executor offline or session not reported
        const executorOnline = this._registry?.isExecutorOnline(executor) ?? false;
        if (!executorOnline) {
          alive.push({
            ...row,
            provider,
            parent: row.parent || null,
            executor,
            last_activity: 0,
            alive: false,
            job_prompt: row.job_prompt || null,
            job_max_iterations: row.job_max_iterations || null,
            needs_input: false,
          });
        } else {
          // Executor online but session not in heartbeat yet — grace period
          const createdAt = new Date(row.created_at).getTime();
          const ageMs = Date.now() - createdAt;
          if (ageMs > 60_000) {
            deadNames.push(row.name);
          } else {
            alive.push({
              ...row,
              provider,
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
    // Auto-cleanup dead sessions from DB
    if (deadNames.length > 0) {
      const del = this.db.prepare("DELETE FROM sessions WHERE name = ?");
      for (const name of deadNames) del.run(name);
    }
    return alive;
  }

  // NOTE: Branches on mode (terminal vs rich) — changes to one branch likely
  // need mirroring in the other. Also see createJob() (terminal-only).
  async create(description = "", command = "claude", executor = "local", mode: "terminal" | "rich" = "terminal", userId: string = "local", provider: RichProvider = "claude"): Promise<Session> {
    const name = this.uniqueName();

    // Inject theme settings for claude commands
    let finalCommand = command;
    if (command.split(/\s+/)[0] === "claude") {
      finalCommand = `${command} ${this.getClaudeThemeArg()}`;
    }

    if (mode === "rich") {
      const exec = this.getExecutor(executor);
      await exec.createRichSession({ name, command: finalCommand, provider });

      this.db
        .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, mode, provider, position, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(name, description, finalCommand, executor, "rich", provider, this.nextPosition(), userId);

      return {
        name,
        description,
        command: finalCommand,
        mode: "rich",
        provider,
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
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, position, user_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, description, result.command, executor, this.nextPosition(), userId);

    return {
      name,
      description,
      command: result.command,
      mode: "terminal",
      provider: "claude",
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

  async createJob(prompt: string, maxIterations = 50, executor = "local", skipPermissions = true, userId: string = "local"): Promise<Session> {
    const name = this.uniqueName();

    let command = skipPermissions ? DEFAULT_COMMAND : "claude";
    command = `${command} ${this.getClaudeThemeArg()}`;
    const exec = this.getExecutor(executor);

    await exec.createJob({ name, prompt, maxIterations, command });

    // Insert into DB with job fields
    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, executor, job_prompt, job_max_iterations, position, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(name, prompt.slice(0, 200), command, executor, prompt, maxIterations, this.nextPosition(), userId);

    return {
      name,
      description: prompt.slice(0, 200),
      command,
      mode: "terminal" as const,
      provider: "claude" as const,
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

  async delete(name: string, userId: string): Promise<void> {
    if (!this.isOwnedBy(name, userId)) throw new Error("Not found");
    const mode = this.getMode(name);
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    if (mode === "rich") {
      await exec.deleteRichSession(name);
    } else {
      await exec.deleteSession(name);
    }
    this.db.prepare("DELETE FROM sessions WHERE name = ? AND user_id = ?").run(name, userId);
  }

  getConfig(key: string, userId: string): string | null {
    const row = this.db.prepare("SELECT value FROM user_config WHERE key = ? AND user_id = ?").get(key, userId) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string, userId: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO user_config (user_id, key, value) VALUES (?, ?, ?)")
      .run(userId, key, value);
  }

  getAllConfig(userId: string): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM user_config WHERE user_id = ?").all(userId) as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async snapshot(name: string, userId: string): Promise<string> {
    if (!this.isOwnedBy(name, userId)) throw new Error("Not found");
    const mode = this.getMode(name);
    const exec = this.getExecutor(this.getSessionExecutorId(name));
    if (mode === "rich") return exec.snapshotRichSession(name);
    return exec.snapshotSession(name);
  }

  async summarize(name: string, userId: string): Promise<string> {
    if (!this.isOwnedBy(name, userId)) throw new Error("Not found");
    const mode = this.getMode(name);
    const exec = this.getExecutor(this.getSessionExecutorId(name));

    let snapshotText: string;
    try {
      snapshotText = mode === "rich"
        ? await exec.snapshotRichSession(name)
        : await exec.snapshotSession(name, 200);
    } catch {
      return "";
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

  /** Get configured fork hooks: command prefix -> hook script path */
  getForkHooks(userId: string): Record<string, string> {
    const raw = this.getConfig("forkHooks", userId);
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

  setForkHooks(hooks: Record<string, string>, userId: string): void {
    this.setConfig("forkHooks", JSON.stringify(hooks), userId);
  }

  // NOTE: Branches on mode (terminal vs rich). Rich fork is handled by
  // forkRichSession() below — different lifecycle (lazy tmux, no immediate spawn).
  async fork(sourceName: string, userId: string = "local"): Promise<Session> {
    if (!this.isOwnedBy(sourceName, userId)) throw new Error("Not found");
    const newName = this.uniqueName();

    // Get source session info from DB
    const sourceRow = this.db
      .prepare("SELECT command, executor, mode, provider FROM sessions WHERE name = ?")
      .get(sourceName) as { command: string; executor: string; mode: string; provider: string } | undefined;
    const sourceCommand = sourceRow?.command || "claude";
    const sourceExecutor = sourceRow?.executor || "local";
    const sourceMode = (sourceRow?.mode || "terminal") as "terminal" | "rich";
    const sourceProvider = (sourceRow?.provider || "claude") as RichProvider;

    if (sourceMode === "rich") {
      return this.forkRichSession(sourceName, newName, sourceCommand, sourceExecutor, userId, sourceProvider);
    }

    // Fork targets the same executor as the source
    const exec = this.getExecutor(sourceExecutor);

    const hooks = this.getForkHooks(userId);
    const result = await exec.forkSession({
      sourceName,
      newName,
      sourceCommand,
      sourceCwd: null, // TmuxRunner resolves CWD from the source tmux pane
      forkHooks: hooks,
    });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent, executor, mode, position, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, result.command, sourceName, sourceExecutor, "terminal", this.nextPosition(), userId);

    return {
      name: newName,
      description: `forked from ${sourceName}`,
      command: result.command,
      mode: "terminal" as const,
      provider: "claude" as const,
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

  private async forkRichSession(sourceName: string, newName: string, sourceCommand: string, sourceExecutor: string, userId: string, provider: RichProvider = "claude"): Promise<Session> {
    // Get the Claude session_id from events.ndjson
    const sessionId = this.getRichSessionId(sourceName);

    if (!sessionId) {
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

    const forkCommand = `${cleanCommand} --resume ${sessionId} --fork-session`;

    // Create runtime directory for the new rich session
    const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
    mkdirSync(join(dataDir, "rich", newName), { recursive: true });

    this.db
      .prepare("INSERT OR REPLACE INTO sessions (name, description, command, parent, executor, mode, provider, position, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(newName, `forked from ${sourceName}`, forkCommand, sourceName, sourceExecutor, "rich", provider, this.nextPosition(), userId);

    return {
      name: newName,
      description: `forked from ${sourceName}`,
      command: forkCommand,
      mode: "rich" as const,
      provider,
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

  // PARALLEL: rich equivalent is attachRichSession() below.
  /** Attach a user's WebSocket to a session's terminal */
  attachSession(name: string, userWs: import("ws").WebSocket, cols?: number, rows?: number): void {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    exec.attachSession(name, userWs, cols, rows);
  }

  // PARALLEL: terminal equivalent is attachSession() above.
  /** Attach a user's WebSocket to a rich session */
  attachRichSession(name: string, userWs: import("ws").WebSocket): void {
    const executor = this.getSessionExecutorId(name);
    const exec = this.getExecutor(executor);
    const command = this.getCommand(name);
    const provider = this.getProvider(name);
    exec.attachRichSession(name, command, userWs, provider);
  }

  /** Diagnose a rich session via its executor */
  async diagnoseSession(name: string): Promise<{ error?: string; [key: string]: unknown }> {
    const executor = this.getSessionExecutorId(name);
    if (!this._registry) {
      return { error: "No executor registry available" };
    }
    const { rpcId } = await import("../shared/protocol");
    return this._registry.sendRpc(executor, {
      type: "diagnose_rich_session",
      id: rpcId(),
      name,
    });
  }

  /** List registered executors */
  listExecutors(userId: string): ExecutorInfo[] {
    if (!this._registry) return [];
    return this._registry.listExecutorsForUser(userId);
  }

  /** Update executor info in DB (called by registry on register/heartbeat) */
  upsertExecutor(info: { id: string; name: string; labels: string[]; status: string; userId?: string }): void {
    this.db
      .prepare("INSERT OR REPLACE INTO executors (id, name, labels, status, last_seen, user_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(info.id, info.name, JSON.stringify(info.labels), info.status, Math.floor(Date.now() / 1000), info.userId ?? null);
  }

  /** Adopt sessions reported by a remote executor that don't exist in the DB */
  adoptOrphanedSessions(executorId: string, sessions: SessionLiveness[]): void {
    // Assign to the user who already owns sessions on this executor (i.e. the
    // admin who set it up).  When auth is disabled the owner will be "local".
    // If no match yet (first heartbeat before any sessions created), leave NULL
    // — adoptUnownedResources() will assign them on the admin's next login.
    const ownerRow = this.db.prepare(
      "SELECT user_id FROM sessions WHERE executor = ? AND user_id IS NOT NULL LIMIT 1"
    ).get(executorId) as { user_id: string } | undefined;

    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO sessions (name, description, command, executor, position, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const s of sessions) {
      if (s.name.startsWith("rich-")) continue; // internal rich-mode tmux sessions
      insert.run(s.name, "", "claude", executorId, this.nextPosition(), ownerRow?.user_id ?? null);
    }
  }

  /** Reorder sessions: accepts an ordered array of session names */
  reorder(names: string[], userId: string): void {
    const stmt = this.db.prepare("UPDATE sessions SET position = ? WHERE name = ? AND user_id = ?");
    const tx = this.db.transaction(() => {
      for (let i = 0; i < names.length; i++) {
        stmt.run(i, names[i], userId);
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

  getProvider(name: string): RichProvider {
    const row = this.db.prepare("SELECT provider FROM sessions WHERE name = ?").get(name) as
      | { provider: string }
      | undefined;
    return (row?.provider as RichProvider) || "claude";
  }

  // --- Private helpers ---

  /** Extract session_id from a rich session's events.ndjson file */
  private getRichSessionId(name: string): string | null {
    const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
    const eventsFile = join(dataDir, "rich", name, "events.ndjson");
    if (!existsSync(eventsFile)) return null;
    try {
      const content = readFileSync(eventsFile, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.session_id) return event.session_id;
        } catch {}
      }
    } catch {}
    return null;
  }

  /** Generate a unique slug, retrying on collision */
  private uniqueName(): string {
    for (let i = 0; i < 10; i++) {
      const name = generateName();
      const exists = this.db.prepare("SELECT 1 FROM sessions WHERE name = ?").get(name);
      if (!exists) return name;
    }
    // Fallback: append timestamp
    return `${generateName()}-${Date.now()}`;
  }

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
    if (!this._registry) throw new Error("No executor registry available");
    return this._registry.getRemoteExecutor(id);
  }
}

// Singleton — survives Next.js hot reloads in dev
const SCHEMA_VERSION = 12; // bump to force re-creation after class changes
const globalForSessions = globalThis as unknown as {
  __sessions?: SessionManager;
  __sessionsVersion?: number;
};

export function getSessionManager(): SessionManager {
  if (!globalForSessions.__sessions || globalForSessions.__sessionsVersion !== SCHEMA_VERSION) {
    const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
    const dbPath = join(dataDir, "sessions.db");
    globalForSessions.__sessions = new SessionManager(dbPath);
    globalForSessions.__sessionsVersion = SCHEMA_VERSION;
  }
  return globalForSessions.__sessions;
}
