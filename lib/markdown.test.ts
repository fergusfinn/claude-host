import { describe, it, expect } from "vitest";
import { parseBlocks, parseInline, type Block, type InlineNode } from "./markdown";

describe("parseInline", () => {
  it("parses plain text", () => {
    const result = parseInline("hello world");
    expect(result).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("parses bold text", () => {
    const result = parseInline("**bold**");
    expect(result).toEqual([
      { type: "bold", children: [{ type: "text", text: "bold" }] },
    ]);
  });

  it("parses italic text", () => {
    const result = parseInline("*italic*");
    expect(result).toEqual([
      { type: "italic", children: [{ type: "text", text: "italic" }] },
    ]);
  });

  it("parses bold italic text", () => {
    const result = parseInline("***bold italic***");
    expect(result).toEqual([
      { type: "bold_italic", children: [{ type: "text", text: "bold italic" }] },
    ]);
  });

  it("parses inline code", () => {
    const result = parseInline("`code`");
    expect(result).toEqual([{ type: "code", text: "code" }]);
  });

  it("parses links", () => {
    const result = parseInline("[link text](https://example.com)");
    expect(result).toEqual([
      { type: "link", text: "link text", href: "https://example.com" },
    ]);
  });

  it("parses strikethrough", () => {
    const result = parseInline("~~struck~~");
    expect(result).toEqual([
      { type: "strikethrough", children: [{ type: "text", text: "struck" }] },
    ]);
  });

  it("parses mixed inline content", () => {
    const result = parseInline("Hello **world** and *universe*");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: "text", text: "Hello " });
    expect(result[1]).toEqual({ type: "bold", children: [{ type: "text", text: "world" }] });
    expect(result[2]).toEqual({ type: "text", text: " and " });
    expect(result[3]).toEqual({ type: "italic", children: [{ type: "text", text: "universe" }] });
  });

  it("parses mixed code and bold", () => {
    const result = parseInline("Use `console.log` for **debugging**");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: "text", text: "Use " });
    expect(result[1]).toEqual({ type: "code", text: "console.log" });
    expect(result[2]).toEqual({ type: "text", text: " for " });
    expect(result[3]).toEqual({ type: "bold", children: [{ type: "text", text: "debugging" }] });
  });

  it("returns empty array for empty string", () => {
    expect(parseInline("")).toEqual([]);
  });
});

describe("parseBlocks", () => {
  it("parses a simple paragraph", () => {
    const blocks = parseBlocks("Hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("parses headings of different levels", () => {
    for (let level = 1; level <= 6; level++) {
      const prefix = "#".repeat(level);
      const blocks = parseBlocks(`${prefix} Heading ${level}`);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: "heading", level });
      const heading = blocks[0] as Extract<Block, { type: "heading" }>;
      expect(heading.inline).toEqual([{ type: "text", text: `Heading ${level}` }]);
    }
  });

  it("parses code blocks", () => {
    const blocks = parseBlocks("```typescript\nconst x = 1;\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "code",
      lang: "typescript",
      content: "const x = 1;",
    });
  });

  it("parses code blocks without language", () => {
    const blocks = parseBlocks("```\nsome code\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: "code",
      lang: "",
      content: "some code",
    });
  });

  it("handles unterminated code blocks (streaming)", () => {
    const blocks = parseBlocks("```python\nprint('hello')\nprint('world')");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "code",
      lang: "python",
      content: "print('hello')\nprint('world')",
    });
  });

  it("parses unordered lists", () => {
    const blocks = parseBlocks("- item 1\n- item 2\n- item 3");
    expect(blocks).toHaveLength(1);
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    expect(ul.type).toBe("ul");
    expect(ul.items).toHaveLength(3);
    expect(ul.items[0]).toEqual([{ type: "text", text: "item 1" }]);
  });

  it("parses unordered lists with * prefix", () => {
    const blocks = parseBlocks("* item 1\n* item 2");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("ul");
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    expect(ul.items).toHaveLength(2);
  });

  it("parses ordered lists", () => {
    const blocks = parseBlocks("1. first\n2. second\n3. third");
    expect(blocks).toHaveLength(1);
    const ol = blocks[0] as Extract<Block, { type: "ol" }>;
    expect(ol.type).toBe("ol");
    expect(ol.items).toHaveLength(3);
    expect(ol.items[0].n).toBe(1);
    expect(ol.items[2].n).toBe(3);
  });

  it("parses blockquotes", () => {
    const blocks = parseBlocks("> This is a quote");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("blockquote");
    const bq = blocks[0] as Extract<Block, { type: "blockquote" }>;
    expect(bq.inline).toEqual([{ type: "text", text: "This is a quote" }]);
  });

  it("parses multi-line blockquotes", () => {
    const blocks = parseBlocks("> line 1\n> line 2");
    expect(blocks).toHaveLength(1);
    const bq = blocks[0] as Extract<Block, { type: "blockquote" }>;
    expect(bq.inline).toEqual([{ type: "text", text: "line 1\nline 2" }]);
  });

  it("parses horizontal rules with ---", () => {
    const blocks = parseBlocks("---");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("hr");
  });

  it("parses horizontal rules with ***", () => {
    const blocks = parseBlocks("***");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("hr");
  });

  it("parses tables", () => {
    const input = "| Name | Value |\n| --- | --- |\n| foo | 1 |\n| bar | 2 |";
    const blocks = parseBlocks(input);
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as Extract<Block, { type: "table" }>;
    expect(table.type).toBe("table");
    expect(table.headers).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.headers[0]).toEqual([{ type: "text", text: "Name" }]);
    expect(table.rows[0][1]).toEqual([{ type: "text", text: "1" }]);
  });

  it("skips blank lines", () => {
    const blocks = parseBlocks("Hello\n\nWorld");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("parses a complex document", () => {
    const input = [
      "# Title",
      "",
      "Some text with **bold** and `code`.",
      "",
      "```js",
      "console.log('hi');",
      "```",
      "",
      "- item a",
      "- item b",
      "",
      "---",
      "",
      "> A quote",
    ].join("\n");

    const blocks = parseBlocks(input);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "code", "ul", "hr", "blockquote"]);
  });

  it("handles multi-line list items with continuation", () => {
    const blocks = parseBlocks("- item 1\n  continuation\n- item 2");
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    expect(ul.items).toHaveLength(2);
    expect(ul.items[0]).toEqual([{ type: "text", text: "item 1 continuation" }]);
  });

  it("handles empty input", () => {
    expect(parseBlocks("")).toEqual([]);
  });

  it("handles only whitespace", () => {
    expect(parseBlocks("   \n\n   ")).toEqual([]);
  });

  it("does not treat --- inside text as hr", () => {
    // A line with --- that has text before it should be a paragraph
    const blocks = parseBlocks("not a rule ---text");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("parses inline formatting within headings", () => {
    const blocks = parseBlocks("## Hello **world**");
    const heading = blocks[0] as Extract<Block, { type: "heading" }>;
    expect(heading.inline).toHaveLength(2);
    expect(heading.inline[0]).toEqual({ type: "text", text: "Hello " });
    expect(heading.inline[1]).toEqual({
      type: "bold",
      children: [{ type: "text", text: "world" }],
    });
  });

  it("parses inline formatting within list items", () => {
    const blocks = parseBlocks("- **bold item**\n- `code item`");
    const ul = blocks[0] as Extract<Block, { type: "ul" }>;
    expect(ul.items[0]).toEqual([
      { type: "bold", children: [{ type: "text", text: "bold item" }] },
    ]);
    expect(ul.items[1]).toEqual([
      { type: "code", text: "code item" },
    ]);
  });
});
