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

    bridgeSession(ws as any, "sess");

    // Simulate terminal output
    termDataCallback!("hello from terminal");
    expect(ws.send).toHaveBeenCalledWith("hello from terminal");
  });

  it("does not send to websocket when not open", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.readyState = WebSocket.CLOSED;
    termDataCallback!("data");
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("forwards text messages to pty", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    // Simulate incoming text message
    ws.emit("message", "ls -la");
    expect(mockTermWrite).toHaveBeenCalledWith("ls -la");
  });

  it("handles resize messages", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.emit("message", JSON.stringify({ resize: [120, 40] }));
    expect(mockTermResize).toHaveBeenCalledWith(120, 40);
    // Should NOT write the JSON to the terminal
    expect(mockTermWrite).not.toHaveBeenCalled();
  });

  it("ignores resize with invalid dimensions", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.emit("message", JSON.stringify({ resize: [0, 40] }));
    expect(mockTermResize).not.toHaveBeenCalled();

    ws.emit("message", JSON.stringify({ resize: [-1, -1] }));
    expect(mockTermResize).not.toHaveBeenCalled();
  });

  it("treats non-resize JSON as regular input", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    const msg = JSON.stringify({ foo: "bar" });
    ws.emit("message", msg);
    expect(mockTermWrite).toHaveBeenCalledWith(msg);
  });

  it("kills pty on websocket close", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.emit("close");
    expect(mockTermKill).toHaveBeenCalled();
  });

  it("kills pty on websocket error", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.emit("error", new Error("connection lost"));
    expect(mockTermKill).toHaveBeenCalled();
  });

  it("closes websocket on pty exit", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    termExitCallback!();
    expect(ws.close).toHaveBeenCalled();
  });

  it("does not close websocket on pty exit if already closed", () => {
    const term = createMockTerm();
    mockSpawn.mockReturnValue(term);
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    ws.readyState = WebSocket.CLOSED;
    termExitCallback!();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("sends error and closes ws when spawn fails", () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn failed");
    });
    const ws = createMockWs();

    bridgeSession(ws as any, "sess");

    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining("spawn failed"),
    );
    expect(ws.close).toHaveBeenCalled();
  });
});
