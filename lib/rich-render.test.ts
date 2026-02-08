import { describe, it, expect } from "vitest";
import {
  buildRenderItems,
  formatDuration,
  truncateAtWord,
  getToolSummary,
  formatToolInput,
  getToolIcon,
  type ContentBlock,
  type ContentBlockToolUse,
  type ContentBlockToolResult,
} from "./rich-render";

// ---- Helpers for building test data ----

function text(t: string): ContentBlock {
  return { type: "text", text: t };
}

function toolUse(id: string, name: string, input: Record<string, any> = {}): ContentBlockToolUse {
  return { type: "tool_use", id, name, input };
}

function toolResult(id: string, content: string, isError = false): ContentBlockToolResult {
  return { type: "tool_result", tool_use_id: id, content, is_error: isError };
}

// ---- buildRenderItems ----

describe("buildRenderItems", () => {
  it("handles empty blocks", () => {
    const items = buildRenderItems([], new Map());
    expect(items).toEqual([]);
  });

  it("renders text blocks", () => {
    const items = buildRenderItems([text("Hello"), text("World")], new Map());
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("text");
    expect(items[1].kind).toBe("text");
  });

  it("renders a single tool_use as tool_pair", () => {
    const blocks: ContentBlock[] = [
      toolUse("t1", "Read", { file_path: "/tmp/foo" }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool_pair");
    if (items[0].kind === "tool_pair") {
      expect(items[0].toolUse.id).toBe("t1");
      expect(items[0].toolResult).toBeNull();
    }
  });

  it("pairs tool_use with tool_result via resultMap", () => {
    const blocks: ContentBlock[] = [
      toolUse("t1", "Read", { file_path: "/tmp/foo" }),
    ];
    const resultMap = new Map([
      ["t1", toolResult("t1", "file contents")],
    ]);
    const items = buildRenderItems(blocks, resultMap);
    expect(items).toHaveLength(1);
    if (items[0].kind === "tool_pair") {
      expect(items[0].toolResult).not.toBeNull();
      expect(items[0].toolResult!.content).toBe("file contents");
    }
  });

  it("groups consecutive same-name tool_use into tool_group", () => {
    const blocks: ContentBlock[] = [
      toolUse("t1", "Read", { file_path: "/a" }),
      toolUse("t2", "Read", { file_path: "/b" }),
      toolUse("t3", "Read", { file_path: "/c" }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("tool_group");
    if (items[0].kind === "tool_group") {
      expect(items[0].name).toBe("Read");
      expect(items[0].pairs).toHaveLength(3);
    }
  });

  it("does not group different-name tool_use", () => {
    const blocks: ContentBlock[] = [
      toolUse("t1", "Read", { file_path: "/a" }),
      toolUse("t2", "Write", { file_path: "/b" }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("tool_pair");
    expect(items[1].kind).toBe("tool_pair");
  });

  it("renders AskUserQuestion as question", () => {
    const blocks: ContentBlock[] = [
      toolUse("q1", "AskUserQuestion", { questions: [] }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("question");
  });

  it("renders Task as subagent", () => {
    const blocks: ContentBlock[] = [
      toolUse("s1", "Task", { description: "do stuff", subagent_type: "Explore" }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("subagent");
  });

  it("skips tool_result blocks (they are paired via resultMap)", () => {
    const blocks: ContentBlock[] = [
      toolResult("t1", "some result"),
      text("after result"),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("text");
  });

  it("handles mixed text, tools, and questions", () => {
    const blocks: ContentBlock[] = [
      text("Intro text"),
      toolUse("t1", "Read", { file_path: "/a" }),
      toolUse("t2", "Read", { file_path: "/b" }),
      text("Middle text"),
      toolUse("q1", "AskUserQuestion", { questions: [] }),
      toolUse("s1", "Task", { description: "explore" }),
      toolUse("t3", "Bash", { command: "ls" }),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(6);
    expect(items[0].kind).toBe("text");        // Intro
    expect(items[1].kind).toBe("tool_group");   // 2x Read
    expect(items[2].kind).toBe("text");         // Middle
    expect(items[3].kind).toBe("question");     // AskUserQuestion
    expect(items[4].kind).toBe("subagent");     // Task
    expect(items[5].kind).toBe("tool_pair");    // Bash
  });

  it("does not group AskUserQuestion or Task even if consecutive", () => {
    const blocks: ContentBlock[] = [
      toolUse("q1", "AskUserQuestion", {}),
      toolUse("q2", "AskUserQuestion", {}),
    ];
    const items = buildRenderItems(blocks, new Map());
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("question");
    expect(items[1].kind).toBe("question");
  });

  it("groups tool results correctly in mixed scenario", () => {
    const blocks: ContentBlock[] = [
      toolUse("t1", "Read", { file_path: "/a" }),
      toolUse("t2", "Read", { file_path: "/b" }),
    ];
    const resultMap = new Map([
      ["t1", toolResult("t1", "contents of a")],
      ["t2", toolResult("t2", "contents of b")],
    ]);
    const items = buildRenderItems(blocks, resultMap);
    expect(items).toHaveLength(1);
    if (items[0].kind === "tool_group") {
      expect(items[0].pairs[0].toolResult!.content).toBe("contents of a");
      expect(items[0].pairs[1].toolResult!.content).toBe("contents of b");
    }
  });
});

// ---- formatDuration ----

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(3500)).toBe("3.5s");
  });

  it("formats minutes", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("handles exactly 1 second", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  it("handles exactly 1 minute", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });
});

// ---- truncateAtWord ----

describe("truncateAtWord", () => {
  it("returns short strings unchanged", () => {
    expect(truncateAtWord("hello", 10)).toBe("hello");
  });

  it("truncates at word boundary", () => {
    const result = truncateAtWord("hello beautiful world", 15);
    expect(result).toContain("\u2026");
    expect(result.length).toBeLessThanOrEqual(16); // 15 + ellipsis
  });

  it("returns exact-length strings unchanged", () => {
    expect(truncateAtWord("hello", 5)).toBe("hello");
  });

  it("handles strings with no spaces", () => {
    const result = truncateAtWord("abcdefghijklmnop", 10);
    expect(result.endsWith("\u2026")).toBe(true);
  });
});

// ---- getToolSummary ----

describe("getToolSummary", () => {
  it("returns file_path for Read", () => {
    expect(getToolSummary("Read", { file_path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
  });

  it("returns file_path for Edit", () => {
    expect(getToolSummary("Edit", { file_path: "/foo.ts" })).toBe("/foo.ts");
  });

  it("returns file_path for Write", () => {
    expect(getToolSummary("Write", { file_path: "/foo.ts" })).toBe("/foo.ts");
  });

  it("returns command for Bash", () => {
    expect(getToolSummary("Bash", { command: "ls -la" })).toBe("ls -la");
  });

  it("returns pattern for Glob", () => {
    expect(getToolSummary("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  it("returns pattern for Grep", () => {
    expect(getToolSummary("Grep", { pattern: "TODO" })).toBe("TODO");
  });

  it("returns description for Task", () => {
    expect(getToolSummary("Task", { description: "explore codebase" })).toBe("explore codebase");
  });

  it("returns query for WebSearch", () => {
    expect(getToolSummary("WebSearch", { query: "react docs" })).toBe("react docs");
  });

  it("returns empty for unknown tool", () => {
    expect(getToolSummary("UnknownTool", {})).toBe("");
  });
});

// ---- formatToolInput ----

describe("formatToolInput", () => {
  it("formats Bash command", () => {
    expect(formatToolInput("Bash", { command: "npm test" })).toBe("npm test");
  });

  it("formats Edit with diff", () => {
    const result = formatToolInput("Edit", {
      file_path: "/foo.ts",
      old_string: "old code",
      new_string: "new code",
    });
    expect(result).toContain("file: /foo.ts");
    expect(result).toContain("--- old");
    expect(result).toContain("+++ new");
  });

  it("formats Write with file path and content", () => {
    const result = formatToolInput("Write", {
      file_path: "/foo.ts",
      content: "line1\nline2",
    });
    expect(result).toContain("file: /foo.ts");
    expect(result).toContain("line1\nline2");
  });

  it("truncates long Write content", () => {
    const longContent = Array(50).fill("line").join("\n");
    const result = formatToolInput("Write", {
      file_path: "/foo.ts",
      content: longContent,
    });
    expect(result).toContain("50 lines total");
  });

  it("formats Task with type and prompt", () => {
    const result = formatToolInput("Task", {
      subagent_type: "Explore",
      prompt: "Find all tests",
    });
    expect(result).toContain("type: Explore");
    expect(result).toContain("Find all tests");
  });

  it("falls back to JSON for unknown tools", () => {
    const result = formatToolInput("Custom", { a: 1, b: "two" });
    expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
  });
});

// ---- getToolIcon ----

describe("getToolIcon", () => {
  it("returns known icons", () => {
    expect(getToolIcon("Read")).toBe("\u25C7");
    expect(getToolIcon("Edit")).toBe("\u25B3");
    expect(getToolIcon("Bash")).toBe("$");
  });

  it("returns default icon for unknown tools", () => {
    expect(getToolIcon("Custom")).toBe("\u25C6");
  });
});
