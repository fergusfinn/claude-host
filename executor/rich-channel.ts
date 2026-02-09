/**
 * Rich channel: opens a WS to the control plane for a rich session,
 * tails events.ndjson and relays prompts/interrupts to the FIFO.
 */

import WebSocket from "ws";
import { existsSync, openSync, readSync, fstatSync, closeSync, statSync, watch, writeSync, constants as fsConstants } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import type { FSWatcher } from "fs";

interface RichChannelOpts {
  baseUrl: string;
  token: string;
  channelId: string;
  sessionName: string;
  command: string;
}

export function openRichChannel(opts: RichChannelOpts): void {
  const url = `${opts.baseUrl}/ws/executor/terminal/${opts.channelId}?token=${encodeURIComponent(opts.token)}`;
  const ws = new WebSocket(url);

  const dataDir = join(process.cwd(), "data", "rich", opts.sessionName);
  const eventsFile = join(dataDir, "events.ndjson");
  const fifoPath = join(dataDir, "prompt.fifo");

  let byteOffset = 0;
  let lineBuffer = "";
  let watcher: FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  function readNewEvents(): void {
    if (!existsSync(eventsFile) || destroyed) return;

    let fd: number;
    try {
      fd = openSync(eventsFile, "r");
    } catch {
      return;
    }

    try {
      const fileSize = fstatSync(fd).size;
      if (fileSize <= byteOffset) return;

      const toRead = fileSize - byteOffset;
      const buf = Buffer.alloc(toRead);
      const bytesRead = readSync(fd, buf, 0, toRead, byteOffset);
      byteOffset += bytesRead;

      const chunk = lineBuffer + buf.slice(0, bytesRead).toString("utf-8");
      const lines = chunk.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "stream_event") continue;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "event", event }));
          }
        } catch {}
      }
    } finally {
      closeSync(fd);
    }
  }

  function replayEvents(): void {
    if (!existsSync(eventsFile)) return;
    // Read entire file for replay
    let fd: number;
    try {
      fd = openSync(eventsFile, "r");
    } catch {
      return;
    }
    try {
      const fileSize = fstatSync(fd).size;
      if (fileSize === 0) return;
      const buf = Buffer.alloc(fileSize);
      const bytesRead = readSync(fd, buf, 0, fileSize, 0);
      byteOffset = bytesRead;

      const content = buf.slice(0, bytesRead).toString("utf-8");
      let initSeen = false;
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "stream_event") continue;
          if (event.type === "system" && event.subtype === "init") {
            if (initSeen) continue;
            initSeen = true;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "event", event }));
          }
        } catch {}
      }
    } finally {
      closeSync(fd);
    }
  }

  function startTailing(): void {
    pollTimer = setInterval(() => readNewEvents(), 500);
    try {
      watcher = watch(eventsFile, () => readNewEvents());
    } catch {}
  }

  function sendPromptViaFifo(text: string): void {
    if (!existsSync(fifoPath)) return;
    try {
      const fd = openSync(fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK);
      const payload = JSON.stringify({ role: "user", content: [{ type: "text", text }] }) + "\n";
      writeSync(fd, payload);
      closeSync(fd);
    } catch {}
  }

  function sendInterrupt(): void {
    const tName = `rich-${opts.sessionName}`;
    spawnSync("tmux", ["send-keys", "-t", tName, "C-c"], { stdio: "pipe" });
  }

  function tmuxExists(): boolean {
    return spawnSync("tmux", ["has-session", "-t", `rich-${opts.sessionName}`], { stdio: "pipe" }).status === 0;
  }

  function cleanup(): void {
    destroyed = true;
    if (watcher) { try { watcher.close(); } catch {} }
    if (pollTimer) clearInterval(pollTimer);
    try { ws.close(); } catch {}
  }

  ws.on("open", () => {
    // Replay existing events then start tailing
    replayEvents();

    // Send session state
    const processAlive = tmuxExists();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "session_state", streaming: false, process_alive: processAlive }));
    }

    startTailing();
  });

  ws.on("message", (msg: Buffer | string) => {
    const str = msg.toString();
    let parsed: { type: string; text?: string };
    try {
      parsed = JSON.parse(str);
    } catch {
      return;
    }

    if (parsed.type === "prompt" && parsed.text) {
      sendPromptViaFifo(parsed.text);
    } else if (parsed.type === "interrupt") {
      sendInterrupt();
    }
  });

  ws.on("close", cleanup);
  ws.on("error", (err) => {
    console.error(`Rich channel error (${opts.channelId}): ${err.message}`);
    cleanup();
  });
}
