import { createServer } from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { spawnSync } from "child_process";
import { getSessionManager } from "./lib/sessions";
import { ExecutorRegistry } from "./lib/executor-registry";
import { getAuthUser } from "./lib/auth";
import { TMUX } from "./shared/tmux";

const dev = process.env.NODE_ENV !== "production";
const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
const EXECUTOR_TOKEN = process.env.EXECUTOR_TOKEN || "";
const VALID_SESSION_NAME = /^[a-zA-Z0-9_-]+$/;

// Preflight: check auth secret (skip if auth is disabled entirely)
if (!AUTH_DISABLED && !process.env.BETTER_AUTH_SECRET) {
  console.warn("WARNING: No BETTER_AUTH_SECRET set — using insecure default. Set BETTER_AUTH_SECRET for production use.");
}

// Support --port <n> CLI flag, falling back to PORT env, then 3000
function resolvePort(): number {
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1]);
    if (n > 0) return n;
  }
  return parseInt(process.env.PORT || "3000");
}
const port = resolvePort();

// Preflight: verify tmux
let tmuxVersion: string;
try {
  const v = spawnSync(TMUX, ["-V"], { encoding: "utf-8" });
  tmuxVersion = `${v.stdout.trim()} (${TMUX})`;
} catch {
  console.error("Error: tmux is not installed or not in PATH");
  process.exit(1);
}

function validateExecutorToken(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  if (!EXECUTOR_TOKEN) return false; // fail closed — no token configured means no executor access
  return req.headers["x-executor-token"] === EXECUTOR_TOKEN;
}

const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Wire up executor registry to session manager
  const sessionManager = getSessionManager();
  const registry = new ExecutorRegistry(
    (id, status) => {
      sessionManager.upsertExecutor({ id, name: id, labels: [], status });
    },
    (executorId, sessions) => {
      sessionManager.adoptOrphanedSessions(executorId, sessions);
    },
  );
  sessionManager.setRegistry(registry);

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = new URL(req.url!, "http://localhost");

    // --- Browser terminal sessions: /ws/sessions/<name> ---
    const terminalMatch = pathname?.match(/^\/ws\/sessions\/([^/]+)$/);
    if (terminalMatch) {
      const user = await getAuthUser(req);
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      const sessionName = decodeURIComponent(terminalMatch[1]);
      if (!VALID_SESSION_NAME.test(sessionName)) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
      if (!sessionManager.isOwnedBy(sessionName, user.userId)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
      const parsed = new URL(req.url!, "http://localhost");
      const cols = parseInt(parsed.searchParams.get("cols") || "") || 0;
      const rows = parseInt(parsed.searchParams.get("rows") || "") || 0;
      wss.handleUpgrade(req, socket, head, (ws) => {
        sessionManager.attachSession(sessionName, ws, cols, rows);
      });
      return;
    }

    // --- Rich-mode sessions: /ws/rich/<name> ---
    const richMatch = pathname?.match(/^\/ws\/rich\/([^/]+)$/);
    if (richMatch) {
      const user = await getAuthUser(req);
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      const sessionName = decodeURIComponent(richMatch[1]);
      if (!VALID_SESSION_NAME.test(sessionName)) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
      if (!sessionManager.isOwnedBy(sessionName, user.userId)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, (ws) => {
        sessionManager.attachRichSession(sessionName, ws);
      });
      return;
    }

    // --- Executor control channel: /ws/executor/control ---
    if (pathname === "/ws/executor/control") {
      if (!validateExecutorToken(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        registry.handleControlConnection(ws, EXECUTOR_TOKEN);
      });
      return;
    }

    // --- Executor terminal channel: /ws/executor/terminal/<channelId> ---
    const termChannelMatch = pathname?.match(/^\/ws\/executor\/terminal\/([^/]+)$/);
    if (termChannelMatch) {
      if (!validateExecutorToken(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const channelId = decodeURIComponent(termChannelMatch[1]);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const resolved = registry.resolveTerminalChannel(channelId, ws);
        if (!resolved) {
          ws.close(1008, "Unknown channel ID");
        }
      });
      return;
    }

    // Let Next.js handle HMR upgrades in dev mode
    if (!dev) socket.destroy();
  });

  server.listen(port, () => {
    console.log(`Using ${tmuxVersion}`);
    console.log(`Claude Host running at http://localhost:${port}`);
    if (EXECUTOR_TOKEN) {
      console.log(`Executor connections enabled (token configured)`);
    }
  });
});
