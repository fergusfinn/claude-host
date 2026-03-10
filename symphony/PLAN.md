# Symphony Implementation Plan

Standalone implementation of the [Symphony spec](https://github.com/openai/symphony/blob/main/SPEC.md) (Draft v1) — a long-running daemon that polls Linear for issues, creates isolated workspaces, and runs Codex app-server sessions against them.

Lives in `symphony/` as a fully independent project. Zero shared code with claude-host.

## Design Decisions

### Agent protocol
Codex app-server over stdio, exactly as specified. JSON-RPC line protocol: `initialize` → `initialized` → `thread/start` → `turn/start` → stream events → `turn/completed`.

### Approval & sandbox policy
- `approvalPolicy`: `"never"` (auto-approve everything)
- `sandbox` (thread): `"danger-full-access"`
- `sandboxPolicy` (turn): `{ "type": "dangerFullAccess" }`

Trusted single-user environment. These are set in WORKFLOW.md front matter and sent as protocol params.

### Language & runtime
TypeScript on Node.js, run via `tsx`. Dependencies kept minimal:
- `liquidjs` — spec-compliant Liquid template rendering (§5.4 says "Liquid-compatible semantics")
- `js-yaml` — YAML front matter parsing
- `chokidar` — WORKFLOW.md file watching for dynamic reload (§6.2)

No framework, no database. In-memory orchestrator state per spec (§7, §14.3).

### Isolation from claude-host
- Own `package.json`, `tsconfig.json`, `node_modules/`
- Own entry point: `symphony/src/index.ts`
- Own scripts: `npm run dev`, `npm start`
- To remove: `rm -rf symphony/`
- No imports from `../`, no shared types, no shared utilities

---

## Project Structure

```
symphony/
├── package.json
├── tsconfig.json
├── PLAN.md                    # this file
├── WORKFLOW.md                # example workflow definition (your config)
├── src/
│   ├── index.ts               # CLI entry point, startup, shutdown
│   ├── orchestrator.ts        # poll loop, dispatch, reconciliation, retry state machine
│   ├── workflow-loader.ts     # WORKFLOW.md parser (YAML front matter + Liquid prompt body)
│   ├── config.ts              # typed getters, defaults, $VAR resolution, validation
│   ├── linear-client.ts       # Linear GraphQL API client (candidates, state refresh, terminal fetch)
│   ├── workspace.ts           # workspace creation/reuse, hooks, cleanup, safety invariants
│   ├── agent-runner.ts        # codex app-server subprocess: launch, handshake, turn loop, events
│   ├── prompt.ts              # Liquid template rendering with issue + attempt context
│   ├── types.ts               # domain model (Issue, RunAttempt, RetryEntry, OrchestratorState, etc.)
│   ├── logger.ts              # structured logging (key=value, issue/session context)
│   └── server.ts              # optional HTTP server: GET /api/v1/state, GET /api/v1/:id, POST /api/v1/refresh
└── test/
    ├── workflow-loader.test.ts
    ├── config.test.ts
    ├── linear-client.test.ts
    ├── workspace.test.ts
    ├── agent-runner.test.ts
    ├── prompt.test.ts
    └── orchestrator.test.ts
```

---

## Implementation Steps

### Phase 1: Foundation (types, config, workflow loader, prompt)

#### Step 1.1 — `types.ts`
Domain model from spec §4.1:
- `Issue` — id, identifier, title, description, priority, state, branch_name, url, labels, blocked_by, created_at, updated_at
- `BlockerRef` — id, identifier, state
- `WorkflowDefinition` — config (map), prompt_template (string)
- `Workspace` — path, workspace_key, created_now
- `RunAttempt` — issue_id, issue_identifier, attempt, workspace_path, started_at, status, error
- `RunAttemptStatus` — enum: PreparingWorkspace, BuildingPrompt, LaunchingAgentProcess, InitializingSession, StreamingTurn, Finishing, Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation
- `LiveSession` — session_id, thread_id, turn_id, codex_app_server_pid, last_codex_event, last_codex_timestamp, last_codex_message, token counters, turn_count
- `RetryEntry` — issue_id, identifier, attempt, due_at_ms, timer_handle, error
- `OrchestratorState` — poll_interval_ms, max_concurrent_agents, running map, claimed set, retry_attempts map, completed set, codex_totals, codex_rate_limits
- `RunningEntry` — extends LiveSession with worker handle, issue snapshot, started_at, retry_attempt
- `CodexTotals` — input_tokens, output_tokens, total_tokens, seconds_running
- `ServiceConfig` — typed view of all config fields from §6.4

#### Step 1.2 — `workflow-loader.ts`
Per spec §5:
- `loadWorkflow(path: string): WorkflowDefinition`
- Detect `---` delimited YAML front matter
- Parse YAML → must be a map (error: `workflow_front_matter_not_a_map`)
- Remaining lines → trimmed prompt body
- No front matter → empty config map, entire file is prompt
- Error types: `missing_workflow_file`, `workflow_parse_error`, `workflow_front_matter_not_a_map`

#### Step 1.3 — `config.ts`
Per spec §5.3 + §6:
- `parseConfig(raw: Record<string, any>): ServiceConfig`
- Typed getters for every field in §6.4 cheat sheet
- `$VAR` → `process.env[VAR]` resolution for `tracker.api_key`, path values
- `~` expansion for path values
- Comma-separated string → list coercion for `active_states`, `terminal_states`
- Integer coercion for numeric fields
- State name normalization: `trim().toLowerCase()`
- Defaults per spec:
  - `polling.interval_ms`: 30000
  - `workspace.root`: `<os.tmpdir()>/symphony_workspaces`
  - `agent.max_concurrent_agents`: 10
  - `agent.max_turns`: 20
  - `agent.max_retry_backoff_ms`: 300000
  - `codex.command`: `codex app-server`
  - `codex.turn_timeout_ms`: 3600000
  - `codex.read_timeout_ms`: 5000
  - `codex.stall_timeout_ms`: 300000
  - `hooks.timeout_ms`: 60000
  - `tracker.active_states`: ["Todo", "In Progress"]
  - `tracker.terminal_states`: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
- Validation (§6.3): tracker.kind present+supported, api_key present after resolution, project_slug present, codex.command non-empty

#### Step 1.4 — `prompt.ts`
Per spec §5.4 + §12:
- `renderPrompt(template: string, issue: Issue, attempt: number | null): string`
- Use LiquidJS with `strictVariables: true`, `strictFilters: true`
- Template variables: `issue` (all fields), `attempt`
- Convert issue keys to strings for template compat
- Preserve nested arrays (labels, blocked_by)
- Error on unknown variables/filters
- If template is empty, use fallback: `"You are working on an issue from Linear."`

#### Step 1.5 — `logger.ts`
Per spec §13.1-13.2:
- Structured key=value logging to stderr
- Context fields: `issue_id`, `issue_identifier`, `session_id` when available
- Log levels: debug, info, warn, error
- Timestamps in ISO-8601

### Phase 2: External integrations (Linear client, workspace manager)

#### Step 2.1 — `linear-client.ts`
Per spec §11:
- `LinearClient` class, constructed with endpoint + api_key
- `fetchCandidateIssues(projectSlug, activeStates): Promise<Issue[]>` — paginated GraphQL query filtering by project.slugId, state names. Page size 50, 30s timeout
- `fetchIssueStatesByIds(ids: string[]): Promise<Pick<Issue, 'id'|'state'>[]>` — GraphQL query with `$ids: [ID!]`
- `fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>` — for startup terminal cleanup
- Normalization per §11.3: labels lowercase, blocked_by from inverse `blocks` relations, priority integer or null, ISO-8601 timestamps
- Error categories: `unsupported_tracker_kind`, `missing_tracker_api_key`, `missing_tracker_project_slug`, `linear_api_request`, `linear_api_status`, `linear_graphql_errors`, `linear_unknown_payload`, `linear_missing_end_cursor`
- Auth: `Authorization: Bearer <token>` header

#### Step 2.2 — `workspace.ts`
Per spec §9:
- `WorkspaceManager` class with configured root path
- `createForIssue(identifier: string): Workspace`
  - Sanitize identifier: replace `[^A-Za-z0-9._-]` with `_` → `workspace_key`
  - Path: `<root>/<workspace_key>`
  - `mkdir -p` equivalent
  - Track `created_now` boolean
  - If new, run `after_create` hook
- `removeWorkspace(identifier: string)` — run `before_remove` hook, then `rm -rf`
- `runHook(hookName, script, workspacePath, timeoutMs)` — execute via `bash -lc <script>` with cwd=workspacePath
- Safety invariants:
  - Workspace path must have workspace root as prefix (absolute paths, no traversal)
  - Workspace key only `[A-Za-z0-9._-]`
  - Agent cwd === workspace path (validated before launch)
- Hook failure semantics per §9.4:
  - `after_create` failure → fatal (abort workspace creation)
  - `before_run` failure → fatal (abort current attempt)
  - `after_run` failure → logged, ignored
  - `before_remove` failure → logged, ignored

### Phase 3: Agent runner (Codex app-server protocol)

#### Step 3.1 — `agent-runner.ts`
Per spec §10:

**Subprocess launch:**
- Command: `bash -lc <codex.command>` (default: `bash -lc "codex app-server"`)
- cwd: workspace path
- stdio: pipe stdin/stdout, pipe stderr separately
- Max stdout line buffer: 10MB

**Session startup handshake (§10.2):**
```jsonl
→ {"id":1,"method":"initialize","params":{"clientInfo":{"name":"symphony","version":"1.0"},"capabilities":{}}}
← (wait for response, read_timeout_ms)
→ {"method":"initialized","params":{}}
→ {"id":2,"method":"thread/start","params":{"approvalPolicy":"never","sandbox":"danger-full-access","cwd":"/abs/workspace"}}
← (read thread_id from result.thread.id)
→ {"id":3,"method":"turn/start","params":{"threadId":"<thread_id>","input":[{"type":"text","text":"<rendered prompt>"}],"cwd":"/abs/workspace","title":"ABC-123: Issue title","approvalPolicy":"never","sandboxPolicy":{"type":"dangerFullAccess"}}}
← (read turn_id from result.turn.id)
```

**Streaming turn processing (§10.3):**
- Read line-delimited JSON from stdout only
- Buffer partial lines until newline
- Ignore stderr for protocol (log as diagnostics)
- Completion: `turn/completed` → success, `turn/failed`/`turn/cancelled`/timeout/exit → failure
- Extract session_id = `<thread_id>-<turn_id>`

**Event emission (§10.4):**
- Emit structured events to orchestrator callback: session_started, turn_completed, turn_failed, turn_cancelled, notification, etc.
- Include timestamp, pid, usage if present

**Approval handling (§10.5):**
- Auto-approve all command execution approvals: `{"id":"<id>","result":{"approved":true}}`
- Auto-approve all file change approvals: same
- Reject unsupported dynamic tool calls: `{"id":"<id>","result":{"success":false,"error":"unsupported_tool_call"}}`
- User input requests → fail the run immediately

**Timeouts (§10.6):**
- `read_timeout_ms` (5s default): for initialize response, thread/start response
- `turn_timeout_ms` (1hr default): total turn duration
- Stall timeout handled by orchestrator, not here

**Multi-turn loop (§16.5):**
- After successful turn, worker checks issue state via tracker
- If still active and turn_number < max_turns, start another turn on same thread_id
- First turn: full rendered prompt
- Continuation turns: continuation guidance (not full prompt re-send)
- On exit (normal or error): stop subprocess, run after_run hook

### Phase 4: Orchestrator (core state machine)

#### Step 4.1 — `orchestrator.ts`
Per spec §7 + §8 + §16:

**State (§4.1.8):**
```typescript
{
  poll_interval_ms: number,
  max_concurrent_agents: number,
  running: Map<string, RunningEntry>,
  claimed: Set<string>,
  retry_attempts: Map<string, RetryEntry>,
  completed: Set<string>,
  codex_totals: CodexTotals,
  codex_rate_limits: any | null
}
```

**Startup (§16.1):**
1. Configure logging
2. Start WORKFLOW.md file watch (chokidar) → on change, reload config + prompt
3. Validate dispatch config (§6.3)
4. Startup terminal workspace cleanup (§8.6): query Linear for terminal-state issues, remove matching workspaces
5. Schedule immediate tick (delay 0)
6. Enter event loop

**Poll tick (§16.2, §8.1):**
1. Reconcile running issues
2. Validate dispatch config → if fail, skip dispatch, keep reconciliation
3. Fetch candidate issues from Linear
4. Sort by: priority asc (null last), created_at asc, identifier lexicographic
5. Dispatch eligible issues while slots remain
6. Schedule next tick at `poll_interval_ms`

**Candidate eligibility (§8.2):**
- Has id, identifier, title, state
- State in active_states AND NOT in terminal_states
- Not in running map
- Not in claimed set
- Global slots available: `max_concurrent_agents - running.size > 0`
- Per-state slots available (if `max_concurrent_agents_by_state[state]` configured)
- Blocker rule: if state is "todo" (normalized), skip if any blocker has non-terminal state

**Dispatch (§16.4):**
1. Add issue.id to claimed set
2. Clear any existing retry for this issue
3. Spawn worker (async): `runAgentAttempt(issue, attempt)`
4. Add to running map with initial session fields
5. If spawn fails, schedule retry

**Reconciliation (§16.3, §8.5):**

Part A — Stall detection:
- For each running entry, compute elapsed since last_codex_timestamp (or started_at)
- If elapsed > stall_timeout_ms → terminate worker, schedule retry
- If stall_timeout_ms ≤ 0, skip

Part B — Tracker state refresh:
- Fetch current states for all running issue IDs
- Terminal state → terminate + clean workspace
- Still active → update in-memory issue snapshot
- Neither → terminate without cleanup
- Fetch failure → keep workers, retry next tick

**Worker exit handling (§16.6):**
- Normal exit → add to completed, schedule continuation retry (1s delay, attempt=1)
- Abnormal exit → schedule exponential backoff retry

**Retry (§8.4):**
- Cancel existing timer for same issue
- Backoff: continuation = 1000ms fixed; failure = `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`
- On timer fire: fetch candidates, find issue, dispatch if eligible + slots available, else requeue or release

**Dynamic reload (§6.2):**
- Watch WORKFLOW.md with chokidar
- On change: re-parse, re-validate
- Apply new poll_interval_ms, max_concurrent_agents, active/terminal states, codex settings, hooks, prompt
- Invalid reload → keep last good config, log error
- No restart of in-flight sessions

**Shutdown:**
- SIGINT/SIGTERM → stop poll timer, terminate all running workers, stop file watcher, exit

### Phase 5: CLI entry point

#### Step 5.1 — `index.ts`
Per spec §17.7:
- Accept optional positional arg: path to WORKFLOW.md
- Default: `./WORKFLOW.md` in cwd
- Error if explicit path doesn't exist or default missing
- Start orchestrator
- Exit 0 on clean shutdown, non-zero on startup failure or abnormal exit
- Optional `--port <n>` flag → start HTTP server

### Phase 6: HTTP server (optional extension)

#### Step 6.1 — `server.ts`
Per spec §13.7:
- Plain Node.js `http.createServer` (no framework)
- Bind loopback by default
- `--port` CLI overrides `server.port` from WORKFLOW.md

**Endpoints:**
- `GET /` — simple HTML dashboard showing running/retrying/totals
- `GET /api/v1/state` — JSON snapshot: running list, retry list, codex_totals, rate_limits, counts
- `GET /api/v1/:identifier` — per-issue detail (running info, retry info, recent events, workspace path)
- `POST /api/v1/refresh` — queue immediate poll+reconcile cycle
- 404 for unknown issue identifiers
- 405 for wrong methods
- Error envelope: `{"error":{"code":"...","message":"..."}}`

### Phase 7: Tests

Unit tests with vitest, mocking external boundaries:
- `workflow-loader.test.ts` — parsing, edge cases, error types
- `config.test.ts` — defaults, $VAR resolution, validation, coercion
- `prompt.test.ts` — rendering, strict mode, fallback
- `linear-client.test.ts` — mock fetch, pagination, normalization, error handling
- `workspace.test.ts` — creation, reuse, sanitization, hook execution, safety invariants
- `agent-runner.test.ts` — mock subprocess, handshake, turn processing, approval auto-response, timeouts
- `orchestrator.test.ts` — dispatch, reconciliation, retry scheduling, stall detection, dynamic reload

---

## WORKFLOW.md Example

This is what the user creates to configure their Symphony instance:

```yaml
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate

polling:
  interval_ms: 30000

workspace:
  root: ~/symphony-workspaces

hooks:
  after_create: |
    git clone git@github.com:myorg/myrepo.git .
  before_run: |
    git fetch origin main
    git checkout -B work-branch origin/main

agent:
  max_concurrent_agents: 3
  max_turns: 20
  max_retry_backoff_ms: 300000

codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_sandbox_policy:
    type: dangerFullAccess
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000

server:
  port: 4000
---

You are an autonomous coding agent working on issue **{{ issue.identifier }}**: *{{ issue.title }}*.

## Issue Details

{{ issue.description }}

{% if issue.labels.size > 0 %}
**Labels:** {{ issue.labels | join: ", " }}
{% endif %}

{% if issue.blocked_by.size > 0 %}
**Blocked by:**
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
This is retry attempt {{ attempt }}. Review your previous work and continue from where you left off.
{% endif %}

## Instructions

1. Read the issue carefully and understand the requirements.
2. Implement the changes in the codebase.
3. Write or update tests as needed.
4. Create a pull request with your changes.
5. Move the Linear issue to "Human Review" when done.
```

---

## Running

```bash
cd symphony
npm install
npm run dev                          # uses ./WORKFLOW.md
npm run dev -- /path/to/WORKFLOW.md  # explicit path
npm run dev -- --port 4000           # with HTTP dashboard
```

---

## Dependencies

```json
{
  "dependencies": {
    "liquidjs": "^10",
    "js-yaml": "^4",
    "chokidar": "^4"
  },
  "devDependencies": {
    "typescript": "^5",
    "tsx": "^4",
    "vitest": "^3",
    "@types/node": "^22",
    "@types/js-yaml": "^4"
  }
}
```

---

## What's NOT in scope (spec non-goals + our choices)

- No web UI beyond the minimal HTML dashboard at `/` (spec §2.2 says "Rich web UI" is a non-goal)
- No database (spec §14.3 says in-memory state, tracker-driven restart recovery)
- No `linear_graphql` client-side tool extension (can add later)
- No multi-tenant / auth (single-user trusted environment)
- No container/VM sandboxing (relying on Codex `danger-full-access`)
