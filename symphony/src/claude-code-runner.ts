// Claude Code agent runner — spawns `claude -p` per turn with --resume for continuity

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { logger } from "./logger.js";
import { SymphonyError, type AgentEvent, type ClaudeConfig, type Issue } from "./types.js";
import type { AgentSession, TurnResult } from "./agent-runner.js";

type EventCallback = (event: AgentEvent) => void;

export class ClaudeCodeRunner {
  private sessionId: string | null = null;
  private workspacePath: string | null = null;
  private activeProcess: ChildProcess | null = null;

  constructor(private config: ClaudeConfig) {}

  async startSession(
    workspacePath: string,
    onEvent: EventCallback,
    _signal?: AbortSignal,
  ): Promise<AgentSession> {
    if (!workspacePath) {
      throw new SymphonyError("invalid_workspace_cwd", "Workspace path is required");
    }

    this.workspacePath = workspacePath;

    onEvent({
      event: "session_started",
      timestamp: new Date(),
      codex_app_server_pid: null,
      message: "Claude Code session initialized (process spawned per turn)",
    });

    // Lightweight session — process is spawned per turn
    return {
      threadId: "",
      turnId: "",
      sessionId: "",
      process: null as unknown as ChildProcess,
      lineIterator: null as unknown as AsyncIterableIterator<string>,
      reader: null as unknown as readline.Interface,
    };
  }

  async runTurn(
    session: AgentSession,
    prompt: string,
    _issue: Issue,
    onEvent: EventCallback,
    signal?: AbortSignal,
  ): Promise<TurnResult> {
    // Build command args
    const parts = [this.config.command, "-p", "--output-format", "stream-json"];
    if (this.config.model) {
      parts.push("--model", this.config.model);
    }
    if (this.sessionId) {
      parts.push("--resume", this.sessionId);
    }

    const cmdStr = parts.join(" ");
    logger.debug("claude spawn", { cmd: cmdStr, cwd: this.workspacePath });

    const proc = spawn("bash", ["-lc", cmdStr], {
      cwd: this.workspacePath!,
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });

    this.activeProcess = proc;

    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      proc.kill();
      throw new SymphonyError("claude_not_found", "Failed to open stdio pipes to claude");
    }

    // Log stderr
    proc.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        logger.debug("claude stderr", { line });
      }
    });

    // Write prompt and close stdin to signal end of input
    proc.stdin.write(prompt);
    proc.stdin.end();

    const reader = readline.createInterface({ input: proc.stdout });
    const aggregateUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

    return new Promise<TurnResult>((resolve) => {
      let resolved = false;

      const finish = (result: TurnResult) => {
        if (resolved) return;
        resolved = true;
        this.activeProcess = null;
        reader.close();
        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        proc.kill();
        finish({ success: false, reason: "turn_timeout", usage: aggregateUsage });
      }, this.config.turn_timeout_ms);

      proc.on("error", (err) => {
        clearTimeout(timeoutHandle);
        finish({ success: false, reason: `process_error: ${err.message}`, usage: aggregateUsage });
      });

      proc.on("exit", (code) => {
        clearTimeout(timeoutHandle);
        if (!resolved) {
          // Process exited without a result event — treat exit 0 as success
          finish({
            success: code === 0,
            reason: code === 0 ? "completed" : `exit_code_${code}`,
            usage: aggregateUsage,
          });
        }
      });

      reader.on("line", (line) => {
        const text = line.trim();
        if (!text) return;

        let msg: any;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }

        // Extract session_id for --resume on next turn
        if (msg.session_id) {
          this.sessionId = msg.session_id;
          session.sessionId = msg.session_id;
        }

        const type = msg.type;
        const subtype = msg.subtype;

        // System init — session metadata
        if (type === "system" && subtype === "init") {
          onEvent({
            event: "session_started",
            timestamp: new Date(),
            codex_app_server_pid: proc.pid ?? null,
            message: `Claude session: ${msg.session_id ?? "unknown"}`,
          });
          return;
        }

        // Result event — turn is done
        if (type === "result") {
          if (msg.usage) {
            aggregateUsage.input_tokens = msg.usage.input_tokens ?? 0;
            aggregateUsage.output_tokens = msg.usage.output_tokens ?? 0;
            aggregateUsage.total_tokens =
              (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
          }

          const success = !msg.is_error;
          clearTimeout(timeoutHandle);

          onEvent({
            event: success ? "turn_completed" : "turn_failed",
            timestamp: new Date(),
            codex_app_server_pid: proc.pid ?? null,
            usage: { ...aggregateUsage },
            message: success ? "Turn completed" : (msg.error ?? "Turn failed"),
          });

          finish({ success, reason: success ? "completed" : "turn_failed", usage: aggregateUsage });
          return;
        }

        // Tool use — report as notification
        if (type === "assistant" && subtype === "tool_use") {
          onEvent({
            event: "notification",
            timestamp: new Date(),
            codex_app_server_pid: proc.pid ?? null,
            message: `tool: ${msg.tool_name ?? "unknown"}`,
          });
          return;
        }

        // All other events
        onEvent({
          event: "notification",
          timestamp: new Date(),
          codex_app_server_pid: proc.pid ?? null,
          message: `${type ?? "unknown"}${subtype ? `:${subtype}` : ""}`,
        });
      });
    });
  }

  stopSession(_session: AgentSession): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill("SIGTERM");
      } catch {
        // may already be dead
      }
      this.activeProcess = null;
    }
  }
}
