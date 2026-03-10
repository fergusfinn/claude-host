# Symphony Implementation Log

## Phase 1: Foundation
- Created `package.json`, `tsconfig.json`, `vitest.config.ts`
- Dependencies: liquidjs, js-yaml, chokidar
- Dev: tsx, typescript, vitest, @types/js-yaml, @types/node
- Implemented: `types.ts`, `logger.ts`, `workflow-loader.ts`, `config.ts`, `prompt.ts`
- 24 unit tests passing

## Phase 2: Linear Client + Workspace
- `linear-client.ts`: paginated GraphQL, issue normalization, state lookup
- `workspace.ts`: create/remove workspace, hook execution, path safety
- Fixed `fetchIssueStatesByIds` to use `issues(filter: { id: { in: $ids } })` (Linear has no `nodes` root query)
- Fixed hook execution: `execSync(script, { shell: "bash" })` instead of nested bash
- 37 unit tests passing

## Phase 3: Agent Runner (Codex app-server protocol)
- `agent-runner.ts`: JSON-RPC over stdio, handshake (initialize → initialized → thread/start), turn lifecycle
- Auto-approves all approval requests, rejects unsupported tool calls
- Fixed double-readline bug: store `lineIterator`/`reader` in `AgentSession`, reuse across turns
- 41 unit tests passing

## Phase 4: Orchestrator
- `orchestrator.ts`: poll loop, dispatch, reconciliation, retry with exponential backoff
- Dynamic config reload via chokidar file watching
- Multi-turn loop with issue state checking between turns
- Startup terminal cleanup for stale issues

## Phase 5–6: CLI + HTTP Server
- `index.ts`: CLI with `--port`, `--debug`, optional positional workflow path
- `server.ts`: HTTP dashboard, `/api/v1/state`, `/api/v1/:identifier`, `POST /api/v1/refresh`
- 45 unit tests passing across 6 test files

## Phase 7: End-to-End Test (2026-03-10)
- Created Linear project "symphony-test" (slugId: ba5d64fc997f, team: TTN)
- Created test issue TTN-3109: "Write system information to a file"
- Symphony successfully:
  1. Polled Linear, picked up TTN-3109 from Sprint Backlog
  2. Created workspace at `/tmp/symphony_workspaces/TTN-3109`
  3. Launched Codex app-server (gpt-5.4 via ChatGPT auth)
  4. Completed handshake: initialize → initialized → thread/start → turn/start
  5. Codex agent created `system-info.txt` and `DONE.md`
  6. Turn completed successfully with token usage reported
  7. Continuation turns 2-3 confirmed work done
  8. After max_turns, correctly scheduled retry (issue still active in Linear)
- Total token usage: ~35K input, ~710 output per session
- Full E2E cycle: ~15 seconds from dispatch to first turn completion
