// Orchestrator — spec §7, §8, §16

import { watch, type FSWatcher } from "chokidar";
import { logger } from "./logger.js";
import { loadWorkflow } from "./workflow-loader.js";
import { parseConfig, validateDispatchConfig, type ValidationResult } from "./config.js";
import { renderPrompt } from "./prompt.js";
import { LinearClient } from "./linear-client.js";
import { WorkspaceManager } from "./workspace.js";
import { AgentRunner, type AgentSession } from "./agent-runner.js";
import { ClaudeCodeRunner } from "./claude-code-runner.js";
import type {
  ServiceConfig,
  Issue,
  OrchestratorState,
  RunningEntry,
  RetryEntry,
  AgentEvent,
  WorkflowDefinition,
} from "./types.js";

export class Orchestrator {
  private state: OrchestratorState;
  private config!: ServiceConfig;
  private promptTemplate = "";
  private workflowPath: string;
  private watcher: FSWatcher | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(workflowPath: string) {
    this.workflowPath = workflowPath;
    this.state = {
      poll_interval_ms: 30000,
      max_concurrent_agents: 10,
      running: new Map(),
      claimed: new Set(),
      retry_attempts: new Map(),
      completed: new Set(),
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
      codex_rate_limits: null,
    };
  }

  // §16.1 — Service startup
  async start(): Promise<void> {
    logger.info("Starting Symphony orchestrator", { workflow: this.workflowPath });

    // Load and validate workflow
    this.reloadWorkflow();

    const validation = validateDispatchConfig(this.config);
    if (!validation.ok) {
      for (const err of validation.errors) {
        logger.error("Config validation failed", { error: err });
      }
      throw new Error(`Startup validation failed: ${validation.errors.join("; ")}`);
    }

    // Apply config to state
    this.state.poll_interval_ms = this.config.polling.interval_ms;
    this.state.max_concurrent_agents = this.config.agent.max_concurrent_agents;

    // Start workflow file watch — §6.2
    this.watcher = watch(this.workflowPath, { ignoreInitial: true });
    this.watcher.on("change", () => {
      logger.info("WORKFLOW.md changed, reloading");
      try {
        this.reloadWorkflow();
        this.state.poll_interval_ms = this.config.polling.interval_ms;
        this.state.max_concurrent_agents = this.config.agent.max_concurrent_agents;
        logger.info("Workflow reloaded successfully");
      } catch (e) {
        logger.error("Workflow reload failed, keeping last good config", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });

    // Startup terminal workspace cleanup — §8.6
    await this.startupTerminalCleanup();

    // Schedule immediate tick
    this.scheduleTick(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.watcher?.close();

    // Terminate all running workers
    for (const [issueId, entry] of this.state.running) {
      logger.info("Stopping worker on shutdown", { issue_id: issueId, issue_identifier: entry.identifier });
      entry.worker_abort.abort();
    }

    // Clear all retry timers
    for (const [, entry] of this.state.retry_attempts) {
      clearTimeout(entry.timer_handle);
    }

    logger.info("Orchestrator stopped");
  }

  getState(): OrchestratorState {
    return this.state;
  }

  getConfig(): ServiceConfig {
    return this.config;
  }

  getWorkflowPath(): string {
    return this.workflowPath;
  }

  // Trigger an immediate poll+reconcile (for /api/v1/refresh)
  triggerRefresh(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }
    this.scheduleTick(0);
  }

  private reloadWorkflow(): void {
    const workflow = loadWorkflow(this.workflowPath);
    this.config = parseConfig(workflow.config);
    this.promptTemplate = workflow.prompt_template;
  }

  // §16.2 — Poll tick
  private async onTick(): Promise<void> {
    if (this.stopped) return;

    try {
      // Step 1: Reconcile running issues
      await this.reconcileRunningIssues();

      // Step 2: Validate dispatch config
      // Re-read workflow defensively (§6.2 — re-validate during runtime operations)
      try {
        this.reloadWorkflow();
      } catch {
        // Keep last good config
      }

      const validation = validateDispatchConfig(this.config);
      if (!validation.ok) {
        logger.error("Dispatch config invalid, skipping dispatch", { errors: validation.errors.join("; ") });
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // Step 3: Fetch candidate issues
      const client = new LinearClient(this.config.tracker.endpoint, this.config.tracker.api_key);
      let candidates: Issue[];
      try {
        candidates = await client.fetchCandidateIssues(
          this.config.tracker.project_slug,
          this.config.tracker.active_states,
        );
      } catch (e) {
        logger.error("Failed to fetch candidate issues", {
          error: e instanceof Error ? e.message : String(e),
        });
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // Step 4: Sort candidates — §8.2
      const sorted = this.sortForDispatch(candidates);

      // Step 5: Dispatch eligible issues
      for (const issue of sorted) {
        if (this.availableSlots() <= 0) break;
        if (this.shouldDispatch(issue)) {
          this.dispatchIssue(issue, null);
        }
      }
    } catch (e) {
      logger.error("Tick error", { error: e instanceof Error ? e.message : String(e) });
    }

    // Schedule next tick
    this.scheduleTick(this.state.poll_interval_ms);
  }

  private scheduleTick(delayMs: number): void {
    if (this.stopped) return;
    this.tickTimer = setTimeout(() => this.onTick(), delayMs);
  }

  // §8.2 — Candidate selection
  private shouldDispatch(issue: Issue): boolean {
    if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;

    const normState = issue.state.trim().toLowerCase();
    const activeNorm = this.config.tracker.active_states.map((s) => s.trim().toLowerCase());
    const terminalNorm = this.config.tracker.terminal_states.map((s) => s.trim().toLowerCase());

    if (!activeNorm.includes(normState)) return false;
    if (terminalNorm.includes(normState)) return false;
    if (this.state.running.has(issue.id)) return false;
    if (this.state.claimed.has(issue.id)) return false;

    // Global concurrency
    if (this.availableSlots() <= 0) return false;

    // Per-state concurrency
    const stateLimit = this.config.agent.max_concurrent_agents_by_state.get(normState);
    if (stateLimit !== undefined) {
      const runningInState = [...this.state.running.values()].filter(
        (e) => e.issue.state.trim().toLowerCase() === normState,
      ).length;
      if (runningInState >= stateLimit) return false;
    }

    // Blocker rule: "todo" state with non-terminal blockers → skip
    if (normState === "todo" && issue.blocked_by.length > 0) {
      const hasNonTerminalBlocker = issue.blocked_by.some((b) => {
        if (!b.state) return true; // unknown state = assume blocking
        return !terminalNorm.includes(b.state.trim().toLowerCase());
      });
      if (hasNonTerminalBlocker) return false;
    }

    return true;
  }

  // §8.2 — Sort order
  private sortForDispatch(issues: Issue[]): Issue[] {
    return [...issues].sort((a, b) => {
      // Priority ascending (null last)
      const pa = a.priority ?? Infinity;
      const pb = b.priority ?? Infinity;
      if (pa !== pb) return pa - pb;

      // Created at oldest first
      const ca = a.created_at?.getTime() ?? Infinity;
      const cb = b.created_at?.getTime() ?? Infinity;
      if (ca !== cb) return ca - cb;

      // Identifier lexicographic
      return a.identifier.localeCompare(b.identifier);
    });
  }

  private availableSlots(): number {
    return Math.max(this.state.max_concurrent_agents - this.state.running.size, 0);
  }

  // §16.4 — Dispatch one issue
  private dispatchIssue(issue: Issue, attempt: number | null): void {
    const logCtx = { issue_id: issue.id, issue_identifier: issue.identifier };
    logger.info("Dispatching issue", { ...logCtx, attempt: attempt ?? "first" });

    this.state.claimed.add(issue.id);
    // Clear any existing retry
    const existingRetry = this.state.retry_attempts.get(issue.id);
    if (existingRetry) {
      clearTimeout(existingRetry.timer_handle);
      this.state.retry_attempts.delete(issue.id);
    }

    const abort = new AbortController();

    const runningEntry: RunningEntry = {
      issue,
      identifier: issue.identifier,
      started_at: new Date(),
      retry_attempt: attempt ?? 0,
      worker_abort: abort,
      session_id: null,
      thread_id: null,
      turn_id: null,
      codex_app_server_pid: null,
      last_codex_event: null,
      last_codex_timestamp: null,
      last_codex_message: null,
      codex_input_tokens: 0,
      codex_output_tokens: 0,
      codex_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
    };

    this.state.running.set(issue.id, runningEntry);

    // Spawn worker (async, fire and forget)
    this.runWorker(issue, attempt, runningEntry, abort.signal).catch((e) => {
      logger.error("Worker crashed", {
        ...logCtx,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  // §16.5 — Worker attempt
  private async runWorker(
    issue: Issue,
    attempt: number | null,
    entry: RunningEntry,
    signal: AbortSignal,
  ): Promise<void> {
    const logCtx = { issue_id: issue.id, issue_identifier: issue.identifier };
    const wsManager = new WorkspaceManager(this.config.workspace.root);
    let workspace;
    let session: AgentSession | undefined;

    try {
      // Prepare workspace
      try {
        workspace = wsManager.createForIssue(issue.identifier, this.config.hooks);
      } catch (e) {
        throw new Error(`workspace error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Before_run hook
      if (this.config.hooks.before_run) {
        try {
          wsManager.runHook("before_run", this.config.hooks.before_run, workspace.path, this.config.hooks.timeout_ms);
        } catch (e) {
          throw new Error(`before_run hook error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Validate workspace cwd
      wsManager.validateWorkspaceCwd(workspace.path);

      const agentKind = this.config.agent.kind;
      logger.info(`Workspace ready, launching ${agentKind} agent`, { ...logCtx, workspace: workspace.path });

      // Start agent session — pick runner based on config
      const runner: AgentRunner | ClaudeCodeRunner =
        agentKind === "claude"
          ? new ClaudeCodeRunner(this.config.claude)
          : new AgentRunner(this.config.codex);
      const onEvent = (event: AgentEvent) => this.handleAgentEvent(issue.id, event);

      try {
        session = await runner.startSession(workspace.path, onEvent, signal);
        logger.info(`${agentKind} session started`, { ...logCtx, thread_id: session.threadId });
      } catch (e) {
        this.runHookBestEffort(wsManager, "after_run", workspace.path);
        throw new Error(`agent session startup error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Multi-turn loop — §16.5
      const maxTurns = this.config.agent.max_turns;
      let turnNumber = 1;
      let currentIssue = issue;

      while (!signal.aborted) {
        // Build prompt
        let prompt: string;
        try {
          if (turnNumber === 1) {
            prompt = renderPrompt(this.promptTemplate, currentIssue, attempt);
          } else {
            // Continuation turns — send guidance, not full prompt
            prompt = `Continue working on ${currentIssue.identifier}: ${currentIssue.title}. Check your progress and continue from where you left off. This is turn ${turnNumber} of ${maxTurns}.`;
          }
        } catch (e) {
          runner.stopSession(session);
          this.runHookBestEffort(wsManager, "after_run", workspace.path);
          throw new Error(`prompt error: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Run turn
        const turnResult = await runner.runTurn(session, prompt, currentIssue, onEvent, signal);
        entry.turn_count++;

        if (!turnResult.success) {
          runner.stopSession(session);
          this.runHookBestEffort(wsManager, "after_run", workspace.path);
          throw new Error(`agent turn error: ${turnResult.reason}`);
        }

        // Re-check issue state from tracker
        const client = new LinearClient(this.config.tracker.endpoint, this.config.tracker.api_key);
        try {
          const refreshed = await client.fetchIssueStatesByIds([currentIssue.id]);
          if (refreshed.length > 0) {
            const newState = refreshed[0].state;
            currentIssue = { ...currentIssue, state: newState };
            // Update running entry
            const running = this.state.running.get(issue.id);
            if (running) running.issue = currentIssue;
          }
        } catch (e) {
          runner.stopSession(session);
          this.runHookBestEffort(wsManager, "after_run", workspace.path);
          throw new Error(`issue state refresh error: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Check if issue is still active
        const normState = currentIssue.state.trim().toLowerCase();
        const activeNorm = this.config.tracker.active_states.map((s) => s.trim().toLowerCase());
        if (!activeNorm.includes(normState)) {
          logger.info("Issue no longer active after turn", { ...logCtx, state: currentIssue.state });
          break;
        }

        if (turnNumber >= maxTurns) {
          logger.info("Reached max turns", { ...logCtx, turns: maxTurns });
          break;
        }

        turnNumber++;
      }

      // Clean exit
      runner.stopSession(session);
      this.runHookBestEffort(wsManager, "after_run", workspace.path);

      // Normal exit — §16.6
      this.onWorkerExit(issue.id, "normal");
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error("Worker failed", { ...logCtx, error: errorMsg });

      // Abnormal exit — §16.6
      this.onWorkerExit(issue.id, errorMsg);
    }
  }

  // §16.6 — Worker exit
  private onWorkerExit(issueId: string, reason: string): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    // Add runtime seconds to totals
    const runtimeSec = (Date.now() - entry.started_at.getTime()) / 1000;
    this.state.codex_totals.seconds_running += runtimeSec;

    // Add token totals
    this.state.codex_totals.input_tokens += entry.codex_input_tokens;
    this.state.codex_totals.output_tokens += entry.codex_output_tokens;
    this.state.codex_totals.total_tokens += entry.codex_total_tokens;

    this.state.running.delete(issueId);

    if (reason === "normal") {
      this.state.completed.add(issueId);
      // Schedule continuation retry — 1s delay, attempt=1
      this.scheduleRetry(issueId, 1, entry.identifier, null, true);
    } else {
      // Exponential backoff retry
      const nextAttempt = (entry.retry_attempt || 0) + 1;
      this.scheduleRetry(issueId, nextAttempt, entry.identifier, reason, false);
    }
  }

  // §8.4 — Retry scheduling
  private scheduleRetry(
    issueId: string,
    attempt: number,
    identifier: string,
    error: string | null,
    isContinuation: boolean,
  ): void {
    // Cancel existing retry
    const existing = this.state.retry_attempts.get(issueId);
    if (existing) {
      clearTimeout(existing.timer_handle);
    }

    // Compute delay
    let delayMs: number;
    if (isContinuation) {
      delayMs = 1000; // §8.4 — short fixed delay for continuations
    } else {
      delayMs = Math.min(10000 * Math.pow(2, attempt - 1), this.config.agent.max_retry_backoff_ms);
    }

    const dueAtMs = Date.now() + delayMs;

    logger.info("Scheduling retry", {
      issue_id: issueId,
      issue_identifier: identifier,
      attempt,
      delay_ms: delayMs,
      error: error ?? undefined,
    });

    const timer = setTimeout(() => this.onRetryTimer(issueId), delayMs);

    this.state.retry_attempts.set(issueId, {
      issue_id: issueId,
      identifier,
      attempt,
      due_at_ms: dueAtMs,
      timer_handle: timer,
      error,
    });
  }

  // §16.6 — Retry timer fired
  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId);
    if (!retryEntry) return;
    this.state.retry_attempts.delete(issueId);

    const logCtx = { issue_id: issueId, issue_identifier: retryEntry.identifier };

    // Fetch active candidates
    const client = new LinearClient(this.config.tracker.endpoint, this.config.tracker.api_key);
    let candidates: Issue[];
    try {
      candidates = await client.fetchCandidateIssues(
        this.config.tracker.project_slug,
        this.config.tracker.active_states,
      );
    } catch (e) {
      logger.error("Retry poll failed", { ...logCtx, error: e instanceof Error ? e.message : String(e) });
      this.scheduleRetry(issueId, retryEntry.attempt + 1, retryEntry.identifier, "retry poll failed", false);
      return;
    }

    // Find the issue
    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      // Issue no longer candidate — release claim
      logger.info("Issue no longer candidate, releasing claim", logCtx);
      this.state.claimed.delete(issueId);
      return;
    }

    // Check slots
    if (this.availableSlots() <= 0) {
      logger.info("No slots available for retry", logCtx);
      this.scheduleRetry(issueId, retryEntry.attempt + 1, retryEntry.identifier, "no available orchestrator slots", false);
      return;
    }

    // Re-dispatch
    this.dispatchIssue(issue, retryEntry.attempt);
  }

  // §16.3, §8.5 — Reconcile running issues
  private async reconcileRunningIssues(): Promise<void> {
    // Part A: Stall detection
    const stallTimeout = this.config.agent.kind === "claude"
      ? this.config.claude.stall_timeout_ms
      : this.config.codex.stall_timeout_ms;
    if (stallTimeout > 0) {
      const now = Date.now();
      for (const [issueId, entry] of this.state.running) {
        const lastActivity = entry.last_codex_timestamp ?? entry.started_at;
        const elapsed = now - lastActivity.getTime();
        if (elapsed > stallTimeout) {
          logger.warn("Stalled session detected", {
            issue_id: issueId,
            issue_identifier: entry.identifier,
            elapsed_ms: elapsed,
          });
          entry.worker_abort.abort();
          // Worker exit handler will schedule retry
        }
      }
    }

    // Part B: Tracker state refresh
    const runningIds = [...this.state.running.keys()];
    if (runningIds.length === 0) return;

    const client = new LinearClient(this.config.tracker.endpoint, this.config.tracker.api_key);
    let refreshed: Array<{ id: string; state: string }>;
    try {
      refreshed = await client.fetchIssueStatesByIds(runningIds);
    } catch (e) {
      logger.debug("State refresh failed, keeping workers", {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    const terminalNorm = this.config.tracker.terminal_states.map((s) => s.trim().toLowerCase());
    const activeNorm = this.config.tracker.active_states.map((s) => s.trim().toLowerCase());
    const wsManager = new WorkspaceManager(this.config.workspace.root);

    for (const item of refreshed) {
      const entry = this.state.running.get(item.id);
      if (!entry) continue;

      const normState = item.state.trim().toLowerCase();

      if (terminalNorm.includes(normState)) {
        // Terminal — stop and clean workspace
        logger.info("Issue reached terminal state, stopping", {
          issue_id: item.id,
          issue_identifier: entry.identifier,
          state: item.state,
        });
        entry.worker_abort.abort();
        wsManager.removeWorkspace(entry.identifier, this.config.hooks);
      } else if (activeNorm.includes(normState)) {
        // Still active — update snapshot
        entry.issue = { ...entry.issue, state: item.state };
      } else {
        // Neither active nor terminal — stop without cleanup
        logger.info("Issue no longer active, stopping", {
          issue_id: item.id,
          issue_identifier: entry.identifier,
          state: item.state,
        });
        entry.worker_abort.abort();
      }
    }
  }

  // §8.6 — Startup terminal workspace cleanup
  private async startupTerminalCleanup(): Promise<void> {
    const client = new LinearClient(this.config.tracker.endpoint, this.config.tracker.api_key);
    const wsManager = new WorkspaceManager(this.config.workspace.root);

    try {
      const terminalIssues = await client.fetchIssuesByStates(this.config.tracker.terminal_states);
      for (const issue of terminalIssues) {
        wsManager.removeWorkspace(issue.identifier, this.config.hooks);
      }
      logger.info("Startup terminal cleanup complete", { cleaned: terminalIssues.length });
    } catch (e) {
      logger.warn("Startup terminal cleanup failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Handle agent events — update running entry
  private handleAgentEvent(issueId: string, event: AgentEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    entry.last_codex_event = event.event;
    entry.last_codex_timestamp = event.timestamp;
    entry.last_codex_message = event.message ?? null;

    if (event.codex_app_server_pid) {
      entry.codex_app_server_pid = event.codex_app_server_pid;
    }

    if (event.event === "session_started" && event.message) {
      const threadMatch = event.message.match(/thread=(.+)/);
      if (threadMatch) entry.thread_id = threadMatch[1];
    }

    // Update token counters — §13.5
    if (event.usage) {
      const { input_tokens = 0, output_tokens = 0, total_tokens = 0 } = event.usage;
      if (total_tokens > entry.codex_total_tokens) {
        const inputDelta = input_tokens - entry.last_reported_input_tokens;
        const outputDelta = output_tokens - entry.last_reported_output_tokens;
        const totalDelta = total_tokens - entry.last_reported_total_tokens;

        entry.codex_input_tokens += Math.max(inputDelta, 0);
        entry.codex_output_tokens += Math.max(outputDelta, 0);
        entry.codex_total_tokens += Math.max(totalDelta, 0);

        entry.last_reported_input_tokens = input_tokens;
        entry.last_reported_output_tokens = output_tokens;
        entry.last_reported_total_tokens = total_tokens;
      }
    }

    // Rate limit tracking
    if (event.message === "rate_limit_update" && event.payload) {
      this.state.codex_rate_limits = event.payload;
    }
  }

  private runHookBestEffort(wsManager: WorkspaceManager, hookName: string, workspacePath: string): void {
    const script = hookName === "after_run" ? this.config.hooks.after_run : null;
    if (!script) return;
    try {
      wsManager.runHook(hookName, script, workspacePath, this.config.hooks.timeout_ms);
    } catch (e) {
      logger.warn(`${hookName} hook failed (ignored)`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
