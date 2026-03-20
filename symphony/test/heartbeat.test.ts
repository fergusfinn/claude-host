import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatManager } from "../src/heartbeat.js";
import type { AgentEvent, HeartbeatConfig, TrackerConfig } from "../src/types.js";
import * as child_process from "node:child_process";
import { EventEmitter, PassThrough } from "node:stream";

vi.mock("node:child_process");

function makeConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    enabled: true,
    interval_ms: 60000,
    command: "claude -p",
    prompt_template: "",
    ...overrides,
  };
}

function makeTracker(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    kind: "linear",
    endpoint: "https://api.linear.app/graphql",
    api_key: "test-key",
    project_slug: "test-proj",
    active_states: ["Todo"],
    terminal_states: ["Done"],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    event: "notification",
    timestamp: new Date("2025-01-01T12:00:00Z"),
    codex_app_server_pid: null,
    message: "test event",
    ...overrides,
  };
}

function mockSpawn() {
  const proc = new EventEmitter() as any;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();

  vi.mocked(child_process.spawn).mockReturnValue(proc);
  return proc;
}

describe("HeartbeatManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing when disabled", () => {
    const mgr = new HeartbeatManager(makeConfig({ enabled: false }), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test issue");
    // No error, no timer — just a no-op
    mgr.stop("issue-1");
  });

  it("starts and stops heartbeat for an issue", () => {
    const mgr = new HeartbeatManager(makeConfig(), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test issue");

    // Stopping should not throw
    mgr.stop("issue-1");

    // Double stop is safe
    mgr.stop("issue-1");
  });

  it("does not double-start", () => {
    const mgr = new HeartbeatManager(makeConfig(), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test issue");
    mgr.start("issue-1", "PROJ-1", "Test issue"); // no-op
    mgr.stopAll();
  });

  it("accumulates events", () => {
    const mgr = new HeartbeatManager(makeConfig(), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test issue");

    // Should not throw even with events
    mgr.appendEvent("issue-1", makeEvent());
    mgr.appendEvent("issue-1", makeEvent({ message: "second event" }));

    // Appending to non-existent issue is safe
    mgr.appendEvent("nonexistent", makeEvent());

    mgr.stopAll();
  });

  it("spawns command on interval fire", async () => {
    const proc = mockSpawn();
    const mgr = new HeartbeatManager(makeConfig({ interval_ms: 1000 }), makeTracker());

    mgr.start("issue-1", "PROJ-1", "Test issue");
    mgr.appendEvent("issue-1", makeEvent());

    // Advance timer to trigger heartbeat
    vi.advanceTimersByTime(1000);

    // Should have spawned bash with the command
    expect(child_process.spawn).toHaveBeenCalledWith(
      "bash",
      ["-lc", "claude -p"],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    // Simulate process exit
    proc.emit("exit", 0);

    mgr.stopAll();
  });

  it("skips heartbeat while previous is still running", async () => {
    const proc = mockSpawn();
    vi.mocked(child_process.spawn).mockClear();
    // Re-apply mock so it returns proc
    vi.mocked(child_process.spawn).mockReturnValue(proc);

    const mgr = new HeartbeatManager(makeConfig({ interval_ms: 5000 }), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test issue");

    // First fire
    vi.advanceTimersByTime(5000);
    expect(child_process.spawn).toHaveBeenCalledTimes(1);

    // Second fire — should skip because first hasn't completed
    vi.advanceTimersByTime(5000);
    expect(child_process.spawn).toHaveBeenCalledTimes(1);

    // Complete first
    proc.emit("exit", 0);
    // Allow microtask (.finally) to run
    await vi.advanceTimersByTimeAsync(0);

    // Third fire — should now spawn again
    const proc2 = mockSpawn();
    vi.advanceTimersByTime(5000);
    expect(child_process.spawn).toHaveBeenCalledTimes(2);

    proc2.emit("exit", 0);
    mgr.stopAll();
  });

  it("passes LINEAR_API_KEY in env", () => {
    const proc = mockSpawn();
    const mgr = new HeartbeatManager(makeConfig({ interval_ms: 1000 }), makeTracker({ api_key: "my-secret-key" }));

    mgr.start("issue-1", "PROJ-1", "Test issue");
    vi.advanceTimersByTime(1000);

    expect(child_process.spawn).toHaveBeenCalledWith(
      "bash",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          LINEAR_API_KEY: "my-secret-key",
        }),
      }),
    );

    proc.emit("exit", 0);
    mgr.stopAll();
  });

  it("writes prompt to stdin", () => {
    const proc = mockSpawn();
    const chunks: string[] = [];
    proc.stdin.on("data", (d: Buffer) => chunks.push(d.toString()));

    const mgr = new HeartbeatManager(makeConfig({ interval_ms: 1000 }), makeTracker());

    mgr.start("issue-1", "PROJ-1", "My test issue");
    mgr.appendEvent("issue-1", makeEvent({ message: "tool: bash" }));

    vi.advanceTimersByTime(1000);

    const written = chunks.join("");
    expect(written).toContain("PROJ-1");
    expect(written).toContain("My test issue");
    expect(written).toContain("tool: bash");

    proc.emit("exit", 0);
    mgr.stopAll();
  });

  it("uses custom prompt template", () => {
    const proc = mockSpawn();
    const chunks: string[] = [];
    proc.stdin.on("data", (d: Buffer) => chunks.push(d.toString()));

    const mgr = new HeartbeatManager(
      makeConfig({
        interval_ms: 1000,
        prompt_template: "Custom: {{ issue.identifier }} has {{ event_count }} events",
      }),
      makeTracker(),
    );

    mgr.start("issue-1", "PROJ-1", "Test");
    mgr.appendEvent("issue-1", makeEvent());
    mgr.appendEvent("issue-1", makeEvent());

    vi.advanceTimersByTime(1000);

    const written = chunks.join("");
    expect(written).toBe("Custom: PROJ-1 has 2 events");

    proc.emit("exit", 0);
    mgr.stopAll();
  });

  it("handles process error gracefully", () => {
    const proc = mockSpawn();
    const mgr = new HeartbeatManager(makeConfig({ interval_ms: 1000 }), makeTracker());

    mgr.start("issue-1", "PROJ-1", "Test");
    vi.advanceTimersByTime(1000);

    // Should not throw
    proc.emit("error", new Error("spawn failed"));
    mgr.stopAll();
  });

  it("stopAll clears all heartbeats", () => {
    const mgr = new HeartbeatManager(makeConfig(), makeTracker());
    mgr.start("issue-1", "PROJ-1", "Test 1");
    mgr.start("issue-2", "PROJ-2", "Test 2");
    mgr.stopAll();

    // Appending after stop is safe (no-op)
    mgr.appendEvent("issue-1", makeEvent());
  });
});
