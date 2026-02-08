import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { execFileSync, spawnSync } from "child_process";
import { bridgeSession } from "./lib/pty-bridge.js";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000");

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

const app = next({ dev, dir: process.cwd() });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!);
    const match = pathname?.match(/^\/ws\/sessions\/([^/]+)$/);

    if (match) {
      const sessionName = decodeURIComponent(match[1]);
      wss.handleUpgrade(req, socket, head, (ws) => {
        bridgeSession(ws, sessionName);
      });
    } else {
      // Let Next.js handle HMR upgrades in dev mode
      if (!dev) socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`Using ${tmuxVersion}`);
    console.log(`Claude Host running at http://localhost:${port}`);
  });
});
