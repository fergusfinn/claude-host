import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

// Shared state for mocks — accessed via globalThis to survive hoisting
const _mockState = {
  dbRun: vi.fn(),
  dbGet: vi.fn(),
  dbExec: vi.fn(),
  dbPragma: vi.fn(),
  prepare: vi.fn(),
  spawn: vi.fn(),
};
_mockState.prepare.mockReturnValue({ run: _mockState.dbRun, get: _mockState.dbGet });

// Expose for convenience
const mockDbRun = _mockState.dbRun;
const mockDbGet = _mockState.dbGet;
const mockDbExec = _mockState.dbExec;
const mockDbPragma = _mockState.dbPragma;
const mockPrepare = _mockState.prepare;
const mockSpawn = _mockState.spawn;

vi.mock("better-sqlite3", () => {
  return {
    default: class Database {
      pragma = _mockState.dbPragma;
      exec = _mockState.dbExec;
      prepare = _mockState.prepare;
    },
  };
});

vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: (...args: any[]) => _mockState.spawn(...args),
}));

// Import after mocks
import { bridgeRichSession, cleanupRichSession, richSessionExists } from "./claude-bridge";

// Helper: create a mock WebSocket
function createMockWs(): any {
  const ws = new EventEmitter();
  (ws as any).readyState = 1; // WebSocket.OPEN
  (ws as any).send = vi.fn();
  (ws as any).close = vi.fn();
  // Make WebSocket.OPEN available
  Object.defineProperty(ws, "OPEN", { value: 1 });
  return ws;
}

// Helper: create a mock child process
function createMockProc(): any {
  const proc = new EventEmitter();
  (proc as any).stdin = { write: vi.fn(), end: vi.fn() };
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  (proc as any).kill = vi.fn();
  (proc as any).pid = 12345;
  return proc;
}

