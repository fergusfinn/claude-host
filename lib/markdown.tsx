"use client";

import React, { useState, useMemo } from "react";
import type { TerminalTheme } from "./themes";

// ---------------------------------------------------------------------------
// Custom markdown-to-React parser (zero dependencies).
// Handles the predictable subset of markdown that Claude outputs.
// Designed for streaming: gracefully handles partial/unterminated blocks.
// ---------------------------------------------------------------------------

/** Public API */
export function renderMarkdown(
  text: string,
  theme: TerminalTheme,
): React.ReactNode {
  const blocks = parseBlocks(text);
  return blocks.map((block, i) => renderBlock(block, i, theme));
}

/** Memoized wrapper — avoids re-parsing when props haven't changed */
export const MemoizedMarkdown = React.memo(function MemoizedMarkdown({
  text,
  theme,
}: {
  text: string;
  theme: TerminalTheme;
}) {
  const rendered = useMemo(() => renderMarkdown(text, theme), [text, theme]);
  return <>{rendered}</>;
});

// ---------------------------------------------------------------------------
// Block-level types
// ---------------------------------------------------------------------------

type Block =
  | { type: "code"; lang: string; content: string }
  | { type: "heading"; level: number; inline: InlineNode[] }
  | { type: "blockquote"; inline: InlineNode[] }
  | { type: "ul"; items: InlineNode[][] }
  | { type: "ol"; items: { n: number; inline: InlineNode[] }[] }
  | { type: "hr" }
  | { type: "paragraph"; inline: InlineNode[] };

// Inline types
type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "bold_italic"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "strikethrough"; children: InlineNode[] };

