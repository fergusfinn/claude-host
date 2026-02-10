/**
 * ExecutorRegistry: tracks connected remote executors, manages RPC,
 * and handles terminal channel resolution.
 */

import type { WebSocket } from "ws";
import type { ExecutorInfo, SessionLiveness } from "../shared/types";
import type {
  ExecutorToControlMessage,
  ControlToExecutorMessage,
  RegisterMessage,
  HeartbeatMessage,
  ResponseMessage,
  UpgradeMessage,
} from "../shared/protocol";
import { RemoteExecutor } from "./executor-interface";

interface ConnectedExecutor {
  ws: WebSocket;
  info: ExecutorInfo;
  sessions: SessionLiveness[];
}

interface PendingRpc {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ExecutorLogEntry {
  timestamp: number;
  executorId: string;
  event: string;
  detail?: string;
}

const RPC_TIMEOUT = 30000; // 30s
const HEARTBEAT_TIMEOUT = 45000; // 45s — mark offline after this
const MAX_LOG_ENTRIES = 200;

export class ExecutorRegistry {
  private executors = new Map<string, ConnectedExecutor>();
  private pendingRpcs = new Map<string, PendingRpc>();
  private pendingChannels = new Map<string, {
    resolve: (ws: WebSocket) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private healthCheckInterval: ReturnType<typeof setInterval>;
  private logs: ExecutorLogEntry[] = [];

  constructor(
    private onExecutorChange?: (id: string, status: "online" | "offline") => void,
    private onHeartbeat?: (executorId: string, sessions: SessionLiveness[]) => void,
  ) {
    // Periodically check for stale executors
    this.healthCheckInterval = setInterval(() => this.checkHealth(), 15000);
  }

  destroy(): void {
    clearInterval(this.healthCheckInterval);
    for (const [, pending] of this.pendingRpcs) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Registry shutting down"));
    }
    for (const [, pending] of this.pendingChannels) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Registry shutting down"));
    }
  }

  /** Handle a new executor control channel connection */
  handleControlConnection(ws: WebSocket, token: string): void {
    let executorId: string | null = null;

    ws.on("message", (raw) => {
      let msg: ExecutorToControlMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "register":
          executorId = (msg as RegisterMessage).executorId;
          this.registerExecutor(executorId, ws, msg as RegisterMessage);
          break;
        case "heartbeat":
          if (executorId) this.handleHeartbeat(executorId, msg as HeartbeatMessage);
          break;
        case "response":
          this.handleResponse(msg as ResponseMessage);
          break;
      }
    });

    ws.on("close", () => {
      if (executorId) this.handleDisconnect(executorId);
    });

