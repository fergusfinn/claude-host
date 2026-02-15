#!/usr/bin/env node
/**
 * codex-normalize.mjs — stdin filter that translates Codex CLI NDJSON events
 * into Claude-compatible rich session events.
 *
 * Plain ESM JavaScript — runs with `node`, no tsx/transpiler needed.
 *
 * Codex event types:
 *   thread.started, turn.started, turn.completed, turn.failed
 *   item.started, item.completed (with item.type: agent_message, command_execution, etc.)
 *   error
 *
 * Claude event types we emit:
 *   system (init), assistant, result
 */

import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin });

let initialized = false;
let sessionId = "";

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }

  const type = event.type;

  switch (type) {
    case "thread.started": {
      sessionId = event.thread_id || "";
      if (!initialized) {
        initialized = true;
        emit({ type: "system", subtype: "init", session_id: sessionId });
      }
      break;
    }

    case "turn.started": {
      // Nothing to emit — just marks the start of processing
      break;
    }

    case "item.started": {
      const item = event.item;
      if (!item) break;
      const itemType = item.type;

      if (itemType === "command_execution" || itemType === "local_shell_call") {
        // Emit as a tool_use block so the UI shows the command
        const toolUseId = item.id || `codex-${Date.now()}`;
        emit({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: toolUseId,
              name: "Bash",
              input: { command: item.command || "", description: "" },
            }],
          },
          session_id: sessionId,
        });
      } else if (itemType === "file_change" || itemType === "file_edit") {
        const toolUseId = item.id || `codex-${Date.now()}`;
        emit({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: toolUseId,
              name: "Edit",
              input: {
                file_path: item.filename || item.file || "",
                old_string: "",
                new_string: item.content || item.diff || "",
              },
            }],
          },
          session_id: sessionId,
        });
      }
      break;
    }

    case "item.completed": {
      const item = event.item;
      if (!item) break;
      const itemType = item.type || "";

      if (itemType === "agent_message" || itemType === "assistant_message") {
        const text = item.text || "";
        if (text) {
          emit({
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text }],
            },
            session_id: sessionId,
          });
        }
      } else if (itemType === "command_execution" || itemType === "local_shell_call") {
        // Emit tool_result for the completed command
        const toolUseId = item.id || "";
        const output = item.aggregated_output || item.output || item.stdout || "";
        const exitCode = item.exit_code ?? item.exitCode ?? 0;
        emit({
          type: "user",
          message: {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolUseId,
              content: output || `(exit code ${exitCode})`,
              is_error: exitCode !== 0,
            }],
          },
        });
      } else if (itemType === "file_change" || itemType === "file_edit") {
        const toolUseId = item.id || "";
        emit({
          type: "user",
          message: {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: toolUseId,
              content: "File updated",
              is_error: false,
            }],
          },
        });
      } else if (itemType === "reasoning") {
        // Codex reasoning — emit as assistant text in italics
        const text = item.text || item.summary || "";
        if (text) {
          emit({
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: `*${text}*` }],
            },
            session_id: sessionId,
          });
        }
      }
      break;
    }

    case "turn.completed": {
      const usage = event.usage;
      emit({
        type: "result",
        session_id: sessionId,
        num_turns: 1,
        ...(usage ? {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        } : {}),
      });
      break;
    }

    case "turn.failed": {
      const errorMsg = event.error || "Turn failed";
      emit({
        type: "result",
        session_id: sessionId,
        is_error: true,
        result: errorMsg,
      });
      break;
    }

    case "error": {
      const errorMsg = event.message || event.error || "Unknown error";
      emit({
        type: "result",
        session_id: sessionId,
        is_error: true,
        result: errorMsg,
      });
      break;
    }

    default:
      // Unknown event type — skip
      break;
  }
});

rl.on("close", () => {
  process.exit(0);
});
