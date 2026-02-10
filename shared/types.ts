import type { WebSocket } from "ws";

// --- Session types ---

export interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
  mode: "terminal" | "rich";
  parent: string | null;
  executor: string; // "local" or executor ID
  last_activity: number; // unix timestamp (seconds)
  alive: boolean;
  job_prompt: string | null;
  job_max_iterations: number | null;
  needs_input: boolean;
}

export interface CreateSessionOpts {
  name: string;
  description?: string;
  command?: string;
}

export interface CreateJobOpts {
  name: string;
  prompt: string;
  maxIterations: number;
  command?: string;
}

export interface ForkSessionOpts {
  sourceName: string;
  newName: string;
  sourceCommand: string;
  sourceCwd: string | null;
  forkHooks: Record<string, string>;
}

export interface SessionLiveness {
  name: string;
  alive: boolean;
  last_activity: number;
}

// --- Executor types ---

export interface ExecutorInfo {
  id: string;
  name: string;
  labels: string[];
  status: "online" | "offline";
  last_seen: number; // unix timestamp (seconds)
  sessionCount?: number;
  version?: string;
}

// --- Executor interface ---
//
// IMPORTANT: Terminal and Rich sessions have parallel codepaths throughout
// the codebase. When modifying any terminal method, check if the corresponding
// rich method needs the same change (and vice versa). The pairs are:
//
//   createSession        <-> createRichSession
//   deleteSession        <-> deleteRichSession
//   snapshotSession      <-> snapshotRichSession
//   attachSession        <-> attachRichSession
//
// Each pair has implementations in:
//   - TmuxRunner          (executor/tmux-runner.ts)   — tmux subprocess operations
//   - LocalExecutor       (lib/executor-interface.ts) — delegates to TmuxRunner + bridge
//   - RemoteExecutor      (lib/executor-interface.ts) — RPC over WebSocket to executor
//   - SessionManager      (lib/sessions.ts)           — DB + routing to executor
//   - server.ts           — WebSocket upgrade handlers (/ws/sessions vs /ws/rich)
//
// Additionally, local vs remote is a second axis of duplication. When changing
// LocalExecutor, check if RemoteExecutor needs the same change.

export interface SessionAnalysis {
  description: string;
  needs_input: boolean;
}

export interface CreateRichSessionOpts {
  name: string;
  command?: string;
}

export interface ExecutorInterface {
  // Terminal session methods — see rich counterparts below
  createSession(opts: CreateSessionOpts): Promise<{ name: string; command: string }>;
  deleteSession(name: string): Promise<void>;
  snapshotSession(name: string, lines?: number): Promise<string>;
  attachSession(name: string, userWs: WebSocket, cols?: number, rows?: number): void;

  // Rich session methods — parallel to terminal methods above
  createRichSession(opts: CreateRichSessionOpts): Promise<{ name: string; command: string }>;
  deleteRichSession(name: string): Promise<void>;
  snapshotRichSession(name: string): Promise<string>;
  attachRichSession(name: string, command: string, userWs: WebSocket): void;

  // Terminal-only methods (no rich equivalent)
  forkSession(opts: ForkSessionOpts): Promise<{ name: string; command: string }>;
  listSessions(): Promise<SessionLiveness[]>;
  summarizeSession(name: string): Promise<string>;
  analyzeSession(name: string): Promise<SessionAnalysis>;
  createJob(opts: CreateJobOpts): Promise<{ name: string; command: string }>;
}
