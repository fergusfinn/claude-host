import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Shared state for mocks — accessed via globalThis to survive hoisting
const _mockState = {
  dbRun: vi.fn(),
  dbGet: vi.fn(),
  dbExec: vi.fn(),
  dbPragma: vi.fn(),
  prepare: vi.fn(),
  spawnSync: vi.fn(),
  execFileSync: vi.fn(),
  // fs mocks
  fsExistsSync: vi.fn(),
  fsReadFileSync: vi.fn(),
  fsWriteFileSync: vi.fn(),
  fsOpenSync: vi.fn(),
  fsCloseSync: vi.fn(),
  fsReadSync: vi.fn(),
  fsFstatSync: vi.fn(),
  fsStatSync: vi.fn(),
  fsRmSync: vi.fn(),
  fsWatch: vi.fn(),
  fsMkdirSync: vi.fn(),
  fsWriteSync: vi.fn(),
  fsAppendFileSync: vi.fn(),
};
_mockState.prepare.mockReturnValue({ run: _mockState.dbRun, get: _mockState.dbGet });

vi.mock("better-sqlite3", () => {
  return {
    default: class Database {
      pragma = _mockState.dbPragma;
      exec = _mockState.dbExec;
      prepare = _mockState.prepare;
    },
  };
});

vi.mock("child_process", () => ({
  spawnSync: (...args: any[]) => _mockState.spawnSync(...args),
  execFileSync: (...args: any[]) => _mockState.execFileSync(...args),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    mkdirSync: (...args: any[]) => _mockState.fsMkdirSync(...args),
    existsSync: (...args: any[]) => _mockState.fsExistsSync(...args),
    readFileSync: (...args: any[]) => _mockState.fsReadFileSync(...args),
    writeFileSync: (...args: any[]) => _mockState.fsWriteFileSync(...args),
    openSync: (...args: any[]) => _mockState.fsOpenSync(...args),
    closeSync: (...args: any[]) => _mockState.fsCloseSync(...args),
    readSync: (...args: any[]) => _mockState.fsReadSync(...args),
    fstatSync: (...args: any[]) => _mockState.fsFstatSync(...args),
    statSync: (...args: any[]) => _mockState.fsStatSync(...args),
    rmSync: (...args: any[]) => _mockState.fsRmSync(...args),
    writeSync: (...args: any[]) => _mockState.fsWriteSync(...args),
    appendFileSync: (...args: any[]) => _mockState.fsAppendFileSync(...args),
    watch: (...args: any[]) => _mockState.fsWatch(...args),
    constants: actual.constants,
  };
});

// Import after mocks
import { bridgeRichSession, cleanupRichSession, setRichDb } from "./claude-bridge";

// Helper: create a mock WebSocket
function createMockWs(): any {
  const ws = new EventEmitter();
  (ws as any).readyState = 1; // WebSocket.OPEN
  (ws as any).send = vi.fn();
  (ws as any).close = vi.fn();
  Object.defineProperty(ws, "OPEN", { value: 1 });
  return ws;
}

function setupDefaultMocks() {
  // DB: no saved state
  _mockState.dbGet.mockReturnValue(undefined);

  // tmux: has-session returns "not found", other cmds succeed
  _mockState.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args?.[0] === "has-session") return { status: 1 };
    return { status: 0 };
  });

  // which tmux
  _mockState.execFileSync.mockReturnValue("/usr/bin/tmux\n");

  // fs defaults
  _mockState.fsExistsSync.mockReturnValue(false);
  _mockState.fsReadFileSync.mockReturnValue("");
  _mockState.fsWriteFileSync.mockReturnValue(undefined);
  _mockState.fsOpenSync.mockReturnValue(42);
  _mockState.fsCloseSync.mockReturnValue(undefined);
  _mockState.fsReadSync.mockReturnValue(0);
  _mockState.fsFstatSync.mockReturnValue({ size: 0 });
  _mockState.fsStatSync.mockReturnValue({ size: 0 });
  _mockState.fsRmSync.mockReturnValue(undefined);
  _mockState.fsMkdirSync.mockReturnValue(undefined);
  _mockState.fsWriteSync.mockImplementation((_fd: number, buf: Buffer, offset: number, length: number) => length);

  // fs.watch returns a mock watcher
  _mockState.fsWatch.mockImplementation(() => {
    const watcher = new EventEmitter();
    (watcher as any).close = vi.fn();
    return watcher;
  });
}

