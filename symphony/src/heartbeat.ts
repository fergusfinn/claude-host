// Heartbeat — periodic progress summaries posted to Linear via one-shot CLI agent

import { spawn } from "node:child_process";
import { Liquid } from "liquidjs";
import { logger } from "./logger.js";
import type { AgentEvent, HeartbeatConfig, TrackerConfig } from "./types.js";

const liquid = new Liquid({ strictFilters: true });

const DEFAULT_PROMPT_TEMPLATE = `You are a monitoring agent. An autonomous coding agent is working on Linear issue {{ issue.identifier }}: "{{ issue.title }}".

{{ time_since_last }}

Post a short progress comment (2-4 sentences) on the Linear issue summarizing what the agent has been doing. If there are no events or no meaningful progress, note that the agent may be stuck or idle.

Use the Linear GraphQL API to post the comment:
- Endpoint: https://api.linear.app/graphql
- Authorization: Bearer token from the LINEAR_API_KEY environment variable
- Issue ID: {{ issue.id }}
- Mutation: commentCreate(input: { issueId: "...", body: "..." })

Recent agent events ({{ event_count }} events):
{{ events }}`;

interface HeartbeatState {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  events: AgentEvent[];
  timer: ReturnType<typeof setInterval>;
  lastHeartbeatAt: Date | null;
  pending: boolean; // true while a heartbeat command is running
}

export class HeartbeatManager {
  private heartbeats = new Map<string, HeartbeatState>();

  constructor(
    private config: HeartbeatConfig,
    private tracker: TrackerConfig,
  ) {}

  start(issueId: string, issueIdentifier: string, issueTitle: string): void {
    if (!this.config.enabled) return;

    // Don't double-start
    if (this.heartbeats.has(issueId)) return;

    const state: HeartbeatState = {
      issueId,
      issueIdentifier,
      issueTitle,
      events: [],
      timer: setInterval(() => this.fire(issueId), this.config.interval_ms),
      lastHeartbeatAt: null,
      pending: false,
    };

    this.heartbeats.set(issueId, state);
    logger.info("Heartbeat started", { issue_id: issueId, issue_identifier: issueIdentifier });
  }

  appendEvent(issueId: string, event: AgentEvent): void {
    const state = this.heartbeats.get(issueId);
    if (!state) return;
    state.events.push(event);
  }

  stop(issueId: string): void {
    const state = this.heartbeats.get(issueId);
    if (!state) return;

    clearInterval(state.timer);
    this.heartbeats.delete(issueId);
    logger.info("Heartbeat stopped", { issue_id: issueId, issue_identifier: state.issueIdentifier });
  }

  stopAll(): void {
    for (const issueId of [...this.heartbeats.keys()]) {
      this.stop(issueId);
    }
  }

  private fire(issueId: string): void {
    const state = this.heartbeats.get(issueId);
    if (!state) return;

    // Skip if previous heartbeat is still running
    if (state.pending) {
      logger.debug("Heartbeat skipped (previous still running)", { issue_id: issueId });
      return;
    }

    // Drain events since last heartbeat
    const events = state.events.splice(0);

    state.pending = true;
    this.sendHeartbeat(state, events).finally(() => {
      state.pending = false;
      state.lastHeartbeatAt = new Date();
    });
  }

  private async sendHeartbeat(state: HeartbeatState, events: AgentEvent[]): Promise<void> {
    const formatted = this.formatEvents(events);
    const timeSinceLastStr = state.lastHeartbeatAt
      ? `Time since last heartbeat: ${Math.round((Date.now() - state.lastHeartbeatAt.getTime()) / 1000)}s`
      : "This is the first heartbeat since the agent started.";

    const template = this.config.prompt_template || DEFAULT_PROMPT_TEMPLATE;

    let prompt: string;
    try {
      prompt = liquid.parseAndRenderSync(template, {
        issue: {
          id: state.issueId,
          identifier: state.issueIdentifier,
          title: state.issueTitle,
        },
        events: formatted || "(no events since last heartbeat)",
        event_count: events.length,
        time_since_last: timeSinceLastStr,
      });
    } catch (e) {
      logger.warn("Heartbeat template render failed", {
        issue_id: state.issueId,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    logger.debug("Heartbeat spawning", { issue_id: state.issueId, cmd: this.config.command });

    return new Promise<void>((resolve) => {
      const proc = spawn("bash", ["-lc", this.config.command], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          LINEAR_API_KEY: this.tracker.api_key,
        },
      });

      const timeout = setTimeout(() => {
        proc.kill();
        logger.warn("Heartbeat timed out", { issue_id: state.issueId });
        resolve();
      }, 120000); // 2 minute timeout for the heartbeat agent

      proc.on("error", (err) => {
        clearTimeout(timeout);
        logger.warn("Heartbeat process error", {
          issue_id: state.issueId,
          error: err.message,
        });
        resolve();
      });

      proc.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          logger.warn("Heartbeat exited non-zero", { issue_id: state.issueId, code });
        } else {
          logger.info("Heartbeat posted", { issue_id: state.issueId, issue_identifier: state.issueIdentifier });
        }
        resolve();
      });

      // Pipe stderr to debug log
      proc.stderr?.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          logger.debug("heartbeat stderr", { line });
        }
      });

      // Discard stdout
      proc.stdout?.resume();

      // Write prompt and close stdin
      proc.stdin?.write(prompt);
      proc.stdin?.end();
    });
  }

  private formatEvents(events: AgentEvent[]): string {
    return events
      .map((e) => {
        const ts = e.timestamp.toISOString().slice(11, 19); // HH:MM:SS
        const msg = e.message ? `: ${e.message}` : "";
        return `[${ts}] ${e.event}${msg}`;
      })
      .join("\n");
  }
}
