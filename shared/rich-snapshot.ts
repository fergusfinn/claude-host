import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Parse a rich session's events.ndjson and return a human-readable text snapshot.
 * Shared between the server (lib/sessions.ts) and executor (tmux-runner.ts).
 */
export function snapshotRichEvents(dataDir: string, name: string, maxLines = 50): string {
  const eventsPath = join(dataDir, "rich", name, "events.ndjson");
  if (!existsSync(eventsPath)) return "";
  let content: string;
  try {
    content = readFileSync(eventsPath, "utf-8");
  } catch {
    return "";
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
