/**
 * ExecutorInterface implementations:
 * - LocalExecutor: direct tmux calls via TmuxRunner (single-machine use)
 * - RemoteExecutor: RPC over WebSocket to a connected executor process
 */

import type { WebSocket } from "ws";
import type {
  ExecutorInterface,
  CreateSessionOpts,
  CreateJobOpts,
  ForkSessionOpts,
  SessionLiveness,
  SessionAnalysis,
} from "../shared/types";
import { TmuxRunner } from "../executor/tmux-runner";
import { bridgeSession } from "./pty-bridge";

// --- LocalExecutor ---

export class LocalExecutor implements ExecutorInterface {
  private runner = new TmuxRunner();

  async createSession(opts: CreateSessionOpts): Promise<{ name: string; command: string }> {
    return this.runner.createSession(opts);
  }

  async createJob(opts: CreateJobOpts): Promise<{ name: string; command: string }> {
    return this.runner.createJob(opts);
  }

  async deleteSession(name: string): Promise<void> {
    this.runner.deleteSession(name);
  }

  async forkSession(opts: ForkSessionOpts): Promise<{ name: string; command: string }> {
    return this.runner.forkSession(opts);
  }

  async listSessions(): Promise<SessionLiveness[]> {
    return this.runner.listSessions();
  }

  async snapshotSession(name: string, lines?: number): Promise<string> {
    return this.runner.snapshotSession(name, lines);
  }

  async summarizeSession(name: string): Promise<string> {
    return this.runner.summarizeSession(name);
  }

  async analyzeSession(name: string): Promise<SessionAnalysis> {
    return this.runner.analyzeSession(name);
  }

  attachSession(name: string, userWs: WebSocket, cols?: number, rows?: number): void {
    bridgeSession(userWs, name, cols, rows);
  }

  // Expose runner for direct tmux checks (used by SessionManager)
  tmuxExists(name: string): boolean {
    return this.runner.tmuxExists(name);
  }

  getPaneActivity(name: string): number {
    return this.runner.getPaneActivity(name);
  }

  getPaneCwd(name: string): string | null {
    return this.runner.getPaneCwd(name);
  }
}

// --- RemoteExecutor ---

import type { ExecutorRegistry } from "./executor-registry";
import { rpcId } from "../shared/protocol";

export class RemoteExecutor implements ExecutorInterface {
  constructor(
    private executorId: string,
    private registry: ExecutorRegistry,
  ) {}

  async createSession(opts: CreateSessionOpts): Promise<{ name: string; command: string }> {
    return this.rpc("create_session", { opts });
  }

  async createJob(opts: CreateJobOpts): Promise<{ name: string; command: string }> {
    return this.rpc("create_job", { opts });
  }

  async deleteSession(name: string): Promise<void> {
    await this.rpc("delete_session", { name });
  }

  async forkSession(opts: ForkSessionOpts): Promise<{ name: string; command: string }> {
    return this.rpc("fork_session", { opts });
  }

  async listSessions(): Promise<SessionLiveness[]> {
    return this.rpc("list_sessions", {});
  }

  async snapshotSession(name: string, lines?: number): Promise<string> {
    return this.rpc("snapshot_session", { name, lines });
  }

  async summarizeSession(name: string): Promise<string> {
    return this.rpc("summarize_session", { name });
  }

  async analyzeSession(name: string): Promise<SessionAnalysis> {
    return this.rpc("analyze_session", { name });
  }

  attachSession(name: string, userWs: WebSocket, _cols?: number, _rows?: number): void {
    const channelId = rpcId();

    // Wait for executor to open terminal channel, then bridge
    const channelPromise = this.registry.waitForTerminalChannel(channelId, 10000);

    // Send attach RPC to executor
    this.registry.sendToExecutor(this.executorId, {
      type: "attach_session",
      id: rpcId(),
      channelId,
      sessionName: name,
    });

    // Buffer user messages until the terminal channel is ready,
    // so the initial resize isn't lost during channel setup.
    const pendingMessages: string[] = [];
    userWs.on("message", (data) => {
      pendingMessages.push(data.toString());
    });

    channelPromise.then((executorWs) => {
      // Bridge user WS ↔ executor terminal WS
      // Force string encoding: ws library delivers Buffer by default,
      // but browser xterm expects text frames for terminal data.
      userWs.removeAllListeners("message");

      // Replay any messages buffered during channel setup (e.g. initial resize)
      for (const msg of pendingMessages) {
        if (executorWs.readyState === executorWs.OPEN) executorWs.send(msg);
      }
      pendingMessages.length = 0;

      userWs.on("message", (data) => {
        if (executorWs.readyState === executorWs.OPEN) executorWs.send(data.toString());
      });
      executorWs.on("message", (data) => {
        if (userWs.readyState === userWs.OPEN) userWs.send(data.toString());
      });

      const cleanup = () => {
        try { executorWs.close(); } catch {}
        try { userWs.close(); } catch {}
      };
      userWs.on("close", cleanup);
      userWs.on("error", cleanup);
      executorWs.on("close", cleanup);
      executorWs.on("error", cleanup);
    }).catch(() => {
      userWs.send("\r\n[error: failed to connect to remote executor]\r\n");
      userWs.close();
    });
  }

  private async rpc<T>(type: string, params: Record<string, unknown>): Promise<T> {
    const id = rpcId();
    return this.registry.sendRpc<T>(this.executorId, { type, id, ...params } as any);
  }
}
