/**
 * Rich channel: opens a WS to the control plane for a rich session,
 * tails events.ndjson and relays prompts/interrupts to the FIFO.
 */

import WebSocket from "ws";
import { existsSync, openSync, readSync, fstatSync, closeSync, statSync, watch, writeSync, appendFileSync, constants as fsConstants } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import type { FSWatcher } from "fs";

import { TMUX } from "../shared/tmux";

interface RichChannelOpts {
  baseUrl: string;
  token: string;
  channelId: string;
  sessionName: string;
  command: string;
}

export function openRichChannel(opts: RichChannelOpts): void {
  const url = `${opts.baseUrl}/ws/executor/terminal/${opts.channelId}`;
  const ws = new WebSocket(url, { headers: { "x-executor-token": opts.token } });

  const thisDir = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(thisDir, "..");
  const dataDir = join(repoRoot, "data", "rich", opts.sessionName);
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
        } catch (e) { console.debug("failed to send event to ws", e); }
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
        } catch (e) { console.debug("failed to send event to ws", e); }
      }
    } finally {
      closeSync(fd);
    }
  }

  function startTailing(): void {
    pollTimer = setInterval(() => readNewEvents(), 500);
    if (existsSync(eventsFile)) {
      try {
        watcher = watch(eventsFile, () => readNewEvents());
      } catch (e) { console.warn("failed to watch events file", e); }
    }
  }

  function tryWriteFifo(text: string): boolean {
    if (!existsSync(fifoPath)) return false;
    try {
      const fd = openSync(fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK);
      try {
        const payload = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n";
        writeSync(fd, payload);
        return true;
      } finally {
        closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  /** Retry writing to FIFO for up to 5s (wrapper needs time to create & open it) */
  function sendPromptViaFifo(text: string): void {
    if (tryWriteFifo(text)) return;

    const maxWait = 5000;
    const start = Date.now();
    const retry = () => {
      if (destroyed) return;
      if (tryWriteFifo(text)) return;
      if (Date.now() - start < maxWait) {
        setTimeout(retry, 200);
      } else {
        console.error(`Rich channel (${opts.sessionName}): FIFO write failed after ${maxWait}ms`);
      }
    };
    setTimeout(retry, 200);
  }

  function sendInterrupt(): void {
    const tName = `rich-${opts.sessionName}`;
    spawnSync(TMUX, ["send-keys", "-t", tName, "C-c"], { stdio: "pipe" });
  }

  function tmuxExists(): boolean {
    return spawnSync(TMUX, ["has-session", "-t", `rich-${opts.sessionName}`], { stdio: "pipe" }).status === 0;
  }

  function cleanup(): void {
    destroyed = true;
    if (watcher) { try { watcher.close(); } catch (e) { console.warn("failed to close watcher", e); } }
    if (pollTimer) clearInterval(pollTimer);
    try { ws.close(); } catch (e) { console.warn("failed to close ws", e); }
  }

  ws.on("open", () => {
    // Replay existing events then start tailing
    replayEvents();

    // Wait briefly for the tmux session to be ready (it may have just been spawned)
    const sendState = (attempt = 0) => {
      if (destroyed) return;
      const processAlive = tmuxExists();
      if (processAlive || attempt >= 10) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "session_state", streaming: false, process_alive: processAlive }));
        }
        startTailing();
      } else {
        setTimeout(() => sendState(attempt + 1), 500);
      }
    };
    sendState();
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
      // Persist and broadcast the user message (matches local bridge behavior)
      const userEvent = { type: "user", message: { role: "user", content: [{ type: "text", text: parsed.text }] } };
      const userLine = JSON.stringify(userEvent) + "\n";
      try { appendFileSync(eventsFile, userLine); } catch {}
      byteOffset += Buffer.byteLength(userLine);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "event", event: userEvent }));
      }
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
