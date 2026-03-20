// Symphony domain model — spec §4.1

// §4.1.1 Issue
export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: Date | null;
  updated_at: Date | null;
}

// §4.1.2 Workflow Definition
export interface WorkflowDefinition {
  config: Record<string, unknown>;
  prompt_template: string;
}

// §4.1.3 Service Config
export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string;
  project_slug: string;
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface AgentConfig {
  kind: "codex" | "claude";
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Map<string, number>;
}

export interface CodexConfig {
  command: string;
  approval_policy: unknown;
  thread_sandbox: string;
  turn_sandbox_policy: unknown;
  turn_timeout_ms: number;
  read_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface ClaudeConfig {
  command: string;
  model: string | null;
  turn_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface ServerConfig {
  port: number | null;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  agent: AgentConfig;
  codex: CodexConfig;
  claude: ClaudeConfig;
  server: ServerConfig;
}

// §4.1.4 Workspace
export interface Workspace {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

// §4.1.5 Run Attempt
export type RunAttemptStatus =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgentProcess"
  | "InitializingSession"
  | "StreamingTurn"
  | "Finishing"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "CanceledByReconciliation";

export interface RunAttempt {
  issue_id: string;
  issue_identifier: string;
  attempt: number | null;
  workspace_path: string;
  started_at: Date;
  status: RunAttemptStatus;
  error?: string;
}

// §4.1.6 Live Session
export interface LiveSession {
  session_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  codex_app_server_pid: number | null;
  last_codex_event: string | null;
  last_codex_timestamp: Date | null;
  last_codex_message: string | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  turn_count: number;
}

// §4.1.7 Retry Entry
export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout>;
  error: string | null;
}

// Running entry — combines LiveSession with worker context
export interface RunningEntry extends LiveSession {
  issue: Issue;
  identifier: string;
  started_at: Date;
  retry_attempt: number;
  worker_abort: AbortController;
}

// §4.1.8 Orchestrator Runtime State
export interface CodexTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codex_totals: CodexTotals;
  codex_rate_limits: unknown | null;
}

// Agent runner events — §10.4
export type AgentEventType =
  | "session_started"
  | "startup_failed"
  | "turn_completed"
  | "turn_failed"
  | "turn_cancelled"
  | "turn_ended_with_error"
  | "turn_input_required"
  | "approval_auto_approved"
  | "unsupported_tool_call"
  | "notification"
  | "other_message"
  | "malformed";

export interface AgentEvent {
  event: AgentEventType;
  timestamp: Date;
  codex_app_server_pid: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  payload?: unknown;
  message?: string;
}

// Workflow error types — §5.5
export class SymphonyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "SymphonyError";
  }
}
