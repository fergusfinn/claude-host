import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { snapshotRichEvents } from "./rich-snapshot";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("snapshotRichEvents", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "rich-snapshot-test-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function writeEvents(name: string, events: object[]) {
    const dir = join(dataDir, "rich", name);
    mkdirSync(dir, { recursive: true });
    const content = events.map(e => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(join(dir, "events.ndjson"), content);
  }

  it("returns empty string when events file does not exist", () => {
    expect(snapshotRichEvents(dataDir, "nonexistent")).toBe("");
  });

  it("parses user messages", () => {
    writeEvents("test-session", [
      { type: "user", message: { content: [{ type: "text", text: "Hello" }] } },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("User: Hello");
  });

  it("parses assistant text messages", () => {
    writeEvents("test-session", [
      { type: "assistant", message: { content: [{ type: "text", text: "Hi there!" }] } },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("Assistant: Hi there!");
  });

  it("parses assistant tool_use messages", () => {
    writeEvents("test-session", [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("[Tool: Read]");
  });

  it("parses result events", () => {
    writeEvents("test-session", [
      { type: "result", result: "Done!" },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("Result: Done!");
  });

  it("handles multiple events in conversation order", () => {
    writeEvents("test-session", [
      { type: "user", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "assistant", message: { content: [
        { type: "text", text: "Let me help" },
        { type: "tool_use", name: "Edit" },
      ] } },
      { type: "result", result: "Complete" },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("User: Hello\nAssistant: Let me help\n[Tool: Edit]\nResult: Complete");
  });

  it("skips unknown event types", () => {
    writeEvents("test-session", [
      { type: "system", subtype: "init" },
      { type: "user", message: { content: [{ type: "text", text: "Hello" }] } },
      { type: "stream_event", data: "chunk" },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("User: Hello");
  });

  it("skips result events with no result field", () => {
    writeEvents("test-session", [
      { type: "result" },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("");
  });

  it("handles events with missing content array", () => {
    writeEvents("test-session", [
      { type: "user", message: {} },
      { type: "assistant", message: { content: null } },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("");
  });

  it("respects maxLines parameter", () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      type: "user",
      message: { content: [{ type: "text", text: `Message ${i}` }] },
    }));
    writeEvents("test-session", events);

    const result = snapshotRichEvents(dataDir, "test-session", 5);
    const lines = result.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("User: Message 15");
    expect(lines[4]).toBe("User: Message 19");
  });

  it("skips malformed JSON lines", () => {
    const dir = join(dataDir, "rich", "test-session");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "events.ndjson"),
      '{"type":"user","message":{"content":[{"type":"text","text":"Hello"}]}}\n' +
      'not valid json\n' +
      '{"type":"user","message":{"content":[{"type":"text","text":"World"}]}}\n'
    );

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("User: Hello\nUser: World");
  });

  it("skips blank lines in events file", () => {
    const dir = join(dataDir, "rich", "test-session");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "events.ndjson"),
      '{"type":"user","message":{"content":[{"type":"text","text":"Hello"}]}}\n\n\n' +
      '{"type":"user","message":{"content":[{"type":"text","text":"World"}]}}\n'
    );

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("User: Hello\nUser: World");
  });

  it("handles empty events file", () => {
    const dir = join(dataDir, "rich", "test-session");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "events.ndjson"), "");

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("");
  });

  it("handles multiple content blocks in a single message", () => {
    writeEvents("test-session", [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
            { type: "tool_use", name: "Bash" },
            { type: "tool_use", name: "Read" },
          ],
        },
      },
    ]);

    const result = snapshotRichEvents(dataDir, "test-session");
    expect(result).toBe("Assistant: First part\nAssistant: Second part\n[Tool: Bash]\n[Tool: Read]");
  });
});
