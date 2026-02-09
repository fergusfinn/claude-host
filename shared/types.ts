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
}

// --- Executor interface ---

export interface SessionAnalysis {
  description: string;
  needs_input: boolean;
}

export interface ExecutorInterface {
  createSession(opts: CreateSessionOpts): Promise<{ name: string; command: string }>;
  deleteSession(name: string): Promise<void>;
  forkSession(opts: ForkSessionOpts): Promise<{ name: string; command: string }>;
  listSessions(): Promise<SessionLiveness[]>;
  snapshotSession(name: string, lines?: number): Promise<string>;
  summarizeSession(name: string): Promise<string>;
  analyzeSession(name: string): Promise<SessionAnalysis>;
  createJob(opts: CreateJobOpts): Promise<{ name: string; command: string }>;
  attachSession(name: string, userWs: WebSocket): void;
}
