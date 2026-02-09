# E2E Encryption for Executor Communication

## Problem

Terminal I/O between the browser and executor flows through the control plane in plaintext. The server can read all terminal content in transit. A security-conscious client running their own executor should be able to ensure the control plane cannot read their terminal streams.

## Key Insight

The client owns both sides of the connection — they run the browser and they launch the executor. There is no need for key exchange (Diffie-Hellman, Signal protocol, etc.) because the same party controls both endpoints. A simple symmetric key suffices.

## Design

### Key Distribution

1. Browser generates a random AES-256-GCM key via the Web Crypto API
2. Browser displays the key (base64-encoded) to the user, e.g. as part of a copy-pasteable executor launch command
3. User launches the executor with the key as an env var: `ENCRYPTION_KEY=<base64-key> npx tsx executor/index.ts --url ... --token ...`
4. Both sides now share the key. The control plane never sees it.

The URL fragment (`#key=...`) is another option — fragments are never sent to the server — but a simple displayed launch command is more explicit and harder to misuse.

### Encryption Layer

- **Executor side** (`executor/terminal-channel.ts`): encrypt PTY output before sending over WebSocket, decrypt incoming WebSocket messages before writing to PTY
- **Browser side** (`components/terminal-view.tsx`): encrypt keyboard input before sending over WebSocket, decrypt incoming messages before feeding to xterm.js
- **Algorithm**: AES-256-GCM (native support on both sides — Web Crypto API in browser, Node.js `crypto` module in executor)
- **Nonce/IV**: 12-byte random IV prepended to each ciphertext. AES-GCM requires a unique nonce per message; random 96-bit IVs are safe for the volume of messages we'd see.
- **Message format**: `[12-byte IV][ciphertext][16-byte auth tag]` — sent as binary WebSocket frames
- **Resize messages**: Also encrypted. The server currently peeks at resize messages (`{ resize: [cols, rows] }`) to coordinate multi-client resize — this would need to change. Either the server stops coordinating resize (each client tells the executor directly), or resize metadata is sent unencrypted alongside the encrypted payload.

### What Changes

| Component | Change |
|---|---|
| `executor/terminal-channel.ts` | Encrypt outbound PTY data, decrypt inbound data |
| `components/terminal-view.tsx` | Encrypt outbound keystrokes, decrypt inbound data |
| `server.ts` | No changes — just relays opaque binary frames |
| Browser UI | Show encryption key + launch command when creating an encrypted session |
| `shared/protocol.ts` | Add encrypted session/channel type or flag |

### What It Doesn't Cover

E2E encryption protects terminal stream **content**. The control plane still has full RPC authority over the executor — it can create sessions, delete sessions, run jobs, trigger upgrades, etc. This is about confidentiality, not about limiting the server's control.

## Broader Security Concerns

Beyond e2e encryption, a security-conscious client should consider:

### Auto-Upgrade (Remote Code Execution by Server)

The control plane can send an `upgrade` message, causing the executor to `git pull origin main && npm install` and restart. Whoever controls the control plane or the git repo can push arbitrary code to the executor.

**Mitigations:**
- `--no-upgrade` flag (already exists) — disables the upgrade RPC
- Pin executor to a specific commit/tag instead of tracking `main`
- Code signing — verify pulled code is signed by a trusted key before executing

### Token in Query String

The executor token is passed as `?token=...` in WebSocket URLs. This leaks into server logs, proxy logs, browser history, etc.

**Mitigation:** Move auth to an initial WebSocket message or `Sec-WebSocket-Protocol` header.

### No Browser Authentication

Browser-facing endpoints (`/ws/sessions/*`, all API routes) have zero authentication. Access control relies entirely on the Tailscale network boundary.

**Mitigation:** Add session-based auth or at minimum a shared secret for browser connections.

### Supply Chain

`npm install` on the executor pulls from the public npm registry. A compromised dependency means a compromised executor.

**Mitigations:**
- Lockfile integrity checking (`npm ci` with `--ignore-scripts` where possible)
- Vendored or pinned dependencies
- Periodic audit (`npm audit`)

### Control Plane Trust

Even with e2e encryption, the control plane has full RPC authority: create/delete sessions, run jobs, fork sessions. E2E encryption is about **confidentiality of terminal content**, not about limiting what the server can instruct the executor to do.

**Mitigation:** Executor-side allowlisting of RPC commands, or a capability-based auth model where the client grants specific permissions.

### Executor Code Provenance

A client running someone else's executor code is trusting it completely. It runs as their user and has access to everything on the machine.

**Mitigation:** Published, auditable releases with checksums. Container isolation for the executor process.
