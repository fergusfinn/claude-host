import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock node-pty
const mockTermWrite = vi.fn();
const mockTermResize = vi.fn();
const mockTermKill = vi.fn();
let termDataCallback: ((data: string) => void) | null = null;
let termExitCallback: (() => void) | null = null;

const mockSpawn = vi.fn();

vi.mock("node-pty", () => ({
  default: { spawn: (...args: any[]) => mockSpawn(...args) },
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { bridgeSession } from "./pty-bridge";
import { WebSocket } from "ws";

let testId = 0;
function uniqueName() {
  return `test-${++testId}-${Date.now()}`;
}

function createMockTerm() {
  termDataCallback = null;
  termExitCallback = null;
  return {
    write: mockTermWrite,
    resize: mockTermResize,
    kill: mockTermKill,
    onData: (cb: (data: string) => void) => {
      termDataCallback = cb;
    },
    onExit: (cb: () => void) => {
      termExitCallback = cb;
    },
  };
}

function createMockWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = WebSocket.OPEN;
  return ws;
}

beforeEach(() => {
  mockSpawn.mockReset();
  mockTermWrite.mockReset();
  mockTermResize.mockReset();
  mockTermKill.mockReset();
});

describe("bridgeSession", () => {
  it("spawns pty with tmux attach command", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "my-session");

    expect(mockSpawn).toHaveBeenCalledWith(
      "/bin/sh",
      ["-c", 'exec tmux attach -t "my-session"'],
      expect.objectContaining({
        name: "xterm-256color",
        cols: 80,
        rows: 24,
      }),
    );
  });

  it("sends pty output to websocket", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    termDataCallback!("hello from terminal");
    expect(ws.send).toHaveBeenCalledWith("hello from terminal");
  });

  it("does not send to websocket when not open", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.readyState = WebSocket.CLOSED;
    termDataCallback!("data");
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("forwards text messages to pty", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.emit("message", "ls -la");
    expect(mockTermWrite).toHaveBeenCalledWith("ls -la");
  });

  it("handles resize messages", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.emit("message", JSON.stringify({ resize: [120, 40] }));
    expect(mockTermResize).toHaveBeenCalledWith(120, 40);
    expect(mockTermWrite).not.toHaveBeenCalled();
  });

  it("ignores resize with invalid dimensions", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);
    mockTermResize.mockReset();

    ws.emit("message", JSON.stringify({ resize: [0, 40] }));
    expect(mockTermResize).not.toHaveBeenCalled();

    ws.emit("message", JSON.stringify({ resize: [-1, -1] }));
    expect(mockTermResize).not.toHaveBeenCalled();
  });

  it("treats non-resize JSON as regular input", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    const msg = JSON.stringify({ foo: "bar" });
    ws.emit("message", msg);
    expect(mockTermWrite).toHaveBeenCalledWith(msg);
  });

  it("kills pty when sole client closes", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.emit("close");
    expect(mockTermKill).toHaveBeenCalled();
  });

  it("kills pty when sole client errors", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.emit("error", new Error("connection lost"));
    expect(mockTermKill).toHaveBeenCalled();
  });

  it("closes all clients on pty exit", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    termExitCallback!();
    expect(ws.close).toHaveBeenCalled();
  });

  it("does not close websocket on pty exit if already closed", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    ws.readyState = WebSocket.CLOSED;
    termExitCallback!();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("sends error and closes ws when spawn fails", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const ws = createMockWs();
    const name = uniqueName();

    bridgeSession(ws as any, name);

    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining("spawn failed"),
    );
    expect(ws.close).toHaveBeenCalled();
  });

  // --- Multi-client tests ---

  it("shares a single PTY across multiple clients for the same session", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const name = uniqueName();

    bridgeSession(ws1 as any, name);
    bridgeSession(ws2 as any, name);

    // Only one PTY should be spawned
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Output should go to both clients
    termDataCallback!("broadcast");
    expect(ws1.send).toHaveBeenCalledWith("broadcast");
    expect(ws2.send).toHaveBeenCalledWith("broadcast");
  });

  it("resizes PTY to minimum dimensions across all clients", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const name = uniqueName();

    bridgeSession(ws1 as any, name);
    bridgeSession(ws2 as any, name);

    // Client 1: large screen (120x40)
    ws1.emit("message", JSON.stringify({ resize: [120, 40] }));
    // Client 2: small screen (50x20)
    ws2.emit("message", JSON.stringify({ resize: [50, 20] }));

    // PTY should be resized to min(120,50) x min(40,20) = 50x20
    const lastResizeCall = mockTermResize.mock.calls[mockTermResize.mock.calls.length - 1];
    expect(lastResizeCall).toEqual([50, 20]);
  });

  it("recalculates size when a client disconnects", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const name = uniqueName();

    bridgeSession(ws1 as any, name);
    bridgeSession(ws2 as any, name);

    // Set sizes
    ws1.emit("message", JSON.stringify({ resize: [120, 40] }));
    ws2.emit("message", JSON.stringify({ resize: [50, 20] }));
    mockTermResize.mockReset();

    // Small client disconnects
    ws2.emit("close");

    // PTY should resize to the remaining client's size (120x40)
    expect(mockTermResize).toHaveBeenCalledWith(120, 40);
    // PTY should NOT be killed (still has a client)
    expect(mockTermKill).not.toHaveBeenCalled();
  });

  it("kills PTY only when last client disconnects", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const name = uniqueName();

    bridgeSession(ws1 as any, name);
    bridgeSession(ws2 as any, name);

    ws1.emit("close");
    expect(mockTermKill).not.toHaveBeenCalled();

    ws2.emit("close");
    expect(mockTermKill).toHaveBeenCalled();
  });

  it("both clients can write to the shared PTY", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const name = uniqueName();

    bridgeSession(ws1 as any, name);
    bridgeSession(ws2 as any, name);

    ws1.emit("message", "hello");
    ws2.emit("message", "world");

    expect(mockTermWrite).toHaveBeenCalledWith("hello");
    expect(mockTermWrite).toHaveBeenCalledWith("world");
  });
});
