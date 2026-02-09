"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TerminalTheme, TerminalFont } from "@/lib/themes";

interface Props {
  filePath: string;
  theme: TerminalTheme;
  font: TerminalFont;
  onClose: () => void;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
  rb: "ruby", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  swift: "swift", json: "json", jsonc: "jsonc",
  yaml: "yaml", yml: "yaml", toml: "toml",
  md: "markdown", mdx: "mdx",
  css: "css", scss: "scss", less: "less",
  html: "html", xml: "xml", svg: "xml",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  dockerfile: "dockerfile", graphql: "graphql",
  lua: "lua", php: "php", r: "r", dart: "dart", vue: "vue",
};

function getLang(filePath: string): string {
  const name = filePath.split("/").pop() || "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXT_LANG[ext] || "text";
}

export function FileViewerPane({ filePath, theme, font, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchAndHighlight = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setHtml(null);
    setContent(null);

    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setContent(data.content);

      // Dynamically import shiki to keep initial bundle small
      const { codeToHtml } = await import("shiki");
      const lang = getLang(path);
      try {
        const highlighted = await codeToHtml(data.content, {
          lang,
          theme: theme.mode === "light" ? "github-light" : "github-dark",
        });
        setHtml(highlighted);
      } catch {
        // Language not supported by shiki — fall back to plain
        setHtml(null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [theme.mode]);

  useEffect(() => {
    fetchAndHighlight(filePath);
  }, [filePath, fetchAndHighlight]);

  const fileName = filePath.split("/").pop() || filePath;

  // Line count for line number gutter (used for plain text fallback)
  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.background,
        color: theme.foreground,
        fontFamily: font.fontFamily,
        fontSize: 13,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 12px",
          fontSize: 12,
          borderBottom: `1px solid ${theme.foreground}15`,
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ opacity: 0.4, fontSize: 11, flexShrink: 0 }}>FILE</span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            direction: "rtl",
            textAlign: "left",
          }}
          title={filePath}
        >
          {filePath}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: theme.foreground,
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 16,
            opacity: 0.5,
            flexShrink: 0,
            lineHeight: 1,
          }}
          title="Close"
        >
          {"\u00d7"}
        </button>
      </div>

      {/* Body */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto", position: "relative" }}
      >
        {loading && (
          <div style={{ padding: 16, opacity: 0.5 }}>Loading {fileName}...</div>
        )}
        {error && (
          <div style={{ padding: 16, color: theme.red }}>{error}</div>
        )}
        {!loading && !error && html && (
          <div
            dangerouslySetInnerHTML={{ __html: html }}
            style={{
              fontFamily: font.fontFamily,
              fontSize: 13,
              lineHeight: "1.5",
              padding: "8px 0",
              overflow: "auto",
            }}
            className="shiki-viewer"
          />
        )}
        {!loading && !error && !html && content !== null && (
          <div style={{ display: "flex", padding: "8px 0" }}>
            <div
              style={{
                textAlign: "right",
                paddingRight: 12,
                paddingLeft: 12,
                color: `${theme.foreground}40`,
                userSelect: "none",
                flexShrink: 0,
                lineHeight: "1.5",
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre
              style={{
                margin: 0,
                flex: 1,
                lineHeight: "1.5",
                paddingRight: 16,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
