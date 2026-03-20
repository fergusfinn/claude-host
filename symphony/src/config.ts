// Typed config layer — spec §5.3, §6

import * as os from "node:os";
import * as path from "node:path";
import { SymphonyError, type ServiceConfig } from "./types.js";

function resolveEnvVar(value: string): string {
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    return process.env[varName] ?? "";
  }
  return value;
}

function expandPath(value: string): string {
  if (value.startsWith("~")) {
    return path.join(os.homedir(), value.slice(1));
  }
  // Only expand env vars for path-like values (contain separators)
  if (value.startsWith("$")) {
    return resolveEnvVar(value);
  }
  return value;
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringList(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim());
  return fallback;
}

function normalizeState(s: string): string {
  return s.trim().toLowerCase();
}

export function parseConfig(raw: Record<string, unknown>): ServiceConfig {
  const tracker = (raw.tracker ?? {}) as Record<string, unknown>;
  const polling = (raw.polling ?? {}) as Record<string, unknown>;
  const workspace = (raw.workspace ?? {}) as Record<string, unknown>;
  const hooks = (raw.hooks ?? {}) as Record<string, unknown>;
  const agent = (raw.agent ?? {}) as Record<string, unknown>;
  const codex = (raw.codex ?? {}) as Record<string, unknown>;
  const claude = (raw.claude ?? {}) as Record<string, unknown>;
  const heartbeat = (raw.heartbeat ?? {}) as Record<string, unknown>;
  const server = (raw.server ?? {}) as Record<string, unknown>;

  // Tracker
  const trackerKind = tracker.kind as string | undefined;
  const trackerEndpoint =
    typeof tracker.endpoint === "string"
      ? tracker.endpoint
      : trackerKind === "linear"
        ? "https://api.linear.app/graphql"
        : "";

  let trackerApiKey = "";
  if (typeof tracker.api_key === "string") {
    trackerApiKey = resolveEnvVar(tracker.api_key);
  } else if (trackerKind === "linear" && process.env.LINEAR_API_KEY) {
    trackerApiKey = process.env.LINEAR_API_KEY;
  }

  const activeStates = toStringList(tracker.active_states, ["Todo", "In Progress"]);
  const terminalStates = toStringList(tracker.terminal_states, [
    "Closed",
    "Cancelled",
    "Canceled",
    "Duplicate",
    "Done",
  ]);

  // Workspace root
  let workspaceRoot: string;
  if (typeof workspace.root === "string") {
    workspaceRoot = expandPath(workspace.root);
  } else {
    workspaceRoot = path.join(os.tmpdir(), "symphony_workspaces");
  }

  // Per-state concurrency
  const byStateRaw = (agent.max_concurrent_agents_by_state ?? {}) as Record<string, unknown>;
  const byState = new Map<string, number>();
  for (const [k, v] of Object.entries(byStateRaw)) {
    const n = toInt(v, -1);
    if (n > 0) {
      byState.set(normalizeState(k), n);
    }
  }

  // Hook timeout — non-positive falls back to default
  const hookTimeoutRaw = toInt(hooks.timeout_ms, 60000);
  const hookTimeout = hookTimeoutRaw > 0 ? hookTimeoutRaw : 60000;

  // Agent kind — defaults to codex
  const agentKindRaw = (agent.kind as string) ?? "codex";
  const agentKind = agentKindRaw === "claude" ? "claude" : "codex";

  return {
    tracker: {
      kind: (trackerKind ?? "") as string,
      endpoint: trackerEndpoint,
      api_key: trackerApiKey,
      project_slug: (tracker.project_slug ?? "") as string,
      active_states: activeStates,
      terminal_states: terminalStates,
    },
    polling: {
      interval_ms: toInt(polling.interval_ms, 30000),
    },
    workspace: {
      root: workspaceRoot,
    },
    hooks: {
      after_create: (hooks.after_create as string) ?? null,
      before_run: (hooks.before_run as string) ?? null,
      after_run: (hooks.after_run as string) ?? null,
      before_remove: (hooks.before_remove as string) ?? null,
      timeout_ms: hookTimeout,
    },
    agent: {
      kind: agentKind,
      max_concurrent_agents: toInt(agent.max_concurrent_agents, 10),
      max_turns: toInt(agent.max_turns, 20),
      max_retry_backoff_ms: toInt(agent.max_retry_backoff_ms, 300000),
      max_concurrent_agents_by_state: byState,
    },
    codex: {
      command: (codex.command as string) ?? "codex app-server",
      approval_policy: codex.approval_policy ?? "never",
      thread_sandbox: (codex.thread_sandbox as string) ?? "danger-full-access",
      turn_sandbox_policy: codex.turn_sandbox_policy ?? { type: "dangerFullAccess" },
      turn_timeout_ms: toInt(codex.turn_timeout_ms, 3600000),
      read_timeout_ms: toInt(codex.read_timeout_ms, 5000),
      stall_timeout_ms: toInt(codex.stall_timeout_ms, 300000),
    },
    claude: {
      command: (claude.command as string) ?? "claude",
      model: (claude.model as string) ?? null,
      turn_timeout_ms: toInt(claude.turn_timeout_ms, 3600000),
      stall_timeout_ms: toInt(claude.stall_timeout_ms, 300000),
    },
    heartbeat: {
      enabled: heartbeat.enabled === true || (heartbeat.enabled !== false && typeof heartbeat.command === "string"),
      interval_ms: toInt(heartbeat.interval_ms, 60000),
      command: (heartbeat.command as string) ?? "",
      prompt_template: (heartbeat.prompt_template as string) ?? "",
    },
    server: {
      port: server.port !== undefined ? toInt(server.port, 0) : null,
    },
  };
}

// §6.3 Dispatch preflight validation
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateDispatchConfig(config: ServiceConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.tracker.kind) {
    errors.push("tracker.kind is required");
  } else if (config.tracker.kind !== "linear") {
    errors.push(`unsupported tracker kind: ${config.tracker.kind}`);
  }

  if (!config.tracker.api_key) {
    errors.push("tracker.api_key is required (set $LINEAR_API_KEY or tracker.api_key in WORKFLOW.md)");
  }

  if (config.tracker.kind === "linear" && !config.tracker.project_slug) {
    errors.push("tracker.project_slug is required for linear tracker");
  }

  if (config.agent.kind === "codex" && !config.codex.command) {
    errors.push("codex.command must be non-empty");
  }
  if (config.agent.kind === "claude" && !config.claude.command) {
    errors.push("claude.command must be non-empty");
  }

  if (config.heartbeat.enabled && !config.heartbeat.command) {
    errors.push("heartbeat.command is required when heartbeat is enabled");
  }

  return { ok: errors.length === 0, errors };
}
