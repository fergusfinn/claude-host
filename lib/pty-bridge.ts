import * as pty from "node-pty";
import { WebSocket } from "ws";

export function bridgeSession(ws: WebSocket, sessionName: string): void {
  let term: pty.IPty;
  try {
    term = pty.spawn("/bin/sh", ["-c", `exec tmux attach -t "${sessionName}"`], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      env: { ...process.env } as Record<string, string>,
    });
  } catch (e: any) {
    ws.send(`\r\n[error: failed to attach: ${e.message}]\r\n`);
    ws.close();
    return;
  }

  term.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  ws.on("message", (msg: Buffer | string) => {
    const str = msg.toString();
    try {
      const parsed = JSON.parse(str);
      if (parsed.resize && Array.isArray(parsed.resize)) {
        const [cols, rows] = parsed.resize;
        if (cols > 0 && rows > 0) term.resize(cols, rows);
        return;
      }
    } catch {}
    term.write(str);
  });

  const cleanup = () => {
    try { term.kill(); } catch {}
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
  term.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
}
