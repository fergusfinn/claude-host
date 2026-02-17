# Claude Host

Web-based tmux session manager built with Next.js 15, xterm.js, node-pty, and WebSockets.

## Stack

- **Server**: Custom HTTP server (`server.ts`) wrapping Next.js with WebSocket support
- **Frontend**: Next.js App Router, React 19, xterm.js with WebGL renderer
- **Data**: better-sqlite3 for session metadata, node-pty for terminal bridging
- **Runtime**: tsx (TypeScript execution without precompilation)

## Commands

- `npm run dev` — start dev server on :3000
- `npm run build` — production Next.js build
- `npm start` — production server

## Testing

### Unit tests

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage
```

190 unit tests across 13 files. All mock external boundaries (database, child_process, node-pty, WebSocket). Fast (~1s).

## Deployment

**Run unit tests before deploying:**

```bash
npm test
```

Deploy to `gotenks` (reachable via Tailscale):

```bash
./deploy.sh
```

The script requires a clean working tree. It pushes to `origin/main`, then SSHs to gotenks (or runs locally if already on gotenks) to pull, `npm install --omit=dev`, build to a staging dir, stop the service, swap `.next` dirs, and restart. Runs as a systemd user service (`claude-host.service`) on `gotenks:3000`.

Check remote logs:
```bash
ssh fergus@gotenks journalctl --user -u claude-host -f
```

## Executor token migration

Executor authentication is migrating from a single shared `EXECUTOR_TOKEN` env var to per-user API keys (`chk_` tokens) managed through the UI (Executors page > Add executor).

**How it works now (backward-compatible):**

1. Server tries per-user key validation first (`validateExecutorKey` in `lib/sessions.ts`)
2. Falls back to `EXECUTOR_TOKEN` env var if no per-user key matches
3. Legacy token authenticates as user `"local"`

**Migration steps:**

1. Deploy this branch — existing executors using `EXECUTOR_TOKEN` continue working unchanged
2. Generate per-user keys via the Executors page and reconfigure remote executors with `--token chk_...`
3. Once all executors use per-user keys, remove `EXECUTOR_TOKEN` from:
   - `deploy.sh` (the `Environment=EXECUTOR_TOKEN=...` line in the systemd unit)
   - `~/.claude-host-executor-token` on gotenks
4. Optionally remove the legacy fallback from `server.ts` (`validateExecutorToken`)

**Key format:** `chk_<64 hex chars>` — SHA-256 hashed in the DB, 8-char prefix stored for lookup.

## Session architecture

### Executor model

All executors (including the local one) use the same `RemoteExecutor` codepath — RPC over WebSocket. The server auto-spawns a local executor process (`executor/index.ts --id local`) on startup with a loopback token. This eliminates the previous local-vs-remote code duplication.

Set `DISABLE_LOCAL_EXECUTOR=1` to skip spawning the local executor (e.g. when all sessions run on remote machines).

### Terminal vs Rich pairs

Sessions have one axis of duplication: **terminal vs rich** (mode). Methods marked `// PARALLEL:` in the code cross-reference their counterpart:

| Terminal | Rich | What it does |
|----------|------|-------------|
| `createSession` | `createRichSession` | Create tmux session |
| `deleteSession` | `deleteRichSession` | Kill tmux + cleanup |
| `snapshotSession` | `snapshotRichSession` | Capture current state |
| `attachSession` | `attachRichSession` | Bridge browser WS to session |

Each pair has implementations across these files:

- **`shared/types.ts`** — `ExecutorInterface` definition
- **`executor/tmux-runner.ts`** — tmux subprocess operations
- **`lib/executor-interface.ts`** — `RemoteExecutor` (RPC over WebSocket to executor)
- **`lib/sessions.ts`** — `SessionManager` (DB + routing, branches on `mode`)
- **`server.ts`** — WebSocket upgrade handlers (`/ws/sessions/<name>` vs `/ws/rich/<name>`)

### Key differences between the modes

- **Terminal**: tmux session created eagerly, named directly (e.g. `fuzzy-ocean`), bridged via `executor/terminal-channel.ts` (node-pty, raw binary)
- **Rich**: tmux session created lazily on first prompt, named `rich-<name>`, bridged via `executor/rich-channel.ts` (FIFO + events.ndjson, structured JSON)
- **Rich tmux sessions are filtered from `listSessions()`** to avoid double-counting — the `rich-` prefix is load-bearing

`RemoteExecutor.attachSession()` and `RemoteExecutor.attachRichSession()` contain nearly identical WS bridging logic (channel setup, message buffering, cleanup). Changes to one should be applied to the other.

## Project structure

- `server.ts` — HTTP + WebSocket server entry point
- `app/` — Next.js App Router pages and API routes
- `components/` — React components (dashboard, terminal view, tab bar, etc.)
- `lib/` — Shared utilities (sessions, themes, shortcuts, layout)
- `hooks/` — React hooks
- `executor/` — Executor process (local and remote)
- `tui/` — TUI-related code
- `data/` — SQLite database (gitignored)
