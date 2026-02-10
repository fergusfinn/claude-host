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

### E2E tests

```bash
npm run test:e2e
```

14 integration tests across 4 files (~30s). Start a real server on a random port with `AUTH_DISABLED=1` and an isolated temp `DATA_DIR`, then exercise the full stack through HTTP API and WebSocket connections.

- `tests/e2e/sessions.test.ts` — terminal session CRUD, multi-client WebSocket, fork, reorder, jobs
- `tests/e2e/config.test.ts` — config persistence round-trip
- `tests/e2e/rich-sessions.test.ts` — rich session lifecycle with real `claude` CLI (create, prompt, response, reconnect+replay)
- `tests/e2e/remote-executor.test.ts` — remote executor registration and session via executor

Run a single file:
```bash
npx vitest run --config vitest.config.e2e.ts tests/e2e/sessions.test.ts
```

Rich session tests require the `claude` CLI to be available on `PATH`.

Note: you may be running on `gotenks` (the deploy target) rather than a local dev machine. Check `hostname` if unsure.

## Deployment

**Always run both unit and E2E tests before deploying:**

```bash
npm test && npm run test:e2e
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

## Project structure

- `server.ts` — HTTP + WebSocket server entry point
- `app/` — Next.js App Router pages and API routes
- `components/` — React components (dashboard, terminal view, tab bar, etc.)
- `lib/` — Shared utilities (sessions, pty-bridge, themes, shortcuts, layout)
- `hooks/` — React hooks
- `tests/e2e/` — E2E integration tests
- `executor/` — Remote executor client
- `tui/` — TUI-related code
- `data/` — SQLite database (gitignored)
