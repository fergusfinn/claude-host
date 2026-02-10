# Codebase Cleanup Plan

## Instructions for agents

This file coordinates parallel work across multiple agents. Each task has a status line.

**To claim a task:** Change `[ ]` to `[x]` on the `working` line.
**To mark done:** Change `[ ]` to `[x]` on the `complete` line.

Before claiming a task, re-read this file to check no one else has claimed it.
Only claim ONE task at a time. Complete it before claiming another.

After finishing a task, run the relevant tests (`npm test`) to make sure nothing is broken.

Do not refactor beyond what each task describes. Keep changes minimal and focused.

---

## 1. Add auth check to diagnose endpoint

`app/api/sessions/[name]/diagnose/route.ts` is the only API route missing a `getAuthUser()` call. Add the same auth pattern used by every other route (check `getAuthUser(req)`, return 401 if null). Also pass `userId` into the ownership check if appropriate.

- working: [ ]
- complete: [ ]

## 2. Fix shell injection in `discoverNewSessionId`

`executor/tmux-runner.ts:525` — `projectDir`, `beforeList`, and other variables are interpolated directly into a bash template string. Escape or quote these properly, or refactor to avoid shell interpolation (e.g., pass values as environment variables to the subprocess, or use argument arrays instead of a bash -c string).

- working: [ ]
- complete: [ ]

## 3. Warn or fail on default auth secret

`lib/auth.ts:25` — The hardcoded fallback `"dev-placeholder-secret-change-in-production"` is dangerous. At minimum, log a loud warning at startup if no `BETTER_AUTH_SECRET` is set. Ideally, refuse to start in production (`NODE_ENV=production`) without an explicit secret.

- working: [ ]
- complete: [ ]

## 4. Move executor token out of query strings and CLI args

Two issues:
- `server.ts:36` — Executor auth token is passed as a URL query param. Switch to an `Authorization` header or a custom header like `X-Executor-Token`.
- `executor-deploy.sh:64` — Token is passed as a CLI arg (visible in `ps`). Use an `Environment=` line in the systemd unit instead.

Update both the server-side validation (`validateExecutorToken`) and the client-side connection code in `executor/client.ts` to use the new mechanism.

- working: [ ]
- complete: [ ]

## 5. Remove dead code: unused functions

Delete these unused exported functions (and remove any related imports/exports):
- `parseMessage()` — `shared/protocol.ts:148`
- `richSessionExists()`, `richSessionTmuxAlive()` — `lib/claude-bridge.ts:643-652`
- `timeAgo()` — `components/dashboard.tsx` (keep `activityAgo`)
- `getAllTabSessions()` — `app/page.tsx`
- `formatKey()` — `lib/shortcuts.ts:51` (keep the test if it tests other things, otherwise remove)
- `getToolIcon()`, `formatDuration()` — `lib/rich-render.ts` (remove from tests too if they only test these)
- `makeEditorLeaf()`, `findEditorLeaf()`, `updateEditorFile()`, `splitPaneWithLeaf()` — `lib/layout.ts`
- The `editor` field on `PaneLeaf` in `lib/layout.ts` if nothing references it

- working: [ ]
- complete: [ ]

## 6. Remove dead code: unused props

- `onSwitch` prop — Remove from `TerminalView`'s props interface in `components/terminal-view.tsx` and from where it's passed in `components/pane-layout.tsx`.
- `onOpenFile` prop — Remove from `RichView` and all sub-components that thread it (`ToolPairBlock`, `DiffView`, etc.) in `components/rich-view.tsx`. Remove from caller in `components/pane-layout.tsx` if present.

- working: [ ]
- complete: [ ]

## 7. Remove unused `shiki` dependency

`shiki` is in `package.json` but never imported. Run `npm uninstall shiki`.

- working: [x]
- complete: [x]

## 8. Deduplicate `getMode` / `getSessionMode`

`lib/sessions.ts` has two methods that do the same `SELECT mode FROM sessions WHERE name = ?` query. Keep the public one (`getMode`), delete the private one (`getSessionMode`), and update all internal callers to use `getMode`.

- working: [ ]
- complete: [ ]

## 9. Deduplicate `snapshotRichSession`

