import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock setup (must come before any imports that trigger server.ts) ---

const mockAttachSession = vi.fn();
const mockSetRegistry = vi.fn();
const mockUpsertExecutor = vi.fn();

vi.mock("./lib/sessions.js", () => ({
  getSessionManager: () => ({
    attachSession: mockAttachSession,
    setRegistry: mockSetRegistry,
    upsertExecutor: mockUpsertExecutor,
  }),
}));

const mockHandleControlConnection = vi.fn();
vi.mock("./lib/executor-registry.js", () => ({
  ExecutorRegistry: class MockExecutorRegistry {
    handleControlConnection = mockHandleControlConnection;
    resolveTerminalChannel = vi.fn(() => false);
    constructor(_cb?: any) {}
  },
}));

// Capture the upgrade handler and listen callback
let upgradeHandler: Function;
const mockServer = {
  on: vi.fn((event: string, handler: Function) => {
    if (event === "upgrade") upgradeHandler = handler;
  }),
  listen: vi.fn((_port: number, cb: Function) => {
    cb?.();
  }),
};

vi.mock("http", () => ({
  createServer: vi.fn(() => mockServer),
}));

// WebSocketServer must be a constructor (used with `new`)
let handleUpgradeCallback: Function;
const mockHandleUpgrade = vi.fn((_req: any, _socket: any, _head: any, cb: Function) => {
  handleUpgradeCallback = cb;
  cb({ fake: "ws" });
});

vi.mock("ws", () => {
  return {
    WebSocketServer: class MockWebSocketServer {
      handleUpgrade = mockHandleUpgrade;
      constructor(_opts: any) {}
    },
  };
});

const mockNextHandle = vi.fn();
const mockPrepare = vi.fn(() => Promise.resolve());

vi.mock("next", () => ({
  default: vi.fn(() => ({
    prepare: mockPrepare,
    getRequestHandler: vi.fn(() => mockNextHandle),
  })),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(() => "/usr/local/bin/tmux\n"),
  spawnSync: vi.fn(() => ({ stdout: "tmux 3.4" })),
}));

import { execFileSync, spawnSync } from "child_process";

let origExit: typeof process.exit;

beforeEach(() => {
  origExit = process.exit;
  process.exit = vi.fn() as any;
  mockAttachSession.mockReset();
  mockHandleUpgrade.mockReset();
  mockHandleUpgrade.mockImplementation((_req: any, _socket: any, _head: any, cb: Function) => {
    cb({ fake: "ws" });
  });
});

afterEach(() => {
  process.exit = origExit;
});

// Import server — triggers top-level side effects.
// app.prepare() returns a resolved promise, so the .then() callback runs
// in the microtask queue. We await it in beforeAll.
let serverReady: boolean = false;

beforeEach(async () => {
  if (!serverReady) {
    await import("./server");
    // Flush the app.prepare().then() microtask
    await new Promise((r) => setTimeout(r, 10));
    serverReady = true;
  }
});

describe("server", () => {
  it("registers an upgrade handler on the HTTP server", () => {
    expect(upgradeHandler).toBeTypeOf("function");
  });

  it("calls attachSession for /ws/sessions/{name} upgrades", () => {
    const mockSocket = { destroy: vi.fn() };
    const mockHead = Buffer.alloc(0);
    const mockReq = { url: "/ws/sessions/my-session" };

    upgradeHandler(mockReq, mockSocket, mockHead);

    expect(mockHandleUpgrade).toHaveBeenCalledWith(
      mockReq,
      mockSocket,
      mockHead,
      expect.any(Function),
    );
    expect(mockAttachSession).toHaveBeenCalledWith("my-session", { fake: "ws" }, 0, 0);
  });

  it("decodes URL-encoded session names", () => {
    const mockSocket = { destroy: vi.fn() };
    const mockReq = { url: "/ws/sessions/my%20session" };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));

    expect(mockAttachSession).toHaveBeenCalledWith("my session", { fake: "ws" }, 0, 0);
  });

  it("does not bridge non-matching paths (dev mode allows HMR)", () => {
    // NODE_ENV is "test" so dev=true — non-matching upgrades pass through for HMR
    const mockSocket = { destroy: vi.fn() };
    const mockReq = { url: "/some/other/path" };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));

    expect(mockHandleUpgrade).not.toHaveBeenCalled();
    expect(mockAttachSession).not.toHaveBeenCalled();
    // In dev mode, socket should NOT be destroyed (allows HMR)
    expect(mockSocket.destroy).not.toHaveBeenCalled();
  });

  it("does not match /ws/sessions/ with extra path segments", () => {
    const mockSocket = { destroy: vi.fn() };
    const mockReq = { url: "/ws/sessions/name/extra" };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));

    expect(mockHandleUpgrade).not.toHaveBeenCalled();
  });

  it("does not match /ws/sessions/ with no name", () => {
    const mockSocket = { destroy: vi.fn() };
    const mockReq = { url: "/ws/sessions/" };

    upgradeHandler(mockReq, mockSocket, Buffer.alloc(0));

    expect(mockHandleUpgrade).not.toHaveBeenCalled();
  });

  it("does not match unrelated WebSocket paths", () => {
    const mockSocket = { destroy: vi.fn() };

    for (const url of ["/ws/other", "/api/sessions", "/ws", "/"]) {
      mockHandleUpgrade.mockClear();
      upgradeHandler({ url }, mockSocket, Buffer.alloc(0));
      expect(mockHandleUpgrade).not.toHaveBeenCalled();
    }
  });
});

describe("server setup", () => {
  it("server.listen was called with a port", () => {
    expect(mockServer.listen).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Function),
    );
  });

  it("calls which tmux and tmux -V on startup", () => {
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith("which", ["tmux"], expect.anything());
    expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
      "/usr/local/bin/tmux",
      ["-V"],
      expect.anything(),
    );
  });

  it("called app.prepare() during startup", () => {
    expect(mockPrepare).toHaveBeenCalled();
  });

  it("wires up executor registry to session manager", () => {
    expect(mockSetRegistry).toHaveBeenCalled();
  });
});