// ---------------------------------------------------------------------------
// Block-level parsing
// ---------------------------------------------------------------------------

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.match(/^```/)) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    // Horizontal rule (--- or ***)
    if (line.match(/^\s*([-*_])\s*\1(\s*\1)*\s*$/) && line.trim().length >= 3) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        inline: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Blockquote (consecutive > lines)
    if (line.match(/^>\s?/)) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].match(/^>\s?/)) {
        bqLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({
        type: "blockquote",
        inline: parseInline(bqLines.join("\n")),
      });
      continue;
    }

    // Unordered list (- or * at start)
    if (line.match(/^\s*[-*]\s+/)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, "");
        const parts = [itemText];
        i++;
        while (
          i < lines.length &&
          lines[i].match(/^\s{2,}/) &&
          !lines[i].match(/^\s*[-*]\s+/) &&
          !lines[i].match(/^\s*\d+\.\s+/)
        ) {
          parts.push(lines[i].trim());
          i++;
        }
        items.push(parseInline(parts.join(" ")));
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: { n: number; inline: InlineNode[] }[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        const m = lines[i].match(/^\s*(\d+)\.\s+(.*)$/);
        if (m) {
          const parts = [m[2]];
          i++;
          while (
            i < lines.length &&
            lines[i].match(/^\s{2,}/) &&
            !lines[i].match(/^\s*\d+\.\s+/) &&
            !lines[i].match(/^\s*[-*]\s+/)
          ) {
            parts.push(lines[i].trim());
            i++;
          }
          items.push({ n: parseInt(m[1]), inline: parseInline(parts.join(" ")) });
        } else {
          i++;
        }
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Blank line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].match(/^>\s?/) &&
      !lines[i].match(/^\s*[-*]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/) &&
      !lines[i].match(/^\s*([-*_])\s*\1(\s*\1)*\s*$/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: "paragraph",
        inline: parseInline(paraLines.join("\n")),
      });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(nodes, text.slice(lastIndex, match.index));
    }

    if (match[2] !== undefined) {
      nodes.push({ type: "bold_italic", children: parseInline(match[2]) });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "bold", children: parseInline(match[3]) });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "italic", children: parseInline(match[4]) });
    } else if (match[5] !== undefined) {
      nodes.push({ type: "strikethrough", children: parseInline(match[5]) });
    } else if (match[6] !== undefined) {
      nodes.push({ type: "code", text: match[6] });
    } else if (match[7] !== undefined && match[8] !== undefined) {
      nodes.push({ type: "link", text: match[7], href: match[8] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    pushText(nodes, text.slice(lastIndex));
  }

  return nodes;
}

function pushText(nodes: InlineNode[], text: string) {
  if (text) nodes.push({ type: "text", text });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBlock(
  block: Block,
  key: number,
  theme: TerminalTheme,
): React.ReactNode {
  switch (block.type) {
    case "code":
      return <CodeBlock key={key} lang={block.lang} content={block.content} theme={theme} />;

    case "heading": {
      const sizes: Record<number, number> = { 1: 1.15, 2: 1.08, 3: 1.0, 4: 0.95, 5: 0.9, 6: 0.85 };
      const size = sizes[block.level] ?? 1;
      return (
        <div
          key={key}
          style={{
            fontSize: `${size}em`,
            fontWeight: 600,
            margin: "0.6em 0 0.25em",
            color: theme.foreground,
          }}
        >
          {renderInlineNodes(block.inline, theme)}
        </div>
      );
    }

    case "blockquote":
      return (
        <div
          key={key}
          style={{
            borderLeft: `2px solid ${theme.cyan}`,
            paddingLeft: 10,
            margin: "0.35em 0",
            opacity: 0.85,
          }}
        >
          {renderInlineNodes(block.inline, theme)}
        </div>
      );

    case "ul":
      return (
        <ul
          key={key}
          style={{
            margin: "0.3em 0",
            paddingLeft: 20,
            listStyleType: "disc",
          }}
        >
          {block.items.map((item, j) => (
            <li key={j} style={{ margin: "0.15em 0" }}>
              {renderInlineNodes(item, theme)}
            </li>
          ))}
        </ul>
      );

    case "ol":
      return (
        <ol
          key={key}
          start={block.items[0]?.n ?? 1}
          style={{
            margin: "0.3em 0",
            paddingLeft: 20,
          }}
        >
          {block.items.map((item, j) => (
            <li key={j} value={item.n} style={{ margin: "0.15em 0" }}>
              {renderInlineNodes(item.inline, theme)}
            </li>
          ))}
        </ol>
      );

    case "hr":
      return (
        <hr
          key={key}
          style={{
            border: "none",
            borderTop: `1px solid ${theme.foreground}20`,
            margin: "0.5em 0",
          }}
        />
      );

    case "paragraph":
      return (
        <p key={key} style={{ margin: "0.35em 0" }}>
          {renderInlineNodes(block.inline, theme)}
        </p>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CodeBlock component (with copy button)
// ---------------------------------------------------------------------------

function CodeBlock({ lang, content, theme }: { lang: string; content: string; theme: TerminalTheme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <pre
      style={{
        margin: "6px 0",
        padding: "10px 12px",
        fontSize: 12,
        lineHeight: 1.5,
        background: `${theme.foreground}08`,
        border: `1px solid ${theme.foreground}15`,
        overflowX: "auto",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: lang ? 4 : 0,
          minHeight: 16,
        }}
      >
        {lang ? (
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 500,
              color: theme.cyan,
            }}
          >
            {lang}
          </span>
        ) : <span />}
        <button
          onClick={handleCopy}
          style={{
            background: "transparent",
            border: "none",
            color: copied ? theme.green : `${theme.foreground}40`,
            cursor: "pointer",
            fontSize: 10,
            padding: "2px 6px",
            fontFamily: "inherit",
            transition: "color 0.15s",
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <code>{content}</code>
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

function renderInlineNodes(
  nodes: InlineNode[],
  theme: TerminalTheme,
): React.ReactNode {
  return nodes.map((node, i) => renderInlineNode(node, i, theme));
}

function renderInlineNode(
  node: InlineNode,
  key: number,
  theme: TerminalTheme,
): React.ReactNode {
  switch (node.type) {
    case "text":
      return node.text.split("\n").map((segment, j, arr) => (
        <React.Fragment key={`${key}-${j}`}>
          {segment}
          {j < arr.length - 1 && <br />}
        </React.Fragment>
      ));

    case "bold":
      return (
        <strong key={key}>
          {renderInlineNodes(node.children, theme)}
        </strong>
      );

    case "italic":
      return (
        <em key={key}>
          {renderInlineNodes(node.children, theme)}
        </em>
      );

    case "bold_italic":
      return (
        <strong key={key}>
          <em>{renderInlineNodes(node.children, theme)}</em>
        </strong>
      );

    case "code":
      return (
        <code
          key={key}
          style={{
            padding: "1px 5px",
            fontSize: "0.92em",
            background: `${theme.foreground}12`,
          }}
        >
          {node.text}
        </code>
      );

    case "link":
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: theme.blue,
            textDecoration: "none",
          }}
        >
          {node.text}
        </a>
      );

    case "strikethrough":
      return (
        <del key={key} style={{ opacity: 0.6 }}>
          {renderInlineNodes(node.children, theme)}
        </del>
      );

    default:
      return null;
  }
}
