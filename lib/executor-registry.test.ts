import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExecutorRegistry } from "./executor-registry";
import type { WebSocket } from "ws";

function mockWs(): WebSocket {
  const handlers: Record<string, Function[]> = {};
  return {
    on: vi.fn((event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    }),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // WebSocket.OPEN
    // Helpers for test use
    _emit(event: string, ...args: any[]) {
      for (const h of handlers[event] ?? []) h(...args);
    },
  } as unknown as WebSocket & { _emit: (event: string, ...args: any[]) => void };
}

function registerExecutor(
  registry: ExecutorRegistry,
  ws: ReturnType<typeof mockWs>,
  opts: { id?: string; name?: string; userId?: string; version?: string } = {},
) {
  const id = opts.id ?? "exec-1";
  const name = opts.name ?? "Test Executor";
  const userId = opts.userId ?? "user-1";

  registry.handleControlConnection(ws, userId);
  ws._emit("message", Buffer.from(JSON.stringify({
    type: "register",
    executorId: id,
    name,
    labels: ["test"],
    version: opts.version,
  })));

  return { id, name, userId };
}

describe("ExecutorRegistry", () => {
  let registry: ExecutorRegistry;
  let onExecutorChange: ReturnType<typeof vi.fn>;
  let onHeartbeat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onExecutorChange = vi.fn();
    onHeartbeat = vi.fn();
    registry = new ExecutorRegistry(onExecutorChange, onHeartbeat);
  });

  afterEach(() => {
    registry.destroy();
    vi.useRealTimers();
  });

  describe("registration", () => {
    it("registers an executor and reports it as online", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      expect(onExecutorChange).toHaveBeenCalledWith(id, "online", "user-1");
      expect(registry.isExecutorOnline(id)).toBe(true);

      const list = registry.listExecutors();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(id);
      expect(list[0].name).toBe("Test Executor");
      expect(list[0].status).toBe("online");
    });

    it("includes version in registration", () => {
      const ws = mockWs();
      registerExecutor(registry, ws, { version: "abc123" });

      const list = registry.listExecutors();
      expect(list[0].version).toBe("abc123");
    });

    it("logs the registration event", () => {
      const ws = mockWs();
      registerExecutor(registry, ws);

      const logs = registry.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].event).toBe("registered");
    });
  });

  describe("heartbeat", () => {
    it("updates last_seen and session list on heartbeat", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const sessions = [{ name: "session-1", alive: true, mode: "terminal" as const }];
      ws._emit("message", Buffer.from(JSON.stringify({
        type: "heartbeat",
        sessions,
      })));

      expect(onHeartbeat).toHaveBeenCalledWith(id, sessions);
      const liveness = registry.getSessionLiveness(id, "session-1");
      expect(liveness).toEqual({ name: "session-1", alive: true, mode: "terminal" });
    });

    it("returns undefined for unknown session liveness", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      expect(registry.getSessionLiveness(id, "nonexistent")).toBeUndefined();
    });

    it("returns undefined for unknown executor liveness", () => {
      expect(registry.getSessionLiveness("nonexistent", "session-1")).toBeUndefined();
    });
  });

  describe("disconnect", () => {
    it("marks executor offline on ws close", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      ws._emit("close");

      expect(onExecutorChange).toHaveBeenCalledWith(id, "offline", "user-1");
      expect(registry.isExecutorOnline(id)).toBe(false);
      expect(registry.listExecutors()).toHaveLength(0);
    });

    it("marks executor offline on ws error", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      ws._emit("error", new Error("connection lost"));

      expect(onExecutorChange).toHaveBeenCalledWith(id, "offline", "user-1");
      expect(registry.isExecutorOnline(id)).toBe(false);
    });

    it("logs the disconnect event", () => {
      const ws = mockWs();
      registerExecutor(registry, ws);
      ws._emit("close");

      const logs = registry.getLogs();
      expect(logs.some(l => l.event === "disconnected")).toBe(true);
    });
  });

  describe("health check", () => {
    it("times out stale executors", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      // Advance past HEARTBEAT_TIMEOUT (45s) — health check runs every 15s,
      // so at 60s the check sees last_seen is >45s ago
      vi.advanceTimersByTime(60000);

      expect(registry.isExecutorOnline(id)).toBe(false);
      expect(ws.close).toHaveBeenCalled();
      expect(registry.getLogs().some(l => l.event === "timed_out")).toBe(true);
    });

    it("does not time out executors that send heartbeats", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      // Send heartbeat at 20s
      vi.advanceTimersByTime(20000);
      ws._emit("message", Buffer.from(JSON.stringify({
        type: "heartbeat",
        sessions: [],
      })));

      // Advance another 20s (total 40s from heartbeat, within 45s timeout)
      vi.advanceTimersByTime(20000);

      expect(registry.isExecutorOnline(id)).toBe(true);
    });
  });

  describe("RPC", () => {
    it("sends RPC and resolves on response", async () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const promise = registry.sendRpc(id, {
        type: "ping",
        id: "rpc-1",
      });

      // Simulate response
      ws._emit("message", Buffer.from(JSON.stringify({
        type: "response",
        id: "rpc-1",
        ok: true,
        data: "pong",
      })));

      const result = await promise;
      expect(result).toBe("pong");
    });

    it("rejects on error response", async () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const promise = registry.sendRpc(id, {
        type: "ping",
        id: "rpc-2",
      });

      ws._emit("message", Buffer.from(JSON.stringify({
        type: "response",
        id: "rpc-2",
        ok: false,
        error: "something went wrong",
      })));

      await expect(promise).rejects.toThrow("something went wrong");
    });

    it("times out after 30s", async () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const promise = registry.sendRpc(id, {
        type: "ping",
        id: "rpc-3",
      });

      vi.advanceTimersByTime(31000);

      await expect(promise).rejects.toThrow(/RPC timeout/);
    });

    it("throws for unknown executor", () => {
      expect(() => registry.sendRpc("nonexistent", {
        type: "ping",
        id: "rpc-4",
      })).toThrow(/not connected/);
    });
  });

  describe("sendToExecutor", () => {
    it("sends a message directly", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      registry.sendToExecutor(id, { type: "upgrade", reason: "test" });

      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"upgrade"'));
    });

    it("throws for unknown executor", () => {
      expect(() => registry.sendToExecutor("nonexistent", {
        type: "upgrade",
      })).toThrow(/not connected/);
    });
  });

  describe("terminal channels", () => {
    it("resolves a pending channel", async () => {
      const channelWs = mockWs();
      const promise = registry.waitForTerminalChannel("ch-1", 5000);

      const resolved = registry.resolveTerminalChannel("ch-1", channelWs);
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result).toBe(channelWs);
    });

    it("returns false for unknown channel", () => {
      const ws = mockWs();
      expect(registry.resolveTerminalChannel("nonexistent", ws)).toBe(false);
    });

    it("times out if no channel connects", async () => {
      const promise = registry.waitForTerminalChannel("ch-2", 1000);
      vi.advanceTimersByTime(1500);
      await expect(promise).rejects.toThrow(/timed out/);
    });
  });

  describe("listExecutorsForUser", () => {
    it("filters executors by user", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      registerExecutor(registry, ws1, { id: "exec-1", userId: "user-1" });
      registerExecutor(registry, ws2, { id: "exec-2", userId: "user-2" });

      const user1Execs = registry.listExecutorsForUser("user-1");
      expect(user1Execs).toHaveLength(1);
      expect(user1Execs[0].id).toBe("exec-1");

      const user2Execs = registry.listExecutorsForUser("user-2");
      expect(user2Execs).toHaveLength(1);
      expect(user2Execs[0].id).toBe("exec-2");
    });
  });

  describe("getRemoteExecutor", () => {
    it("returns a RemoteExecutor for connected executor", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const remote = registry.getRemoteExecutor(id);
      expect(remote).toBeDefined();
    });

    it("throws for unknown executor", () => {
      expect(() => registry.getRemoteExecutor("nonexistent")).toThrow(/not connected/);
    });
  });

  describe("upgrade", () => {
    it("sends upgrade to a single executor", () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      registry.upgradeExecutor(id, { reason: "new version" });

      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"upgrade"'));
      expect(registry.getLogs().some(l => l.event === "upgrade_sent")).toBe(true);
    });

    it("upgrades all online executors", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      registerExecutor(registry, ws1, { id: "exec-1" });
      registerExecutor(registry, ws2, { id: "exec-2" });

      const ids = registry.upgradeAllExecutors({ reason: "deploy" });
      expect(ids).toEqual(["exec-1", "exec-2"]);
    });

    it("skips offline executors when upgrading all", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      registerExecutor(registry, ws1, { id: "exec-1" });
      registerExecutor(registry, ws2, { id: "exec-2" });

      // Disconnect exec-2
      ws2._emit("close");

      const ids = registry.upgradeAllExecutors();
      expect(ids).toEqual(["exec-1"]);
    });
  });

  describe("logs", () => {
    it("filters logs by timestamp", () => {
      const ws = mockWs();
      registerExecutor(registry, ws);

      const after = Date.now() + 1;
      vi.advanceTimersByTime(100);

      ws._emit("close");

      const recentLogs = registry.getLogs(after);
      expect(recentLogs).toHaveLength(1);
      expect(recentLogs[0].event).toBe("disconnected");
    });

    it("caps logs at MAX_LOG_ENTRIES", () => {
      const ws = mockWs();
      // Generate many events by connecting/disconnecting repeatedly
      for (let i = 0; i < 250; i++) {
        registerExecutor(registry, ws, { id: `exec-${i}` });
      }

      const logs = registry.getLogs();
      expect(logs.length).toBeLessThanOrEqual(200);
    });
  });

  describe("destroy", () => {
    it("rejects pending RPCs", async () => {
      const ws = mockWs();
      const { id } = registerExecutor(registry, ws);

      const promise = registry.sendRpc(id, { type: "ping", id: "rpc-destroy" });
      registry.destroy();

      await expect(promise).rejects.toThrow(/shutting down/);
    });

    it("rejects pending channels", async () => {
      const promise = registry.waitForTerminalChannel("ch-destroy", 30000);
      registry.destroy();

      await expect(promise).rejects.toThrow(/shutting down/);
    });
  });
});
