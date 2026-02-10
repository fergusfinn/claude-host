# Codebase Cleanup Plan (Round 2)

## Instructions for agents

This file coordinates parallel work across multiple agents. Each task has a status line.

**To claim a task:** Change `[ ]` to `[x]` on the `working` line.
**To mark done:** Change `[ ]` to `[x]` on the `complete` line.

Before claiming a task, re-read this file to check no one else has claimed it.
Only claim ONE task at a time. Complete it before claiming another.

After finishing a task, run the relevant tests (`npm test`) to make sure nothing is broken.

Do not refactor beyond what each task describes. Keep changes minimal and focused.

---

## 1. Add `prefixTimeout` to config allowlist

`app/api/config/route.ts:5-8` — The `VALID_CONFIG_KEYS` set is missing `"prefixTimeout"`, but the dashboard reads/writes it (`components/dashboard.tsx:486,528`, `app/page.tsx:610`). Saving this config value currently returns a 400 error. Add `"prefixTimeout"` to the set.

- working: [x]
- complete: [x]

## 2. Fix variable shadowing in `summarize()`

`lib/sessions.ts:420-421` — Inside the `else` branch of `summarize()`, `executor` and `exec` are re-declared, shadowing the identical outer declarations at lines 407-408. Remove the redundant re-declarations.

- working: [x]
- complete: [x]

## 3. Fix bare `tmux` in `rich-channel.ts`

`executor/rich-channel.ts:161,165` — Uses bare `"tmux"` in `spawnSync` calls instead of resolving the path via `which tmux` like `claude-bridge.ts` and `tmux-runner.ts` do. Add the same `TMUX` path resolution and use it.

- working: [x]
- complete: [x]

## 4. Fix `as any` in executor client message handlers

`executor/client.ts:182,226` — `analyze_session` and `diagnose_rich_session` handlers access `(msg as any).name` even though the protocol types (`AnalyzeSessionRpc`, `DiagnoseRichSessionRpc`) already define `name: string`. Remove the unnecessary `as any` casts.

- working: [x]
- complete: [x]

## 5. Fix `require("os")` in ES module

`executor/index.ts:61` — Uses `require("os").hostname()` while the rest of the file uses ESM imports. Add `import { hostname } from "os"` at the top and use `hostname()` directly.

- working: [x]
- complete: [x]

## 6. Remove unused `closeAllDropdowns` function

`components/new-session-page.tsx:97-101` — Function is defined but never called. Each dropdown manually closes the others inline instead. Delete it.

- working: [x]
- complete: [x] (already removed in a previous cleanup)

## 7. Remove redundant Session type definitions

`Session` is defined independently in `app/page.tsx:27`, `components/dashboard.tsx:8`, and `components/new-session-page.tsx:10` (as `SessionInfo`), duplicating parts of the canonical `Session` type in `shared/types.ts`. Import from `shared/types.ts` instead, using `Pick<>` where only a subset of fields is needed.

- working: [x]
- complete: [x]

## 8. Fix `as any` cast in `RemoteExecutor.attachRichSession`

`lib/executor-interface.ts:212` — The `attach_rich_session` message is cast `as any` because it's constructed as a plain object. Build it as an `AttachRichSessionRpc` directly (import from `shared/protocol.ts`).

- working: [x]
- complete: [x]

## 9. Fix `as any` cast in `RemoteExecutor.rpc`

`lib/executor-interface.ts:250` — The generic `rpc()` method constructs a message with `{ type, id, ...params } as any`. Type the method properly or use discriminated union types from the protocol.

- working: [x]
- complete: [x]

## 10. Fix `as any` cast in `executor-registry.ts`

`lib/executor-registry.ts:135` — Message ID is accessed via `(message as any).id`. The `ResponseMessage` type in the protocol already defines `id: string`. Narrow the type properly before accessing.

- working: [x]
- complete: [x]

## 11. Type the `send` method in `executor/client.ts`

`executor/client.ts:113` — The `send` method parameter is typed as `any`. Type it as `ExecutorToControlMessage` from `shared/protocol.ts`.

- working: [x]
- complete: [x]

## 12. Fix `as any` for message ID in `executor/client.ts`

`executor/client.ts:125` — `(msg as any).id` is used because `UpgradeMessage` lacks an `id` field. Either add `id?: string` to `UpgradeMessage` or narrow the type before accessing.

- working: [x]
- complete: [x]

## 13. Extract tmux path resolution into shared utility

The same `which tmux` → fallback `"tmux"` pattern is duplicated in `lib/claude-bridge.ts:29-35`, `executor/tmux-runner.ts:23-29`, and `server.ts:33-35`. Extract into a shared utility (e.g. `shared/tmux.ts`) and import from all three (plus `rich-channel.ts` from task #3).

- working: [x]
- complete: [x]

## 14. Extract `page.tsx` logic into custom hooks

`app/page.tsx` is ~928 lines handling tabs, keyboard shortcuts, WebSocket connections, config, routing, and pane layout. Extract logical concerns into custom hooks, e.g.:
- `useKeyboardShortcuts()` — keyboard event handling and control-mode state
- `usePaneLayout()` — layout tree management
- `useConfig()` — configuration loading/saving

Keep the main component as a composition root that wires the hooks together.

- working: [ ]
- complete: [ ]

## 15. Break up `rich-view.tsx`

`components/rich-view.tsx` is ~1700 lines — the largest file in the codebase. It handles WebSocket connection, event parsing, scroll behavior, input, and rendering of all message types. Extract into smaller pieces:
- WebSocket management → custom hook
- Individual message type renderers → separate components
- Input handling → custom hook or component

- working: [ ]
- complete: [ ]

## 16. Add unit tests for untested modules

The following have no unit tests (some are partially covered by E2E):
- `lib/executor-registry.ts` — executor lifecycle, registration, heartbeats
- `shared/rich-snapshot.ts` — NDJSON snapshot parsing
- `lib/markdown.tsx` — custom markdown parser (597 lines)
- `executor/client.ts` — WebSocket client (267 lines)

Priority order: `executor-registry.ts` (critical infrastructure), `rich-snapshot.ts` (small, easy to test), `markdown.tsx` (large surface area), `executor/client.ts`.

- working: [ ]
- complete: [ ]

## 17. Consolidate default command string

The default command `"claude --dangerously-skip-permissions"` appears as a literal string in `components/new-session-page.tsx:129`, `components/mode-switch-modal.tsx:31`, `app/page.tsx:358`, and `lib/sessions.ts:328`. Extract to a shared constant.

- working: [x]
- complete: [x]

## 18. Review `@rollup/rollup-linux-x64-gnu` dependency

`package.json` explicitly pins `@rollup/rollup-linux-x64-gnu` as a dependency. This is normally auto-installed by npm based on platform and may cause issues for non-Linux developers. Investigate whether it can be removed or moved to `optionalDependencies`.

**Verdict: keep as-is.** The explicit pin is a workaround for [npm#4828](https://github.com/npm/cli/issues/4828) — npm fails to install rollup's `optionalDependencies` when rollup is pulled in transitively (`better-auth` → `vitest` → `vite` → `rollup`). Removing the pin causes `Cannot find module @rollup/rollup-linux-x64-gnu` at runtime. This only affects Linux x64 (the deploy target), so it won't break non-Linux dev machines (they'll just have an unused extra package).

- working: [x]
- complete: [x]
