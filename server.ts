import { createServer } from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { execFileSync, spawnSync } from "child_process";
import { getSessionManager } from "./lib/sessions";
import { ExecutorRegistry } from "./lib/executor-registry";
import { getAuthUser } from "./lib/auth";

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
  const tmuxPath = execFileSync("which", ["tmux"], { encoding: "utf-8" }).trim();
  const v = spawnSync(tmuxPath, ["-V"], { encoding: "utf-8" });
  tmuxVersion = `${v.stdout.trim()} (${tmuxPath})`;
} catch {
  console.error("Error: tmux is not installed or not in PATH");
  process.exit(1);
}

function validateExecutorToken(req: { headers: Record<string, string | string[] | undefined> }): { valid: boolean; userId?: string; keyId?: string } {
  const token = req.headers["x-executor-token"];
  if (!token || typeof token !== "string") return { valid: false };

  // Try per-user key validation first
  const result = getSessionManager().validateExecutorKey(token);
  if (result) return { valid: true, userId: result.userId, keyId: result.keyId };

  // Fall back to legacy EXECUTOR_TOKEN env var (for migration)
  if (EXECUTOR_TOKEN && token === EXECUTOR_TOKEN) {
    return { valid: true, userId: "local" };
  }

  return { valid: false };
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
    (id, status, userId) => {
      sessionManager.upsertExecutor({ id, name: id, labels: [], status, userId });
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
      const authResult = validateExecutorToken(req);
      if (!authResult.valid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        registry.handleControlConnection(ws, authResult.userId!);
      });
      return;
    }

    // --- Executor terminal channel: /ws/executor/terminal/<channelId> ---
    const termChannelMatch = pathname?.match(/^\/ws\/executor\/terminal\/([^/]+)$/);
    if (termChannelMatch) {
      const authResult = validateExecutorToken(req);
      if (!authResult.valid) {
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
    if (EXECUTOR_TOKEN) console.log(`Legacy EXECUTOR_TOKEN configured (migrate to per-user keys)`);
    console.log(`Executor connections via per-user keys`);
  });
});