Nearly identical implementations exist in `lib/sessions.ts:439` and `executor/tmux-runner.ts:299`. Extract the shared logic into a utility function (e.g., in `lib/claude-bridge.ts` or a new shared helper) and call it from both places, passing `maxLines` as a parameter.

- working: [ ]
- complete: [ ]

## 10. Deduplicate `tabLabel` and `activityAgo`

- `tabLabel()` is identical in `components/tab-bar.tsx` and `components/mobile-tab-bar.tsx`. Extract to a shared utility (e.g., `lib/ui-utils.ts` or similar).
- `activityAgo()` is identical in `components/dashboard.tsx` and `components/new-session-page.tsx`. Extract to the same shared file.

- working: [ ]
- complete: [ ]

## 11. Fix `require()` in ES module

`executor/tmux-runner.ts:524` uses `require("child_process")` for `spawn`. Add `spawn` to the existing `import { execFileSync, spawnSync, execSync } from "child_process"` at the top of the file, and remove the `require` call.

- working: [x]
- complete: [x]

## 12. Consolidate dual SQLite connections

`lib/claude-bridge.ts:66` opens its own `Database` handle to `sessions.db` while `lib/sessions.ts` opens another. Refactor so `claude-bridge` receives or shares the database connection from `SessionManager` rather than creating its own. This also consolidates schema management into one place.

- working: [ ]
- complete: [ ]

## 13. Fix `adoptOrphanedSessions` missing `user_id`

`lib/sessions.ts:622` — Sessions adopted from remote executors are inserted without a `user_id`, making them invisible to authenticated users. Decide on a strategy: assign to the admin user, or add an "unclaimed sessions" UI. At minimum, set `user_id` to a known value so they show up somewhere.

- working: [ ]
- complete: [ ]

## 14. Fix rich session deletion ignoring executor

`lib/sessions.ts:336` — `delete()` calls `cleanupRichSession(name)` directly for rich mode, bypassing executor routing. Route rich session cleanup through the executor interface, same as terminal mode, so remote rich sessions are cleaned up properly.

- working: [ ]
- complete: [ ]

## 15. Add config key allowlist

`app/api/config/route.ts:18` — Any arbitrary key can be written. Add an allowlist of valid config keys and reject unknown keys with a 400 response.

- working: [ ]
- complete: [ ]

## 16. Replace empty catch blocks with logging

Go through the codebase and add at minimum `console.error` (or `console.warn` for expected-failure cases) to all empty `catch {}` blocks. Key locations:
- `lib/claude-bridge.ts:101, 465`
- `lib/pty-bridge.ts:99, 107`
- `executor/tmux-runner.ts:499`
- `lib/sessions.ts:57-106` (migration blocks — `console.debug` is fine here)
- `app/page.tsx` (multiple fetch catch blocks)
- `components/new-session-page.tsx:68`
- `components/rich-view.tsx`
- `components/dashboard.tsx`

- working: [ ]
- complete: [ ]

## 17. Move `tsx` to production dependencies

`package.json` lists `tsx` under `devDependencies` but it's required at runtime (`npm start` uses `tsx server.ts`). Move it to `dependencies`.

- working: [x]
- complete: [x]

## 18. Clean up stale `.next-staging` references

- `tsconfig.json:36` — Remove `.next-staging/types/**/*.ts` from `include`.
- `next-env.d.ts:3` — Remove the `/// <reference path="./.next-staging/types/routes.d.ts" />` line. This file is auto-generated by Next.js, so it may need to be regenerated cleanly by running a dev build.

- working: [ ]
- complete: [ ]

## 19. Replace deprecated `url.parse()` in server.ts

`server.ts` uses the legacy `url.parse()` on lines 2, 51, 70 while also using the modern `new URL()` constructor on line 39. Replace all `parse()` calls with `new URL()` and remove the `import { parse } from "url"`.

- working: [ ]
- complete: [ ]

## 20. Remove `(sm as any)` private member access in diagnose route

`app/api/sessions/[name]/diagnose/route.ts:10-11` uses `(sm as any)._registry` and `(sm as any).getSessionExecutorId`. Either expose proper public methods on `SessionManager` for what the diagnose route needs, or add a dedicated `diagnose()` method to `SessionManager` that encapsulates the logic.

- working: [ ]
- complete: [ ]