    ws.on("error", () => {
      if (executorId) this.handleDisconnect(executorId);
    });
  }

  /** Handle a new executor terminal channel connection */
  resolveTerminalChannel(channelId: string, ws: WebSocket): boolean {
    const pending = this.pendingChannels.get(channelId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingChannels.delete(channelId);
    pending.resolve(ws);
    return true;
  }

  /** Wait for an executor to open a terminal channel */
  waitForTerminalChannel(channelId: string, timeoutMs: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingChannels.delete(channelId);
        reject(new Error("Terminal channel connection timed out"));
      }, timeoutMs);

      this.pendingChannels.set(channelId, { resolve, reject, timer });
    });
  }

  /** Send an RPC message to an executor and wait for response */
  sendRpc<T>(executorId: string, message: ControlToExecutorMessage): Promise<T> {
    const executor = this.executors.get(executorId);
    if (!executor) throw new Error(`Executor "${executorId}" not connected`);

    const id = (message as any).id;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcs.delete(id);
        reject(new Error(`RPC timeout for ${message.type} to executor "${executorId}"`));
      }, RPC_TIMEOUT);

      this.pendingRpcs.set(id, { resolve, reject, timer });
      executor.ws.send(JSON.stringify(message));
    });
  }

  /** Send a message to an executor (fire-and-forget) */
  sendToExecutor(executorId: string, message: ControlToExecutorMessage): void {
    const executor = this.executors.get(executorId);
    if (!executor) throw new Error(`Executor "${executorId}" not connected`);
    executor.ws.send(JSON.stringify(message));
  }

  /** Get a RemoteExecutor instance for the given executor ID */
  getRemoteExecutor(executorId: string): RemoteExecutor {
    if (!this.executors.has(executorId)) {
      throw new Error(`Executor "${executorId}" not connected`);
    }
    return new RemoteExecutor(executorId, this);
  }

  /** List all connected executors */
  listExecutors(): ExecutorInfo[] {
    return Array.from(this.executors.values()).map((e) => ({
      ...e.info,
      sessionCount: e.sessions.length,
    }));
  }

  /** Check if an executor is online */
  isExecutorOnline(executorId: string): boolean {
    const executor = this.executors.get(executorId);
    return executor?.info.status === "online";
  }

  /** Send upgrade signal to a single executor */
  upgradeExecutor(executorId: string, opts?: { reason?: string }): void {
    const msg: UpgradeMessage = { type: "upgrade", reason: opts?.reason };
    this.sendToExecutor(executorId, msg);
    this.log(executorId, "upgrade_sent", opts?.reason);
  }

  /** Send upgrade signal to all online executors, returns IDs signalled */
  upgradeAllExecutors(opts?: { reason?: string }): string[] {
    const ids: string[] = [];
    for (const [id, executor] of this.executors) {
      if (executor.info.status === "online") {
        try {
          this.upgradeExecutor(id, opts);
          ids.push(id);
        } catch (e) { console.warn("failed to upgrade executor", e); }
      }
    }
    return ids;
  }

  /** Get recent log entries */
  getLogs(since?: number): ExecutorLogEntry[] {
    if (since) return this.logs.filter((l) => l.timestamp > since);
    return [...this.logs];
  }

  private log(executorId: string, event: string, detail?: string): void {
    const entry: ExecutorLogEntry = {
      timestamp: Date.now(),
      executorId,
      event,
      detail,
    };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(-MAX_LOG_ENTRIES);
    }
  }

  /** Get cached session liveness for a specific session on an executor */
  getSessionLiveness(executorId: string, sessionName: string): SessionLiveness | undefined {
    const executor = this.executors.get(executorId);
    if (!executor) return undefined;
    return executor.sessions.find((s) => s.name === sessionName);
  }

  // --- Private ---

  private registerExecutor(id: string, ws: WebSocket, msg: RegisterMessage): void {
    this.executors.set(id, {
      ws,
      info: {
        id,
        name: msg.name,
        labels: msg.labels,
        status: "online",
        last_seen: Math.floor(Date.now() / 1000),
        version: msg.version,
      },
      sessions: [],
    });
    this.onExecutorChange?.(id, "online");
    this.log(id, "registered", `${msg.name}${msg.version ? ` v${msg.version}` : ""}`);
    console.log(`Executor registered: ${msg.name} (${id})${msg.version ? ` v${msg.version}` : ""}`);
  }

  private handleHeartbeat(executorId: string, msg: HeartbeatMessage): void {
    const executor = this.executors.get(executorId);
    if (!executor) return;
    executor.info.last_seen = Math.floor(Date.now() / 1000);
    executor.info.status = "online";
    executor.sessions = msg.sessions;
    this.onHeartbeat?.(executorId, msg.sessions);
  }

  private handleResponse(msg: ResponseMessage): void {
    const pending = this.pendingRpcs.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRpcs.delete(msg.id);

    if (msg.ok) {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || "Unknown RPC error"));
    }
  }

  private handleDisconnect(executorId: string): void {
    const executor = this.executors.get(executorId);
    if (executor) {
      executor.info.status = "offline";
      this.onExecutorChange?.(executorId, "offline");
      this.log(executorId, "disconnected", executor.info.name);
      console.log(`Executor disconnected: ${executor.info.name} (${executorId})`);
    }
    this.executors.delete(executorId);
  }

  private checkHealth(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, executor] of this.executors) {
      if (now - executor.info.last_seen > HEARTBEAT_TIMEOUT / 1000) {
        this.log(id, "timed_out", executor.info.name);
        console.log(`Executor timed out: ${executor.info.name} (${id})`);
        this.handleDisconnect(id);
        try { executor.ws.close(); } catch (e) { console.warn("failed to close executor ws", e); }
      }
    }
  }
}