describe("claude-bridge", () => {
  let mockProc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockReturnValue(undefined); // No saved state
    mockProc = createMockProc();
    mockSpawn.mockReturnValue(mockProc);
  });

  afterEach(() => {
    // Clean up sessions between tests
    cleanupRichSession("test-session");
    cleanupRichSession("test-session-2");
  });

  describe("bridgeRichSession", () => {
    it("connects and sends session_state", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      // Should send session_state with streaming: false
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "session_state", streaming: false }),
      );
    });

    it("replays stored events on reconnect", () => {
      const ws1 = createMockWs();
      bridgeRichSession(ws1, "test-session");

      // Send a prompt to trigger process spawn
      ws1.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      // Simulate a user event from process stdout
      const userEvent = { type: "user", message: { role: "user", content: [{ type: "text", text: "hello" }] } };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(userEvent) + "\n"));

      // Reconnect with new ws
      const ws2 = createMockWs();
      bridgeRichSession(ws2, "test-session");

      // ws2 should have received the replayed event + session_state
      const calls = ws2.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const eventMessages = calls.filter((c: any) => c.type === "event");
      expect(eventMessages.length).toBeGreaterThanOrEqual(1);
    });

    it("closes previous client on reconnect", () => {
      const ws1 = createMockWs();
      bridgeRichSession(ws1, "test-session");

      const ws2 = createMockWs();
      bridgeRichSession(ws2, "test-session");

      expect(ws1.close).toHaveBeenCalled();
    });

    it("spawns claude process on first prompt", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      expect(mockSpawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["-p", "--output-format", "stream-json"]),
        expect.any(Object),
      );
    });

    it("writes prompt to process stdin", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      expect(mockProc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"hello"'),
      );
    });

    it("rejects prompt while a turn is in progress", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello again" }));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const errors = calls.filter((c: any) => c.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("turn is already in progress");
    });

    it("handles interrupt signal", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      ws.emit("message", JSON.stringify({ type: "interrupt" }));

      expect(mockProc.kill).toHaveBeenCalledWith("SIGINT");
    });

    it("handles invalid JSON gracefully", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", "not valid json");

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const errors = calls.filter((c: any) => c.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("Invalid JSON");
    });

    it("forwards events from process stdout to websocket", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      const assistantEvent = {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(assistantEvent) + "\n"));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const events = calls.filter((c: any) => c.type === "event" && c.event.type === "assistant");
      expect(events).toHaveLength(1);
    });

    it("sends turn_complete on result event", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      const resultEvent = { type: "result", total_cost_usd: 0.01, duration_ms: 1000 };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(resultEvent) + "\n"));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const turnComplete = calls.filter((c: any) => c.type === "turn_complete");
      expect(turnComplete).toHaveLength(1);
    });

    it("captures session_id from init event", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      const initEvent = { type: "system", subtype: "init", session_id: "sess-123" };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(initEvent) + "\n"));

      // Now if the process dies and restarts, it should use --resume
      mockProc.emit("close", 1);

      // Send another prompt — should trigger new spawn with --resume
      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello again" }));

      const secondCall = mockSpawn.mock.calls[1];
      expect(secondCall[1]).toContain("--resume");
      expect(secondCall[1]).toContain("sess-123");
    });

    it("skips subagent events (parent_tool_use_id)", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      const subagentEvent = {
        type: "assistant",
        parent_tool_use_id: "tool-1",
        message: { role: "assistant", content: [] },
      };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(subagentEvent) + "\n"));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const events = calls.filter((c: any) => c.type === "event" && c.event.type === "assistant");
      expect(events).toHaveLength(0);
    });

    it("skips duplicate init events", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      const init1 = { type: "system", subtype: "init", session_id: "s1" };
      const init2 = { type: "system", subtype: "init", session_id: "s1" };
      mockProc.stdout.emit("data", Buffer.from(JSON.stringify(init1) + "\n" + JSON.stringify(init2) + "\n"));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const inits = calls.filter((c: any) => c.type === "event" && c.event.type === "system" && c.event.subtype === "init");
      expect(inits).toHaveLength(1);
    });

    it("does not send error on clean process exit (code 0)", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      mockProc.emit("close", 0);

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const errors = calls.filter((c: any) => c.type === "error");
      expect(errors).toHaveLength(0);
    });

    it("sends error on non-zero process exit", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      mockProc.emit("close", 1);

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const errors = calls.filter((c: any) => c.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("code 1");
    });

    it("handles stderr output", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      mockProc.stderr.emit("data", Buffer.from("warning message"));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const stderrEvents = calls.filter((c: any) => c.type === "event" && c.event.type === "stderr");
      expect(stderrEvents).toHaveLength(1);
      expect(stderrEvents[0].event.text).toBe("warning message");
    });
  });

  describe("cleanupRichSession", () => {
    it("kills process and removes state", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");
      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      cleanupRichSession("test-session");

      expect(mockProc.kill).toHaveBeenCalled();
      expect(richSessionExists("test-session")).toBe(false);
    });

    it("handles cleanup for non-existent session", () => {
      // Should not throw
      expect(() => cleanupRichSession("nonexistent")).not.toThrow();
    });
  });

  describe("richSessionExists", () => {
    it("returns true for active session", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      expect(richSessionExists("test-session")).toBe(true);
    });

    it("returns false for non-existent session", () => {
      expect(richSessionExists("nonexistent")).toBe(false);
    });
  });

  describe("persistence", () => {
    it("attempts to load state from DB", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      // Should have tried to load from DB
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT session_id, events FROM rich_sessions"),
      );
    });

    it("restores saved events from DB", () => {
      const savedEvents = [
        { type: "system", subtype: "init" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "saved reply" }] } },
      ];
      mockDbGet.mockReturnValueOnce({
        session_id: "saved-session",
        events: JSON.stringify(savedEvents),
      });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      // Should replay the saved events
      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const events = calls.filter((c: any) => c.type === "event");
      expect(events).toHaveLength(2);
    });

    it("deletes state from DB on cleanup", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      cleanupRichSession("test-session-2");

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM rich_sessions"),
      );
    });
  });
});
