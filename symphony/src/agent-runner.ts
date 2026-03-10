// Codex app-server protocol client — spec §10

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { logger } from "./logger.js";
import { SymphonyError, type AgentEvent, type AgentEventType, type CodexConfig, type Issue } from "./types.js";

export interface AgentSession {
  threadId: string;
  turnId: string;
  sessionId: string;
  process: ChildProcess;
  lineIterator: AsyncIterableIterator<string>;
  reader: readline.Interface;
}

export interface TurnResult {
  success: boolean;
  reason: string;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

type EventCallback = (event: AgentEvent) => void;

export class AgentRunner {
  private nextId = 1;

  constructor(private config: CodexConfig) {}

  // Launch codex app-server and perform startup handshake
  async startSession(
    workspacePath: string,
    onEvent: EventCallback,
    signal?: AbortSignal,
  ): Promise<AgentSession> {
    // Validate workspace
    if (!workspacePath) {
      throw new SymphonyError("invalid_workspace_cwd", "Workspace path is required");
    }

    // Launch subprocess — §10.1
    const proc = spawn("bash", ["-lc", this.config.command], {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });

    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      proc.kill();
      throw new SymphonyError("codex_not_found", "Failed to open stdio pipes to codex app-server");
    }

    // Log stderr as diagnostics (not protocol)
    proc.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        logger.debug("codex stderr", { line });
      }
    });

    const reader = readline.createInterface({ input: proc.stdout });
    const lineIterator = reader[Symbol.asyncIterator]();

    try {
      // Step 1: initialize — §10.2
      const initId = this.nextId++;
      this.send(proc, {
        id: initId,
        method: "initialize",
        params: {
          clientInfo: { name: "symphony", version: "1.0" },
          capabilities: {},
        },
      });

      await this.readResponse(lineIterator, initId, this.config.read_timeout_ms, "initialize");

      // Step 2: initialized notification
      this.send(proc, { method: "initialized", params: {} });

      // Step 3: thread/start
      const threadId = this.nextId++;
      this.send(proc, {
        id: threadId,
        method: "thread/start",
        params: {
          approvalPolicy: this.config.approval_policy,
          sandbox: this.config.thread_sandbox,
          cwd: workspacePath,
        },
      });

      const threadResult = await this.readResponse(lineIterator, threadId, this.config.read_timeout_ms, "thread/start");
      const threadIdValue = threadResult?.result?.thread?.id;
      if (!threadIdValue) {
        throw new SymphonyError("response_error", "thread/start did not return thread.id");
      }

      const pid = proc.pid ?? null;

      onEvent({
        event: "session_started",
        timestamp: new Date(),
        codex_app_server_pid: pid,
        message: `Session started, thread=${threadIdValue}`,
      });

      return {
        threadId: threadIdValue,
        turnId: "",
        sessionId: "",
        process: proc,
        lineIterator,
        reader,
      };
    } catch (e) {
      proc.kill();
      reader.close();
      throw e;
    }
  }

  // Run a single turn on an existing session
  async runTurn(
    session: AgentSession,
    prompt: string,
    issue: Issue,
    onEvent: EventCallback,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const proc = session.process;
    const lineIterator = session.lineIterator;

    // Send turn/start — §10.2 step 4
    const turnReqId = this.nextId++;
    this.send(proc, {
      id: turnReqId,
      method: "turn/start",
      params: {
        threadId: session.threadId,
        input: [{ type: "text", text: prompt }],
        title: `${issue.identifier}: ${issue.title}`,
        approvalPolicy: this.config.approval_policy,
        sandboxPolicy: this.config.turn_sandbox_policy,
      },
    });

    const turnResult = await this.readResponse(lineIterator, turnReqId, this.config.read_timeout_ms, "turn/start");
    const turnId = turnResult?.result?.turn?.id ?? `turn-${Date.now()}`;
    session.turnId = turnId;
    session.sessionId = `${session.threadId}-${turnId}`;

    // Stream turn events until completion — §10.3
    return await this.streamTurn(session, lineIterator, onEvent, signal);
  }

  private async streamTurn(
    session: AgentSession,
    lineIterator: AsyncIterableIterator<string>,
    onEvent: EventCallback,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    const proc = session.process;
    const turnTimeoutMs = this.config.turn_timeout_ms;
    const startTime = Date.now();
    let aggregateUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    while (true) {
      // Check turn timeout
      if (Date.now() - startTime > turnTimeoutMs) {
        return { success: false, reason: "turn_timeout", usage: aggregateUsage };
      }

      // Check abort signal
      if (signal?.aborted) {
        return { success: false, reason: "cancelled", usage: aggregateUsage };
      }

      // Read next line with timeout
      const line = await Promise.race([
        lineIterator.next(),
        this.timeout(turnTimeoutMs - (Date.now() - startTime)),
      ]);

      if (!line || line.done) {
        // Process exited
        return { success: false, reason: "port_exit", usage: aggregateUsage };
      }

      const text = line.value.trim();
      if (!text) continue;

      logger.debug("codex recv (stream)", { line: text.slice(0, 500) });

      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        onEvent({
          event: "malformed",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          message: text.slice(0, 200),
        });
        continue;
      }

      // Handle different message types
      const method = msg.method;

      // Turn completion events — §10.3
      if (method === "turn/completed") {
        this.extractUsage(msg, aggregateUsage);
        onEvent({
          event: "turn_completed",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          usage: { ...aggregateUsage },
          message: "Turn completed",
        });
        return { success: true, reason: "completed", usage: aggregateUsage };
      }

      if (method === "turn/failed") {
        this.extractUsage(msg, aggregateUsage);
        onEvent({
          event: "turn_failed",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          usage: { ...aggregateUsage },
          message: msg.params?.error ?? "Turn failed",
        });
        return { success: false, reason: "turn_failed", usage: aggregateUsage };
      }

      if (method === "turn/cancelled") {
        this.extractUsage(msg, aggregateUsage);
        onEvent({
          event: "turn_cancelled",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          usage: { ...aggregateUsage },
          message: "Turn cancelled",
        });
        return { success: false, reason: "turn_cancelled", usage: aggregateUsage };
      }

      // Approval requests — auto-approve everything — §10.5
      if (msg.method === "item/approval/request" ||
          msg.method === "exec_command_approval" ||
          msg.method === "apply_patch_approval" ||
          msg.method === "file_change_approval" ||
          msg.method === "command_execution_request_approval" ||
          msg.method === "permissions_request_approval") {
        if (msg.id) {
          this.send(proc, { id: msg.id, result: { approved: true } });
          onEvent({
            event: "approval_auto_approved",
            timestamp: new Date(),
            codex_app_server_pid: proc.pid ?? null,
            message: `Auto-approved: ${msg.method}`,
          });
        }
        continue;
      }

      // User input required — fail immediately — §10.5
      if (msg.method === "item/tool/requestUserInput" ||
          (msg.params?.inputRequired === true)) {
        onEvent({
          event: "turn_input_required",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          message: "User input requested — failing run",
        });
        return { success: false, reason: "turn_input_required", usage: aggregateUsage };
      }

      // Unsupported dynamic tool calls — reject — §10.5
      if (msg.method === "item/tool/call") {
        if (msg.id) {
          this.send(proc, {
            id: msg.id,
            result: { success: false, error: "unsupported_tool_call" },
          });
          onEvent({
            event: "unsupported_tool_call",
            timestamp: new Date(),
            codex_app_server_pid: proc.pid ?? null,
            message: `Rejected tool call: ${msg.params?.name ?? "unknown"}`,
          });
        }
        continue;
      }

      // Token usage updates
      if (method === "thread/tokenUsage/updated") {
        this.extractUsage(msg, aggregateUsage);
        continue;
      }

      // Rate limit info
      if (msg.params?.rateLimit || msg.params?.rate_limit) {
        onEvent({
          event: "other_message",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          payload: msg.params.rateLimit ?? msg.params.rate_limit,
          message: "rate_limit_update",
        });
        continue;
      }

      // Notifications / other messages
      onEvent({
        event: "notification",
        timestamp: new Date(),
        codex_app_server_pid: proc.pid ?? null,
        message: this.summarizeMessage(msg),
        payload: msg,
      });

      this.extractUsage(msg, aggregateUsage);
    }
  }

  stopSession(session: AgentSession): void {
    try {
      session.reader.close();
    } catch {
      // may already be closed
    }
    try {
      session.process.kill("SIGTERM");
    } catch {
      // process may have already exited
    }
  }

  private send(proc: ChildProcess, msg: any): void {
    if (!proc.stdin?.writable) return;
    const line = JSON.stringify(msg) + "\n";
    logger.debug("codex send", { method: msg.method ?? "response", id: String(msg.id ?? ""), line: line.slice(0, 300) });
    proc.stdin.write(line);
  }

  private async readResponse(
    lineIterator: AsyncIterableIterator<string>,
    expectedId: number,
    timeoutMs: number,
    label: string,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const result = await Promise.race([
        lineIterator.next(),
        this.timeout(remaining),
      ]);

      if (!result || result.done) {
        throw new SymphonyError("port_exit", `codex app-server exited during ${label}`);
      }

      const text = result.value.trim();
      if (!text) continue;

      logger.debug("codex recv (handshake)", { label, line: text.slice(0, 300) });

      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        continue; // skip non-JSON lines during handshake
      }

      if (msg.id === expectedId) {
        if (msg.error) {
          throw new SymphonyError(
            "response_error",
            `${label} error: ${JSON.stringify(msg.error)}`,
          );
        }
        return msg;
      }

      // Messages with other IDs during handshake — skip
    }

    throw new SymphonyError("response_timeout", `Timed out waiting for ${label} response`);
  }

  private timeout(ms: number): Promise<undefined> {
    return new Promise((resolve) => setTimeout(() => resolve(undefined), Math.max(ms, 0)));
  }

  private extractUsage(msg: any, agg: { input_tokens: number; output_tokens: number; total_tokens: number }): void {
    // Prefer absolute thread totals (§13.5)
    const usage =
      msg.params?.total_token_usage ??
      msg.params?.tokenUsage ??
      msg.params?.usage ??
      msg.result?.usage;

    if (!usage) return;

    const input = usage.input_tokens ?? usage.inputTokens ?? 0;
    const output = usage.output_tokens ?? usage.outputTokens ?? 0;
    const total = usage.total_tokens ?? usage.totalTokens ?? (input + output);

    // Use absolute values if they're larger than what we've seen
    if (total > agg.total_tokens) {
      agg.input_tokens = input;
      agg.output_tokens = output;
      agg.total_tokens = total;
    }
  }

  private summarizeMessage(msg: any): string {
    const method = msg.method ?? msg.type ?? "unknown";
    if (msg.params?.message) return `${method}: ${String(msg.params.message).slice(0, 200)}`;
    if (msg.params?.text) return `${method}: ${String(msg.params.text).slice(0, 200)}`;
    return method;
  }
}
