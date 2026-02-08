# Claude Host

Web-based tmux session manager. View and interact with tmux sessions through a browser using xterm.js and WebSockets.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
```

Requires `tmux` to be installed.

## Deployment

Deployed to `gotenks` (Ubuntu 22.04, accessible via Tailscale at `gotenks:3000`).

```bash
./deploy.sh
```

This syncs the source to `fergus@gotenks:~/claude-host`, installs production deps, builds Next.js, and restarts the `claude-host` systemd user service.

To check logs on the remote machine:

```bash
ssh fergus@gotenks journalctl --user -u claude-host -f
```

## Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```
