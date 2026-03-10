// Optional HTTP server — spec §13.7

import * as http from "node:http";
import type { Orchestrator } from "./orchestrator.js";

export function createServer(orchestrator: Orchestrator): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    // CORS and content type
    res.setHeader("Content-Type", "application/json");

    try {
      // GET / — HTML dashboard
      if (pathname === "/" && req.method === "GET") {
        res.setHeader("Content-Type", "text/html");
        res.end(renderDashboard(orchestrator));
        return;
      }

      // GET /api/v1/state
      if (pathname === "/api/v1/state" && req.method === "GET") {
        res.end(JSON.stringify(getStateSnapshot(orchestrator), null, 2));
        return;
      }

      // POST /api/v1/refresh
      if (pathname === "/api/v1/refresh" && req.method === "POST") {
        orchestrator.triggerRefresh();
        res.writeHead(202);
        res.end(
          JSON.stringify({
            queued: true,
            coalesced: false,
            requested_at: new Date().toISOString(),
            operations: ["poll", "reconcile"],
          }),
        );
        return;
      }

      // GET /api/v1/:identifier — per-issue detail
      const issueMatch = pathname.match(/^\/api\/v1\/([A-Za-z0-9_-]+)$/);
      if (issueMatch && req.method === "GET") {
        const identifier = issueMatch[1];
        const detail = getIssueDetail(orchestrator, identifier);
        if (!detail) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: { code: "issue_not_found", message: `Issue ${identifier} not found` } }));
          return;
        }
        res.end(JSON.stringify(detail, null, 2));
        return;
      }

      // Method not allowed for known routes
      if (pathname === "/api/v1/state" || pathname === "/api/v1/refresh") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: { code: "method_not_allowed", message: "Method not allowed" } }));
        return;
      }

      // 404
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
    } catch (e) {
      res.writeHead(500);
      res.end(
        JSON.stringify({
          error: { code: "internal_error", message: e instanceof Error ? e.message : "Unknown error" },
        }),
      );
    }
  });
}

function getStateSnapshot(orchestrator: Orchestrator) {
  const state = orchestrator.getState();
  const now = Date.now();

  const running = [...state.running.entries()].map(([id, entry]) => ({
    issue_id: id,
    issue_identifier: entry.identifier,
    state: entry.issue.state,
    session_id: entry.session_id,
    turn_count: entry.turn_count,
    last_event: entry.last_codex_event,
    last_message: entry.last_codex_message ?? "",
    started_at: entry.started_at.toISOString(),
    last_event_at: entry.last_codex_timestamp?.toISOString() ?? null,
    tokens: {
      input_tokens: entry.codex_input_tokens,
      output_tokens: entry.codex_output_tokens,
      total_tokens: entry.codex_total_tokens,
    },
  }));

  const retrying = [...state.retry_attempts.entries()].map(([id, entry]) => ({
    issue_id: id,
    issue_identifier: entry.identifier,
    attempt: entry.attempt,
    due_at: new Date(entry.due_at_ms).toISOString(),
    error: entry.error,
  }));

  // Live seconds: add active session elapsed
  let liveSeconds = state.codex_totals.seconds_running;
  for (const entry of state.running.values()) {
    liveSeconds += (now - entry.started_at.getTime()) / 1000;
  }

  return {
    generated_at: new Date().toISOString(),
    counts: {
      running: running.length,
      retrying: retrying.length,
    },
    running,
    retrying,
    codex_totals: {
      input_tokens: state.codex_totals.input_tokens,
      output_tokens: state.codex_totals.output_tokens,
      total_tokens: state.codex_totals.total_tokens,
      seconds_running: Math.round(liveSeconds * 10) / 10,
    },
    rate_limits: state.codex_rate_limits,
  };
}

function getIssueDetail(orchestrator: Orchestrator, identifier: string) {
  const state = orchestrator.getState();

  // Search running
  for (const [id, entry] of state.running) {
    if (entry.identifier === identifier) {
      return {
        issue_identifier: identifier,
        issue_id: id,
        status: "running",
        workspace: {
          path: entry.issue.identifier, // workspace path derived from identifier
        },
        running: {
          session_id: entry.session_id,
          turn_count: entry.turn_count,
          state: entry.issue.state,
          started_at: entry.started_at.toISOString(),
          last_event: entry.last_codex_event,
          last_message: entry.last_codex_message ?? "",
          last_event_at: entry.last_codex_timestamp?.toISOString() ?? null,
          tokens: {
            input_tokens: entry.codex_input_tokens,
            output_tokens: entry.codex_output_tokens,
            total_tokens: entry.codex_total_tokens,
          },
        },
        retry: null,
        last_error: null,
      };
    }
  }

  // Search retrying
  for (const [id, entry] of state.retry_attempts) {
    if (entry.identifier === identifier) {
      return {
        issue_identifier: identifier,
        issue_id: id,
        status: "retrying",
        workspace: { path: identifier },
        running: null,
        retry: {
          attempt: entry.attempt,
          due_at: new Date(entry.due_at_ms).toISOString(),
          error: entry.error,
        },
        last_error: entry.error,
      };
    }
  }

  return null;
}

function renderDashboard(orchestrator: Orchestrator): string {
  const snapshot = getStateSnapshot(orchestrator);
  const runningRows = snapshot.running
    .map(
      (r) =>
        `<tr><td>${r.issue_identifier}</td><td>${r.state}</td><td>${r.turn_count}</td><td>${r.last_event ?? "-"}</td><td>${r.tokens.total_tokens}</td><td>${r.started_at}</td></tr>`,
    )
    .join("");
  const retryRows = snapshot.retrying
    .map(
      (r) =>
        `<tr><td>${r.issue_identifier}</td><td>${r.attempt}</td><td>${r.due_at}</td><td>${r.error ?? "-"}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><head><title>Symphony Dashboard</title>
<meta http-equiv="refresh" content="10">
<style>
body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
h1 { color: #00d4ff; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; }
th { background: #16213e; color: #00d4ff; }
tr:nth-child(even) { background: #0f3460; }
.stats { display: flex; gap: 30px; margin: 15px 0; }
.stat { background: #16213e; padding: 10px 20px; border-radius: 4px; }
.stat-value { font-size: 1.5em; color: #00d4ff; }
</style></head><body>
<h1>Symphony</h1>
<div class="stats">
<div class="stat"><div>Running</div><div class="stat-value">${snapshot.counts.running}</div></div>
<div class="stat"><div>Retrying</div><div class="stat-value">${snapshot.counts.retrying}</div></div>
<div class="stat"><div>Total Tokens</div><div class="stat-value">${snapshot.codex_totals.total_tokens}</div></div>
<div class="stat"><div>Runtime</div><div class="stat-value">${snapshot.codex_totals.seconds_running}s</div></div>
</div>
<h2>Running</h2>
<table><tr><th>Issue</th><th>State</th><th>Turns</th><th>Last Event</th><th>Tokens</th><th>Started</th></tr>${runningRows || "<tr><td colspan=6>No running sessions</td></tr>"}</table>
<h2>Retry Queue</h2>
<table><tr><th>Issue</th><th>Attempt</th><th>Due</th><th>Error</th></tr>${retryRows || "<tr><td colspan=4>No retries queued</td></tr>"}</table>
<p style="color:#666">Generated: ${snapshot.generated_at}</p>
</body></html>`;
}
