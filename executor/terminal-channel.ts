/**
 * Terminal channel: opens a new WS to the control plane for a specific session,
 * spawns a PTY attached to the tmux session, bridges them.
 */

import WebSocket from "ws";
import * as pty from "node-pty";

interface TerminalChannelOpts {
  baseUrl: string;
  token: string;
  channelId: string;
  sessionName: string;
}

export function openTerminalChannel(opts: TerminalChannelOpts): void {
  const url = `${opts.baseUrl}/ws/executor/terminal/${opts.channelId}`;
  const ws = new WebSocket(url, { headers: { "x-executor-token": opts.token } });

  ws.on("open", () => {
    let term: pty.IPty;
    try {
      term = pty.spawn("/bin/sh", ["-c", `exec tmux attach -t "${opts.sessionName}"`], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        env: { ...process.env, LANG: process.env.LANG || "en_US.UTF-8", LC_CTYPE: process.env.LC_CTYPE || "en_US.UTF-8" } as Record<string, string>,
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
      } catch (e) { console.debug("failed to parse client message", e); }
      term.write(str);
    });

    const cleanup = () => {
      try { term.kill(); } catch (e) { console.warn("failed to kill pty", e); }
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);
    term.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  });

  ws.on("error", (err) => {
    console.error(`Terminal channel error (${opts.channelId}): ${err.message}`);
  });
}
