import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { execFileSync, spawnSync } from "child_process";
import { getSessionManager } from "./lib/sessions";
import { ExecutorRegistry } from "./lib/executor-registry";
import { bridgeRichSession } from "./lib/claude-bridge";

const dev = process.env.NODE_ENV !== "production";
const EXECUTOR_TOKEN = process.env.EXECUTOR_TOKEN || "";

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

function validateExecutorToken(url: string): boolean {
  if (!EXECUTOR_TOKEN) return true;
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("token") === EXECUTOR_TOKEN;
  } catch {
    return false;
  }
}

const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Wire up executor registry to session manager
  const sessionManager = getSessionManager();
  const registry = new ExecutorRegistry((id, status) => {
    sessionManager.upsertExecutor({ id, name: id, labels: [], status });
  });
  sessionManager.setRegistry(registry);

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!);

    // --- Browser terminal sessions: /ws/sessions/<name> ---
    const terminalMatch = pathname?.match(/^\/ws\/sessions\/([^/]+)$/);
    if (terminalMatch) {
      const sessionName = decodeURIComponent(terminalMatch[1]);
      wss.handleUpgrade(req, socket, head, (ws) => {
        sessionManager.attachSession(sessionName, ws);
      });
      return;
    }

    // --- Rich-mode sessions: /ws/rich/<name> ---
    const richMatch = pathname?.match(/^\/ws\/rich\/([^/]+)$/);
    if (richMatch) {
      const sessionName = decodeURIComponent(richMatch[1]);
      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeRichSession(ws, sessionName);
      });
      return;
    }

    // --- Executor control channel: /ws/executor/control ---
    if (pathname === "/ws/executor/control") {
      if (!validateExecutorToken(req.url!)) {
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
      if (!validateExecutorToken(req.url!)) {
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
