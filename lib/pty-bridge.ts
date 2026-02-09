import * as pty from "node-pty";
import { WebSocket } from "ws";

/**
 * Shared PTY bridge: one PTY per tmux session, multiple WS clients.
 * The terminal is resized to the minimum dimensions across all connected clients
 * (like tmux's default "smallest window" behavior) to avoid resize fights.
 */

interface ClientInfo {
  ws: WebSocket;
  cols: number;
  rows: number;
}

interface SharedSession {
  term: pty.IPty;
  clients: Map<WebSocket, ClientInfo>;
}

const sessions = new Map<string, SharedSession>();

function computeMinSize(clients: Map<WebSocket, ClientInfo>): { cols: number; rows: number } {
  let cols = Infinity;
  let rows = Infinity;
  for (const client of clients.values()) {
    if (client.cols > 0 && client.cols < cols) cols = client.cols;
    if (client.rows > 0 && client.rows < rows) rows = client.rows;
  }
  return {
    cols: cols === Infinity ? 80 : cols,
    rows: rows === Infinity ? 24 : rows,
  };
}

export function bridgeSession(ws: WebSocket, sessionName: string, initialCols?: number, initialRows?: number): void {
  const cols = (initialCols && initialCols > 0) ? initialCols : 80;
  const rows = (initialRows && initialRows > 0) ? initialRows : 24;

  let session = sessions.get(sessionName);

  if (!session) {
    // First client — spawn a new PTY at the client's actual dimensions
    let term: pty.IPty;
    try {
      term = pty.spawn("/bin/sh", ["-c", `exec tmux attach -t "${sessionName}"`], {
        name: "xterm-256color",
        cols,
        rows,
        env: { ...process.env, LANG: process.env.LANG || "en_US.UTF-8", LC_CTYPE: process.env.LC_CTYPE || "en_US.UTF-8" } as Record<string, string>,
      });
    } catch (e: any) {
      ws.send(`\r\n[error: failed to attach: ${e.message}]\r\n`);
      ws.close();
      return;
    }

    session = { term, clients: new Map() };
    sessions.set(sessionName, session);

    // Broadcast PTY output to all connected clients
    term.onData((data: string) => {
      for (const client of session!.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
      }
    });

    term.onExit(() => {
      for (const client of session!.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
      }
      sessions.delete(sessionName);
    });
  }

  // Add this client with its actual dimensions and resize the PTY immediately
  const clientInfo: ClientInfo = { ws, cols, rows };
  session.clients.set(ws, clientInfo);
  const min = computeMinSize(session.clients);
  session.term.resize(min.cols, min.rows);

  // Handle messages from this client
  const sess = session; // capture for closures
  ws.on("message", (msg: Buffer | string) => {
    const str = msg.toString();
    try {
      const parsed = JSON.parse(str);
      if (parsed.resize && Array.isArray(parsed.resize)) {
        const [cols, rows] = parsed.resize;
        if (cols > 0 && rows > 0) {
          clientInfo.cols = cols;
          clientInfo.rows = rows;
          // Resize PTY to minimum across all clients
          const min = computeMinSize(sess.clients);
          sess.term.resize(min.cols, min.rows);
        }
        return;
      }
    } catch {}
    sess.term.write(str);
  });

  const cleanup = () => {
    sess.clients.delete(ws);
    if (sess.clients.size === 0) {
      // Last client disconnected — kill the PTY
      try { sess.term.kill(); } catch {}
      sessions.delete(sessionName);
    } else {
      // Recalculate size without this client
      const min = computeMinSize(sess.clients);
      sess.term.resize(min.cols, min.rows);
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