describe("claude-bridge (tmux-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    // Inject mock DB so getDb() doesn't throw
    setRichDb({ prepare: _mockState.prepare } as any);
  });

  afterEach(() => {
    cleanupRichSession("test-session");
    cleanupRichSession("test-session-2");
  });

  describe("bridgeRichSession", () => {
    it("connects and sends replay_info and session_state", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo).toEqual({ type: "replay_info", totalEvents: 0, tailEvents: [] });
      const sessionState = calls.find((c: any) => c.type === "session_state");
      expect(sessionState).toEqual({ type: "session_state", streaming: false, process_alive: false });
    });

    it("supports multiple simultaneous clients", () => {
      const ws1 = createMockWs();
      bridgeRichSession(ws1, "test-session");

      const ws2 = createMockWs();
      bridgeRichSession(ws2, "test-session");

      // Both clients should stay connected (no disconnect)
      expect(ws1.close).not.toHaveBeenCalled();
      expect(ws2.close).not.toHaveBeenCalled();
    });

    it("sends tail events inline with replay_info", () => {
      const events = [
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
      ];
      const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";

      _mockState.fsExistsSync.mockImplementation((p: string) =>
        typeof p === "string" && p.includes("events.ndjson")
      );
      _mockState.fsReadFileSync.mockReturnValue(content);
      _mockState.fsStatSync.mockReturnValue({ size: Buffer.byteLength(content) });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo.totalEvents).toBe(2);
      expect(replayInfo.tailEvents).toHaveLength(2);
      expect(replayInfo.tailEvents[0].type).toBe("system");
      expect(replayInfo.tailEvents[1].type).toBe("assistant");
    });

    it("serves earlier events via replay_range for backfill", () => {
      // Create 110 events so tail (100) doesn't cover all
      const events = Array.from({ length: 110 }, (_, i) => ({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: `msg ${i}` }] },
      }));
      const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";

      _mockState.fsExistsSync.mockImplementation((p: string) =>
        typeof p === "string" && p.includes("events.ndjson")
      );
      _mockState.fsReadFileSync.mockReturnValue(content);
      _mockState.fsStatSync.mockReturnValue({ size: Buffer.byteLength(content) });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      let calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo.totalEvents).toBe(110);
      expect(replayInfo.tailEvents).toHaveLength(100);

      // Request the earlier 10 events via backfill
      ws.emit("message", JSON.stringify({ type: "replay_range", start: 0, end: 10 }));

      calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const eventMessages = calls.filter((c: any) => c.type === "event");
      expect(eventMessages).toHaveLength(10);

      const rangeComplete = calls.find((c: any) => c.type === "replay_range_complete");
      expect(rangeComplete).toEqual({ type: "replay_range_complete", start: 0, end: 10 });
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

    it("queues follow-up prompt while a turn is in progress", async () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      // Make tmux session exist and FIFO writable
      _mockState.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args?.[0] === "has-session") return { status: 0 };
        return { status: 0 };
      });
      _mockState.fsOpenSync.mockReturnValue(99);

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      // Wait for async tryWrite
      await new Promise((r) => setTimeout(r, 50));

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello again" }));

      await new Promise((r) => setTimeout(r, 50));

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));

      // Both messages should be accepted (no errors)
      const errors = calls.filter((c: any) => c.type === "error");
      expect(errors).toHaveLength(0);

      // Both user messages should be broadcast as events
      const userEvents = calls.filter(
        (c: any) => c.type === "event" && c.event?.type === "user"
      );
      expect(userEvents).toHaveLength(2);
      expect(userEvents[0].event.message.content[0].text).toBe("hello");
      expect(userEvents[1].event.message.content[0].text).toBe("hello again");

      // Second message should include queued flag
      expect(userEvents[1].event.queued).toBe(true);
    });

    it("creates tmux session on first prompt if not running", async () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      _mockState.fsOpenSync.mockReturnValue(99);

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      await new Promise((r) => setTimeout(r, 50));

      const tmuxCalls = _mockState.spawnSync.mock.calls.filter(
        (c: any[]) => c[1]?.[0] === "new-session"
      );
      expect(tmuxCalls.length).toBeGreaterThanOrEqual(1);
      // Should have the rich- prefix
      expect(tmuxCalls[0][1]).toContain("rich-test-session");
    });

    it("includes --allowedTools for plan mode tools in tmux session args", async () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      _mockState.fsOpenSync.mockReturnValue(99);

      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));

      await new Promise((r) => setTimeout(r, 50));

      const tmuxCalls = _mockState.spawnSync.mock.calls.filter(
        (c: any[]) => c[1]?.[0] === "new-session"
      );
      expect(tmuxCalls.length).toBeGreaterThanOrEqual(1);
      const args = tmuxCalls[0][1] as string[];
      const allowedIdx = args.indexOf("--allowedTools");
      expect(allowedIdx).toBeGreaterThan(-1);
      expect(args[allowedIdx + 1]).toContain("ExitPlanMode");
      expect(args[allowedIdx + 1]).toContain("EnterPlanMode");
    });

    it("sends interrupt via tmux send-keys", async () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      // Make tmux exist
      _mockState.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args?.[0] === "has-session") return { status: 0 };
        return { status: 0 };
      });
      _mockState.fsOpenSync.mockReturnValue(99);

      // Send prompt to set turning=true
      ws.emit("message", JSON.stringify({ type: "prompt", text: "hello" }));
      await new Promise((r) => setTimeout(r, 50));

      // Send interrupt
      ws.emit("message", JSON.stringify({ type: "interrupt" }));

      const sendKeysCalls = _mockState.spawnSync.mock.calls.filter(
        (c: any[]) => c[1]?.[0] === "send-keys" && c[1]?.includes("C-c")
      );
      expect(sendKeysCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("includes subagent events in tail replay", () => {
      const events = [
        { type: "assistant", message: { role: "assistant", content: [] } },
        { type: "assistant", parent_tool_use_id: "tool-1", message: { role: "assistant", content: [] } },
      ];
      const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";

      _mockState.fsExistsSync.mockImplementation((p: string) =>
        typeof p === "string" && p.includes("events.ndjson")
      );
      _mockState.fsReadFileSync.mockReturnValue(content);
      _mockState.fsStatSync.mockReturnValue({ size: Buffer.byteLength(content) });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo.tailEvents).toHaveLength(2);
    });

    it("skips duplicate init events during replay", () => {
      const events = [
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "assistant", message: { role: "assistant", content: [] } },
      ];
      const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";

      _mockState.fsExistsSync.mockImplementation((p: string) =>
        typeof p === "string" && p.includes("events.ndjson")
      );
      _mockState.fsReadFileSync.mockReturnValue(content);
      _mockState.fsStatSync.mockReturnValue({ size: Buffer.byteLength(content) });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      // replay_info should report 2 events (deduped init + assistant)
      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo.totalEvents).toBe(2);

      // tailEvents should contain only one init (deduped)
      const inits = replayInfo.tailEvents.filter(
        (e: any) => e.type === "system" && e.subtype === "init"
      );
      expect(inits).toHaveLength(1);
    });

    it("skips stream_event during replay", () => {
      const events = [
        { type: "system", subtype: "init", session_id: "s1" },
        { type: "stream_event", event: { type: "content_block_delta" } },
        { type: "assistant", message: { role: "assistant", content: [] } },
      ];
      const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";

      _mockState.fsExistsSync.mockImplementation((p: string) =>
        typeof p === "string" && p.includes("events.ndjson")
      );
      _mockState.fsReadFileSync.mockReturnValue(content);
      _mockState.fsStatSync.mockReturnValue({ size: Buffer.byteLength(content) });

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      // replay_info should report 2 events (stream_event filtered out)
      const calls = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
      const replayInfo = calls.find((c: any) => c.type === "replay_info");
      expect(replayInfo.totalEvents).toBe(2);

      // tailEvents should not contain any stream_events
      const streamEvents = replayInfo.tailEvents.filter(
        (e: any) => e.type === "stream_event"
      );
      expect(streamEvents).toHaveLength(0);
    });
  });

  describe("cleanupRichSession", () => {
    it("cleans up in-memory state and closes client connections", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session");

      cleanupRichSession("test-session");

      // WS client should be closed
      expect(ws.close).toHaveBeenCalled();
    });

    it("handles cleanup for non-existent session", () => {
      expect(() => cleanupRichSession("nonexistent")).not.toThrow();
    });
  });

  describe("persistence", () => {
    it("attempts to load state from DB", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      expect(_mockState.prepare).toHaveBeenCalledWith(
        expect.stringContaining("SELECT session_id"),
      );
    });

    it("migrates old SQLite events to file", () => {
      const savedEvents = [
        { type: "system", subtype: "init", session_id: "saved-session" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "saved reply" }] } },
      ];
      _mockState.dbGet.mockReturnValueOnce({
        session_id: "saved-session",
        byte_offset: 0,
        events: JSON.stringify(savedEvents),
      });

      // Events file doesn't exist yet — trigger migration
      _mockState.fsExistsSync.mockReturnValue(false);

      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      // Should have written events to file
      const writeCalls = _mockState.fsWriteFileSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("events.ndjson")
      );
      expect(writeCalls.length).toBeGreaterThanOrEqual(1);
      expect(writeCalls[0][1]).toContain("saved-session");
    });

    it("deletes state from DB on cleanup", () => {
      const ws = createMockWs();
      bridgeRichSession(ws, "test-session-2");

      cleanupRichSession("test-session-2");

      expect(_mockState.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM rich_sessions"),
      );
    });
  });
});
