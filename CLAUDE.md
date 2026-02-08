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
- `npm test` — run tests with vitest
- `npm run test:watch` — tests in watch mode
- `npm run test:coverage` — tests with coverage

## Deployment

Deploy to `gotenks` (reachable via Tailscale):

```bash
./deploy.sh
```

Runs as a systemd user service (`claude-host.service`) on `gotenks:3000`. The script rsyncs source, installs deps, builds, and restarts the service. Check remote logs with:

```bash
ssh fergus@gotenks journalctl --user -u claude-host -f
```

## Project structure

- `server.ts` — HTTP + WebSocket server entry point
- `app/` — Next.js App Router pages and API routes
- `components/` — React components (dashboard, terminal view, tab bar, etc.)
- `lib/` — Shared utilities (sessions, pty-bridge, themes, shortcuts, layout)
- `hooks/` — React hooks
- `tui/` — TUI-related code
- `data/` — SQLite database (gitignored)
