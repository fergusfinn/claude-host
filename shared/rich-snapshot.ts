import { existsSync, openSync, fstatSync, readSync, closeSync } from "fs";
import { join } from "path";

/**
 * Parse a rich session's events.ndjson and return a human-readable text snapshot.
 * Shared between the server (lib/sessions.ts) and executor (tmux-runner.ts).
 *
 * Reads only the tail of the file (up to TAIL_BYTES) to avoid loading multi-MB
 * event logs into memory for sessions with long histories.
 */
export function snapshotRichEvents(dataDir: string, name: string, maxLines = 50): string {
  const eventsPath = join(dataDir, "rich", name, "events.ndjson");
  if (!existsSync(eventsPath)) return "";

  let fd: number;
  try {
    fd = openSync(eventsPath, "r");
  } catch {
    return "";
  }

  let content: string;
  try {
    const fileSize = fstatSync(fd).size;
    if (fileSize === 0) return "";

    // Only read the last 256KB — enough for snapshot text extraction
    const TAIL_BYTES = 256 * 1024;
    const readStart = Math.max(0, fileSize - TAIL_BYTES);
    const readLen = fileSize - readStart;
    const buf = Buffer.alloc(readLen);
    readSync(fd, buf, 0, readLen, readStart);
    content = buf.toString("utf-8");

    // If we started mid-file, skip the first (likely partial) line
    if (readStart > 0) {
      const firstNewline = content.indexOf("\n");
      if (firstNewline >= 0) {
        content = content.slice(firstNewline + 1);
      }
    }
  } catch {
    return "";
  } finally {
    closeSync(fd);
  }

  const lines: string[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "user") {
        for (const block of event.message?.content || []) {
          if (block.type === "text") lines.push(`User: ${block.text}`);
        }
      } else if (event.type === "assistant") {
        for (const block of event.message?.content || []) {
          if (block.type === "text") lines.push(`Assistant: ${block.text}`);
          if (block.type === "tool_use") lines.push(`[Tool: ${block.name}]`);
        }
      } else if (event.type === "result") {
        if (event.result) lines.push(`Result: ${event.result}`);
      }
    } catch (e) { console.debug("skipping malformed event line", e); }
  }
  return lines.slice(-maxLines).join("\n");
}
