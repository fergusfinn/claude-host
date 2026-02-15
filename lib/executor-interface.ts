/**
 * RemoteExecutor: RPC over WebSocket to a connected executor process.
 *
 * All executors (including the locally-spawned one) use this single codepath.
 * Terminal vs Rich sessions still have parallel methods, but the local-vs-remote
 * axis of duplication is eliminated.
 */

import type { WebSocket } from "ws";
import type {
  ExecutorInterface,
  CreateSessionOpts,
  CreateJobOpts,
  ForkSessionOpts,
  CreateRichSessionOpts,
  SessionLiveness,
  SessionAnalysis,
} from "../shared/types";
import type { ExecutorRegistry } from "./executor-registry";
import { rpcId, type AttachRichSessionRpc, type ControlToExecutorMessage } from "../shared/protocol";

export class RemoteExecutor implements ExecutorInterface {
  constructor(
    private executorId: string,
    private registry: ExecutorRegistry,
  ) {}

  async createSession(opts: CreateSessionOpts): Promise<{ name: string; command: string }> {
    return this.rpc("create_session", { opts });
  }

  async createRichSession(opts: CreateRichSessionOpts): Promise<{ name: string; command: string }> {
    return this.rpc("create_rich_session", { opts });
  }

  async createJob(opts: CreateJobOpts): Promise<{ name: string; command: string }> {
    return this.rpc("create_job", { opts });
  }

  async deleteSession(name: string): Promise<void> {
    await this.rpc("delete_session", { name });
  }

  async deleteRichSession(name: string): Promise<void> {
    await this.rpc("delete_rich_session", { name });
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

  async snapshotRichSession(name: string): Promise<string> {
    return this.rpc("snapshot_rich_session", { name });
  }

  async summarizeSession(name: string): Promise<string> {
    return this.rpc("summarize_session", { name });
  }

  async analyzeSession(name: string): Promise<SessionAnalysis> {
    return this.rpc("analyze_session", { name });
  }

  // PARALLEL: rich equivalent is attachRichSession() below — nearly identical WS bridging
  // logic. Changes to channel setup, buffering, or cleanup should be applied to both.
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
      // Bridge user WS <-> executor terminal WS
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
        try { executorWs.close(); } catch (e) { console.warn("failed to close executor ws", e); }
        try { userWs.close(); } catch (e) { console.warn("failed to close user ws", e); }
      };
      userWs.on("close", cleanup);
      userWs.on("error", cleanup);
      executorWs.on("close", cleanup);
      executorWs.on("error", cleanup);
    }).catch(() => {
      userWs.send("\r\n[error: failed to connect to executor]\r\n");
      userWs.close();
    });
  }

  // PARALLEL: terminal equivalent is attachSession() above — nearly identical WS bridging
  // logic. Changes to channel setup, buffering, or cleanup should be applied to both.
  attachRichSession(name: string, command: string, userWs: WebSocket): void {
    const channelId = rpcId();

    const channelPromise = this.registry.waitForTerminalChannel(channelId, 10000);

    const attachMsg: AttachRichSessionRpc = {
      type: "attach_rich_session",
      id: rpcId(),
      channelId,
      sessionName: name,
      command,
    };
    this.registry.sendToExecutor(this.executorId, attachMsg);

    const pendingMessages: string[] = [];
    userWs.on("message", (data) => {
      pendingMessages.push(data.toString());
    });

    channelPromise.then((executorWs) => {
      userWs.removeAllListeners("message");

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
        try { executorWs.close(); } catch (e) { console.warn("failed to close executor ws", e); }
        try { userWs.close(); } catch (e) { console.warn("failed to close user ws", e); }
      };
      userWs.on("close", cleanup);
      userWs.on("error", cleanup);
      executorWs.on("close", cleanup);
      executorWs.on("error", cleanup);
    }).catch(() => {
      userWs.send(JSON.stringify({ type: "error", message: "Failed to connect to executor" }));
      userWs.close();
    });
  }

  private async rpc<T>(type: string, params: Record<string, unknown>): Promise<T> {
    const id = rpcId();
    return this.registry.sendRpc<T>(this.executorId, { type, id, ...params } as ControlToExecutorMessage);
  }
}
