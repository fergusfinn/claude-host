import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRunner } from "../src/agent-runner.js";
import type { CodexConfig, Issue, AgentEvent } from "../src/types.js";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

const testConfig: CodexConfig = {
  command: "codex app-server",
  approval_policy: "never",
  thread_sandbox: "danger-full-access",
  turn_sandbox_policy: { type: "dangerFullAccess" },
  turn_timeout_ms: 60000,
  read_timeout_ms: 5000,
  stall_timeout_ms: 300000,
};

const testIssue: Issue = {
  id: "id1",
  identifier: "MT-1",
  title: "Test",
  description: null,
  priority: null,
  state: "Todo",
  branch_name: null,
  url: null,
  labels: [],
  blocked_by: [],
  created_at: null,
  updated_at: null,
};

function createMockProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as any;
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.pid = 12345;
  proc.kill = vi.fn();
  proc.spawnargs = [];
  return { proc, stdin, stdout, stderr };
}

describe("AgentRunner", () => {
  let runner: AgentRunner;
  let mockSpawn: any;

  beforeEach(() => {
    runner = new AgentRunner(testConfig);
    mockSpawn = vi.mocked(child_process.spawn);
  });

  describe("startSession", () => {
    it("completes handshake and returns session", async () => {
      const { proc, stdout } = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const events: AgentEvent[] = [];
      const sessionPromise = runner.startSession("/workspace", (e) => events.push(e));

      // Respond to initialize (id=1)
      await tick();
      stdout.write(JSON.stringify({ id: 1, result: { serverInfo: {} } }) + "\n");

      // Respond to thread/start (id=2)
      await tick();
      stdout.write(
        JSON.stringify({ id: 2, result: { thread: { id: "thread-abc" } } }) + "\n",
      );

      const session = await sessionPromise;
      expect(session.threadId).toBe("thread-abc");
      expect(events.some((e) => e.event === "session_started")).toBe(true);
    });

    it("throws on missing workspace", async () => {
      await expect(runner.startSession("", vi.fn())).rejects.toThrow("Workspace path is required");
    });
  });

  describe("runTurn", () => {
    it("handles turn/completed", async () => {
      const { proc } = createMockProcess();
      const turnStdout = new PassThrough();
      const reader = readline.createInterface({ input: turnStdout });
      const lineIterator = reader[Symbol.asyncIterator]();

      const session = {
        threadId: "thread-abc",
        turnId: "",
        sessionId: "",
        process: proc,
        lineIterator,
        reader,
      };

      const events: AgentEvent[] = [];
      const turnPromise = runner.runTurn(session, "Do something", testIssue, (e) => events.push(e));

      // Respond to turn/start
      await tick();
      turnStdout.write(
        JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }) + "\n",
      );

      // Emit turn/completed
      await tick();
      turnStdout.write(
        JSON.stringify({
          method: "turn/completed",
          params: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
        }) + "\n",
      );

      const result = await turnPromise;
      expect(result.success).toBe(true);
      expect(result.reason).toBe("completed");
      expect(result.usage?.total_tokens).toBe(150);
    });

    it("auto-approves approval requests", async () => {
      const { proc } = createMockProcess();
      const turnStdout = new PassThrough();
      const reader = readline.createInterface({ input: turnStdout });
      const lineIterator = reader[Symbol.asyncIterator]();

      const session = {
        threadId: "thread-abc",
        turnId: "",
        sessionId: "",
        process: proc,
        lineIterator,
        reader,
      };

      const events: AgentEvent[] = [];
      const written: string[] = [];
      proc.stdin.on("data", (d: Buffer) => written.push(d.toString()));

      const turnPromise = runner.runTurn(session, "Do something", testIssue, (e) => events.push(e));

      await tick();
      turnStdout.write(JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }) + "\n");

      await tick();
      turnStdout.write(
        JSON.stringify({ id: 99, method: "exec_command_approval", params: { command: "ls" } }) + "\n",
      );

      await tick();
      turnStdout.write(JSON.stringify({ method: "turn/completed", params: {} }) + "\n");

      await turnPromise;

      // Check that approval was sent
      const approvalMsg = written.find((w) => w.includes('"id":99'));
      expect(approvalMsg).toBeDefined();
      expect(approvalMsg).toContain('"approved":true');
      expect(events.some((e) => e.event === "approval_auto_approved")).toBe(true);
    });
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
