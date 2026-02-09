// WS protocol message types between executor and control plane

import type { SessionLiveness, CreateSessionOpts, CreateJobOpts, ForkSessionOpts } from "./types";

// --- Executor → Control Plane ---

export interface RegisterMessage {
  type: "register";
  executorId: string;
  name: string;
  labels: string[];
  version?: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
  sessions: SessionLiveness[];
}

export interface ResponseMessage {
  type: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ExecutorToControlMessage = RegisterMessage | HeartbeatMessage | ResponseMessage;

// --- Control Plane → Executor ---

export interface CreateSessionRpc {
  type: "create_session";
  id: string;
  opts: CreateSessionOpts;
}

export interface CreateJobRpc {
  type: "create_job";
  id: string;
  opts: CreateJobOpts;
}

export interface DeleteSessionRpc {
  type: "delete_session";
  id: string;
  name: string;
}

export interface ForkSessionRpc {
  type: "fork_session";
  id: string;
  opts: ForkSessionOpts;
}

export interface ListSessionsRpc {
  type: "list_sessions";
  id: string;
}

export interface SnapshotSessionRpc {
  type: "snapshot_session";
  id: string;
  name: string;
  lines?: number;
}

export interface SummarizeSessionRpc {
  type: "summarize_session";
  id: string;
  name: string;
}

export interface AnalyzeSessionRpc {
  type: "analyze_session";
  id: string;
  name: string;
}

export interface AttachSessionRpc {
  type: "attach_session";
  id: string;
  channelId: string;
  sessionName: string;
}

export interface PingMessage {
  type: "ping";
  id: string;
}

export interface UpgradeMessage {
  type: "upgrade";
  reason?: string;
}

export type ControlToExecutorMessage =
  | CreateSessionRpc
  | CreateJobRpc
  | DeleteSessionRpc
  | ForkSessionRpc
  | ListSessionsRpc
  | SnapshotSessionRpc
  | SummarizeSessionRpc
  | AnalyzeSessionRpc
  | AttachSessionRpc
  | PingMessage
  | UpgradeMessage;

// --- Helpers ---

let _counter = 0;

export function rpcId(): string {
  return `rpc_${Date.now()}_${++_counter}`;
}

export function parseMessage(raw: string): ExecutorToControlMessage | ControlToExecutorMessage | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
