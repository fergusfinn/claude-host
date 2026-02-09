"use client";

import React, { useEffect, useRef, useState, useCallback, useMemo, useReducer } from "react";
import { type TerminalTheme, type TerminalFont } from "@/lib/themes";
import { renderMarkdown, MemoizedMarkdown } from "@/lib/markdown";
import {
  buildRenderItems,
  truncateAtWord,
  getToolSummary,
  formatToolInput,
  getToolIcon,
  type ContentBlock,
  type ContentBlockText,
  type ContentBlockToolUse,
  type ContentBlockToolResult,
  type RenderItem,
} from "@/lib/rich-render";
import styles from "./rich-view.module.css";

export const RICH_FONT_OPTIONS: Record<string, { label: string; fontFamily: string; googleFontsUrl?: string }> = {
  system: { label: "System", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  geist: { label: "Geist", fontFamily: "'Geist', system-ui, sans-serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=Geist:wght@300..900&display=swap" },
  "ibm-plex-sans": { label: "IBM Plex Sans", fontFamily: "'IBM Plex Sans', system-ui, sans-serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" },
  "source-sans": { label: "Source Sans 3", fontFamily: "'Source Sans 3', system-ui, sans-serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" },
};

const _loadedRichFonts = new Set<string>();
export function ensureRichFontLoaded(fontId: string) {
  if (_loadedRichFonts.has(fontId)) return;
  const opt = RICH_FONT_OPTIONS[fontId];
  if (!opt?.googleFontsUrl) return;
  _loadedRichFonts.add(fontId);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = opt.googleFontsUrl;
  document.head.appendChild(link);
}

export function getRichFontFamily(fontId: string): string {
  return RICH_FONT_OPTIONS[fontId]?.fontFamily ?? RICH_FONT_OPTIONS.system.fontFamily;
}

interface Props {
  sessionName: string;
  isActive: boolean;
  theme: TerminalTheme;
  font: TerminalFont;
  richFont?: string;
  onOpenFile?: (filePath: string) => void;
}

interface MessageEvent {
  type: "assistant" | "user";
  message: {
    role: string;
    content: ContentBlock[];
    model?: string;
  };
  session_id?: string;
}

interface ResultEvent {
  type: "result";
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  session_id?: string;
}

interface SystemEvent {
  type: "system";
  subtype?: string;
  [key: string]: any;
}

type ClaudeEvent = MessageEvent | ResultEvent | SystemEvent | { type: string; [key: string]: any };

// ---- Rendered message types ----

interface RenderedMessage {
  id: string;
  role: "assistant" | "user" | "system" | "result";
  blocks: ContentBlock[];
  result?: ResultEvent;
  timestamp: number;
  queued?: boolean;
}

interface RenderPlanEntry {
  msg: RenderedMessage;
  items: RenderItem[] | null; // null = render as-is (system/result), [] = skip (pure tool_result user msg)
}

// ---- Connection state ----

type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

// ---- Error boundary ----

class MessageErrorBoundary extends React.Component<
  { children: React.ReactNode; theme: TerminalTheme },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16,
          color: this.props.theme.red,
          fontSize: 12,
        }}>
          <p>Rendering error: {this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8,
              padding: "4px 12px",
              background: "transparent",
              border: `1px solid ${this.props.theme.red}`,
              color: this.props.theme.red,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---- Component ----

export function RichView({ sessionName, isActive, theme, font, richFont, onOpenFile }: Props) {
  // Ensure the selected rich font is loaded
  useEffect(() => {
    if (richFont) ensureRichFontLoaded(richFont);
  }, [richFont]);
  const [messages, setMessages] = useState<RenderedMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [processAlive, setProcessAlive] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedTools, setCollapsedTools] = useState<Set<string>>(new Set());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  // Subagent child messages keyed by parent tool_use_id
  const [subagentMessages, setSubagentMessages] = useState<Map<string, RenderedMessage[]>>(new Map());
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [wasEmpty, setWasEmpty] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  // Streaming text: ref is source of truth, reducer tick triggers re-renders
  const streamingTextRef = useRef("");
  const streamingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bumpStreamingTick] = useReducer((n: number) => n + 1, 0);

  const msgIdCounter = useRef(0);
  const userScrolledUpRef = useRef(false);
  const isStreamingRef = useRef(false);
  const streamingStartRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  isStreamingRef.current = isStreaming;

  const scrollToBottom = useCallback(() => {
    if (userScrolledUpRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const jumpToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (atBottom) {
      userScrolledUpRef.current = false;
      setShowJumpToBottom(false);
    } else {
      userScrolledUpRef.current = true;
      setShowJumpToBottom(true);
    }
  }, []);

  // Passive scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Scroll to bottom when tab becomes active again
  useEffect(() => {
    if (!isActive) return;
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
    el.scrollTop = el.scrollHeight;
  }, [isActive]);

  // MutationObserver: auto-scroll when DOM content changes (catches rapid updates)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (!userScrolledUpRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const nextId = () => `msg-${++msgIdCounter.current}`;

  // --- Result map: tool_use_id → tool_result ---
  const resultMap = useMemo(() => {
    const map = new Map<string, ContentBlockToolResult>();
    for (const msg of messages) {
      if (msg.role !== "user") continue;
      for (const block of msg.blocks) {
        if (block.type === "tool_result") map.set(block.tool_use_id, block);
      }
    }
    return map;
  }, [messages]);

  // --- Render plan: transform messages into grouped render items ---
  const renderPlan = useMemo((): RenderPlanEntry[] => {
    return messages.map((msg) => {
      if (msg.role === "result" || msg.role === "system") {
        return { msg, items: null };
      }

      if (msg.role === "assistant") {
        const items = buildRenderItems(msg.blocks, resultMap);
        return { msg, items };
      }

      // user messages: keep text blocks, skip pure tool_result messages
      if (msg.role === "user") {
        const textBlocks = msg.blocks.filter((b): b is ContentBlockText => b.type === "text");
        if (textBlocks.length === 0) {
          return { msg, items: [] }; // pure tool_result — skip
        }
        return { msg, items: textBlocks.map((b) => ({ kind: "text" as const, block: b })) };
      }

      return { msg, items: null };
    });
  }, [messages, resultMap]);

  // --- Auto-collapse all tool calls that have completed ---
  // Auto-collapse non-Edit tools immediately on appearance
  useEffect(() => {
    const newCollapsed = new Set(collapsedTools);
    let changed = false;
    for (const entry of renderPlan) {
      if (!entry.items) continue;
      for (const item of entry.items) {
        if (item.kind === "tool_pair" || item.kind === "subagent") {
          if (!newCollapsed.has(item.toolUse.id) && item.toolUse.name !== "Edit") {
            newCollapsed.add(item.toolUse.id);
            changed = true;
          }
        } else if (item.kind === "tool_group") {
          const groupKey = `group-${item.pairs[0].toolUse.id}`;
          if (!newCollapsed.has(groupKey)) {
            newCollapsed.add(groupKey);
            changed = true;
          }
          for (const pair of item.pairs) {
            if (!newCollapsed.has(pair.toolUse.id) && pair.toolUse.name !== "Edit") {
              newCollapsed.add(pair.toolUse.id);
              changed = true;
            }
          }
        }
      }
    }
    if (changed) setCollapsedTools(newCollapsed);
  }, [renderPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Answered questions: derive from message history ---
  const answeredQuestionIds = useMemo(() => {
    const answered = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;
      const askBlocks = msg.blocks.filter(
        (b): b is ContentBlockToolUse => b.type === "tool_use" && b.name === "AskUserQuestion",
      );
      if (askBlocks.length === 0) continue;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "user" && messages[j].blocks.some((b) => b.type === "text")) {
          for (const block of askBlocks) answered.add(block.id);
          break;
        }
      }
    }
    return answered;
  }, [messages]);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    function connect() {
      if (cancelled) return;
      setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${proto}//${location.host}/ws/rich/${encodeURIComponent(sessionName)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { ws!.close(); return; }
        const isReconnect = reconnectAttemptRef.current > 0;
        reconnectAttemptRef.current = 0;
        setConnectionState("connected");
        setError(null);
        if (isReconnect) {
          // Clear state — server replays all events on reconnect
          setMessages([]);
          streamingTextRef.current = "";
          bumpStreamingTick();
        }
      };

      ws.onmessage = (e) => {
        if (cancelled) return;
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }

        if (msg.type === "event") {
          handleEvent(msg.event);
        } else if (msg.type === "turn_complete") {
          setIsStreaming(false);
          streamingStartRef.current = 0;
          lastInterruptRef.current = 0;
        } else if (msg.type === "session_state") {
          if (msg.streaming) {
            setIsStreaming(true);
            if (!streamingStartRef.current) streamingStartRef.current = Date.now();
          }
          if (msg.process_alive !== undefined) setProcessAlive(msg.process_alive);
        } else if (msg.type === "error") {
          setError(msg.message);
          setIsStreaming(false);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnectionState("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose
      };
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
      setConnectionState("reconnecting");
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (ws) {
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
      if (streamingFlushRef.current) {
        clearTimeout(streamingFlushRef.current);
        streamingFlushRef.current = null;
      }
    };
  }, [sessionName]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleEvent(event: ClaudeEvent) {
    // Route subagent internal events into the subagentMessages map
    const parentId = (event as any).parent_tool_use_id as string | undefined;
    if (parentId != null) {
      if (event.type === "assistant" || event.type === "user") {
        const msg = event as MessageEvent;
        setSubagentMessages((prev) => {
          const next = new Map(prev);
          const existing = next.get(parentId) || [];
          next.set(parentId, [
            ...existing,
            { id: `sub-${parentId}-${existing.length}`, role: msg.type, blocks: msg.message.content, timestamp: Date.now() },
          ]);
          return next;
        });
        scrollToBottom();
      }
      return;
    }

    if (event.type === "stream_event") {
      const inner = (event as any).event;
      if (!inner) return;

      if (inner.type === "content_block_delta" && inner.delta?.type === "text_delta") {
        streamingTextRef.current += inner.delta.text;
        // Throttle React updates — batch deltas into ~100ms intervals
        if (!streamingFlushRef.current) {
          streamingFlushRef.current = setTimeout(() => {
            streamingFlushRef.current = null;
            bumpStreamingTick();
            scrollToBottom();
          }, 100);
        }
      }
      return;
    }

    if (event.type === "assistant") {
      // Complete assistant message — flush streaming and use final content
      if (streamingFlushRef.current) {
        clearTimeout(streamingFlushRef.current);
        streamingFlushRef.current = null;
      }
      streamingTextRef.current = "";
      bumpStreamingTick();
      const msg = event as MessageEvent;
      const blocks = msg.message.content;
      const isToolOnly = blocks.length > 0 && blocks.every((b) => b.type === "tool_use");

      setMessages((prev) => {
        if (isToolOnly) {
          let mergeIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (m.role === "assistant" && m.blocks.every((b) => b.type === "tool_use")) {
              mergeIdx = i;
              break;
            }
            if (m.role === "user" && m.blocks.every((b) => b.type === "tool_result")) continue;
            break;
          }

          if (mergeIdx >= 0) {
            const target = prev[mergeIdx];
            const existingIds = new Set(
              target.blocks
                .filter((b): b is ContentBlockToolUse => b.type === "tool_use")
                .map((b) => b.id)
            );
            const newBlocks = blocks.filter(
              (b) => b.type === "tool_use" && !existingIds.has((b as ContentBlockToolUse).id)
            );
            if (newBlocks.length > 0) {
              const updated = [...prev];
              updated[mergeIdx] = { ...target, blocks: [...target.blocks, ...newBlocks] };
              return updated;
            }
            return prev;
          }
        }

        // Check if this message supersedes the last assistant message
        // (e.g. text-only message followed by text+tool_use with same text)
        if (!isToolOnly && prev.length > 0) {
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (last.role === "assistant") {
            const lastTexts = last.blocks.filter((b) => b.type === "text");
            const newTexts = blocks.filter((b) => b.type === "text");
            const lastHasTools = last.blocks.some((b) => b.type === "tool_use");
            const newHasTools = blocks.some((b) => b.type === "tool_use");
            // Replace if: previous was text-only, new has same text + tools
            if (!lastHasTools && newHasTools && lastTexts.length === newTexts.length &&
                lastTexts.every((lt, i) => lt.type === "text" && newTexts[i].type === "text" &&
                  (lt as ContentBlockText).text === (newTexts[i] as ContentBlockText).text)) {
              const updated = [...prev];
              updated[lastIdx] = { ...last, blocks };
              return updated;
            }
          }
        }

        return [
          ...prev,
          { id: nextId(), role: "assistant" as const, blocks, timestamp: Date.now() },
        ];
      });
      scrollToBottom();
    } else if (event.type === "user") {
      streamingTextRef.current = "";
      bumpStreamingTick();
      const msg = event as MessageEvent;
      const queued = !!(event as any).queued;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          blocks: msg.message.content,
          timestamp: Date.now(),
          queued,
        },
      ]);
      scrollToBottom();
    } else if (event.type === "result") {
      streamingTextRef.current = "";
      bumpStreamingTick();
      const result = event as ResultEvent;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "result",
          blocks: [],
          result,
          timestamp: Date.now(),
        },
      ]);
      scrollToBottom();
    } else if (event.type === "system") {
      const sys = event as SystemEvent;
      if (sys.subtype === "init") {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "system",
            blocks: [{ type: "text", text: `Session initialized` }],
            timestamp: Date.now(),
          },
        ]);
      } else if (sys.subtype === "restart") {
        setIsStreaming(false);
        streamingStartRef.current = 0;
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "system",
            blocks: [{ type: "text", text: (sys as any).message || "Claude process restarted" }],
            timestamp: Date.now(),
          },
        ]);
      }
    }
  }

  function sendPrompt(text: string) {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setIsStreaming(true);
    setError(null);
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);

    wsRef.current.send(JSON.stringify({ type: "prompt", text }));
    setInputValue("");

    // Reset contenteditable
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.textContent = "";
        inputRef.current.style.height = "";
      }
    });

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  const lastInterruptRef = useRef(0);
  function sendInterrupt() {
    const now = Date.now();
    if (now - lastInterruptRef.current < 2000) return;
    lastInterruptRef.current = now;
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  function sendRestart() {
    wsRef.current?.send(JSON.stringify({ type: "restart" }));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt(inputValue);
    }
    if (e.key === "Escape" && isStreaming) {
      e.preventDefault();
      sendInterrupt();
    }
  }

  function autoResize(el: HTMLElement) {
    el.style.height = "0";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    // Scroll conversation to bottom as input grows, so it pushes content up visually
    scrollToBottom();
  }

  function toggleTool(id: string) {
    setCollapsedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleResultExpanded(id: string) {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Auto-focus input when active (skip on touch devices to avoid
  // opening the virtual keyboard on tab switch)
  useEffect(() => {
    if (isActive && !isStreaming && !matchMedia("(pointer: coarse)").matches) {
      inputRef.current?.focus();
    }
  }, [isActive, isStreaming]);

  const connected = connectionState === "connected";
  const streamingText = streamingTextRef.current;

  const isEmpty = messages.length === 0 && !isStreaming;

  // Track transition from empty → non-empty for animation
  const justTransitioned = !isEmpty && wasEmpty;
  useEffect(() => {
    if (!isEmpty && wasEmpty) {
      // Clear after animation completes
      const t = setTimeout(() => setWasEmpty(false), 400);
      return () => clearTimeout(t);
    }
    if (isEmpty) setWasEmpty(true);
  }, [isEmpty, wasEmpty]);

  return (
    <div
      className={`${styles.root} ${isEmpty ? styles.rootEmpty : ""}`}
      style={{
        background: theme.background,
        color: theme.foreground,
        fontFamily: getRichFontFamily(richFont || "system"),
      }}
    >
      {/* Status bar */}
      {!isEmpty && (
        <div className={styles.statusBar}>
          <div className={styles.statusLeft}>
            <span
              className={`${styles.statusDot} ${
                connectionState === "connected" && processAlive !== false
                  ? styles.statusConnected
                  : connectionState === "reconnecting"
                    ? styles.statusReconnecting
                    : ""
              }`}
            />
            <span className={styles.statusText}>
              {connectionState === "connected"
                ? processAlive === false
                  ? "Process exited"
                  : "Connected"
                : connectionState === "connecting"
                  ? "Connecting…"
                  : connectionState === "reconnecting"
                    ? "Reconnecting…"
                    : "Disconnected"}
            </span>
            {connectionState === "connected" && processAlive === false && (
              <button
                className={styles.restartBtn}
                onClick={sendRestart}
                style={{ color: theme.cursor }}
              >
                Restart
              </button>
            )}
          </div>
          {error && <span className={styles.statusError}>{error}</span>}
        </div>
      )}

      {/* Messages */}
      <div className={styles.messagesWrap}>
        <div className={styles.messages} ref={scrollRef}>
          <div className={styles.messagesInner}>
          <MessageErrorBoundary theme={theme}>
            {messages.length === 0 && !isStreaming && (
              <div className={styles.welcome}>
                <div className={styles.welcomeIcon}>
                  <div className={styles.welcomeMark} style={{ background: theme.cursor }} />
                </div>
                <div className={styles.welcomeText}>
                  <p className={styles.welcomeTitle} style={{ color: theme.foreground }}>{sessionName}</p>
                  <p className={styles.welcomeHint}>
                    Type a message to start a conversation
                  </p>
                </div>
                <div className={styles.welcomeShortcuts}>
                  <span><kbd className={styles.kbd} style={{ background: `${theme.foreground}08`, borderColor: `${theme.foreground}15` }}>Enter</kbd> send</span>
                  <span><kbd className={styles.kbd} style={{ background: `${theme.foreground}08`, borderColor: `${theme.foreground}15` }}>Shift+Enter</kbd> newline</span>
                  <span><kbd className={styles.kbd} style={{ background: `${theme.foreground}08`, borderColor: `${theme.foreground}15` }}>Esc</kbd> interrupt</span>
                </div>
              </div>
            )}

            {renderPlan.map(({ msg, items }) => {
              // Skip pure tool_result user messages
              if (items !== null && items.length === 0) return null;

              // System/result: render as before
              if (items === null) {
                if (msg.role === "result") {
                  const r = msg.result;
                  const secs = r?.duration_ms ? Math.round(r.duration_ms / 1000) : null;
                  const turns = r?.num_turns && r.num_turns > 1 ? `${r.num_turns} turns` : null;
                  const parts = [secs !== null ? `${secs}s` : null, turns].filter(Boolean);
                  return (
                    <div key={msg.id} className={`${styles.message} ${styles.role_system} ${styles.messageEnter}`}>
                      Turn complete{parts.length > 0 ? ` \u2014 ${parts.join(", ")}` : ""}
                    </div>
                  );
                }
                if (msg.role === "system") {
                  return (
                    <div key={msg.id} className={`${styles.message} ${styles.role_system} ${styles.messageEnter}`}>
                      {msg.blocks.map((block, i) =>
                        block.type === "text" ? (
                          <TextBlock key={`${msg.id}-${i}`} text={block.text} theme={theme} />
                        ) : null
                      )}
                    </div>
                  );
                }
                return null;
              }

              // User text messages
              if (msg.role === "user") {
                return (
                  <div
                    key={msg.id}
                    className={`${styles.message} ${styles.role_user} ${styles.messageEnter}`}
                    style={{ borderLeft: `2px solid ${theme.foreground}20` }}
                  >
                    <div className={styles.userLabel} style={{ color: `${theme.foreground}40` }}>
                      you
                      {msg.queued && (
                        <span className={styles.queuedBadge} style={{ color: theme.yellow }}>
                          queued
                        </span>
                      )}
                    </div>
                    {items.map((item, i) =>
                      item.kind === "text" ? (
                        <TextBlock key={`${msg.id}-${i}`} text={item.block.text} theme={theme} />
                      ) : null
                    )}
                  </div>
                );
              }

              // Assistant messages with render items
              return (
                <div
                  key={msg.id}
                  className={`${styles.message} ${styles.role_assistant} ${styles.messageEnter}`}
                >
                  {items.map((item, i) => {
                    const key = `${msg.id}-${i}`;
                    switch (item.kind) {
                      case "text":
                        return <TextBlock key={key} text={item.block.text} theme={theme} />;
                      case "tool_pair":
                        return (
                          <ToolPairBlock
                            key={key}
                            toolUse={item.toolUse}
                            toolResult={item.toolResult}
                            theme={theme}
                            collapsed={collapsedTools.has(item.toolUse.id)}
                            onToggle={() => toggleTool(item.toolUse.id)}
                            resultExpanded={expandedResults.has(item.toolUse.id)}
                            onToggleResult={() => toggleResultExpanded(item.toolUse.id)}
                            onOpenFile={onOpenFile}
                          />
                        );
                      case "tool_group":
                        return (
                          <ToolGroupBlock
                            key={key}
                            name={item.name}
                            pairs={item.pairs}
                            theme={theme}
                            collapsedTools={collapsedTools}
                            onToggle={toggleTool}
                            expandedResults={expandedResults}
                            onToggleResult={toggleResultExpanded}
                            onOpenFile={onOpenFile}
                          />
                        );
                      case "subagent":
                        return (
                          <SubagentBlock
                            key={key}
                            toolUse={item.toolUse}
                            toolResult={item.toolResult}
                            theme={theme}
                            collapsed={collapsedTools.has(item.toolUse.id)}
                            onToggle={() => toggleTool(item.toolUse.id)}
                            resultExpanded={expandedResults.has(item.toolUse.id)}
                            onToggleResult={() => toggleResultExpanded(item.toolUse.id)}
                            childMessages={subagentMessages.get(item.toolUse.id)}
                            onOpenFile={onOpenFile}
                          />
                        );
                      case "question":
                        return (
                          <QuestionBlock
                            key={key}
                            toolUse={item.toolUse}
                            toolResult={item.toolResult}
                            theme={theme}
                            answered={answeredQuestionIds.has(item.toolUse.id)}
                            onAnswer={sendPrompt}
                          />
                        );
                      default:
                        return null;
                    }
                  })}
                </div>
              );
            })}

            {isStreaming && (
              streamingText ? (
                <div
                  className={`${styles.message} ${styles.role_assistant}`}
                >
                  <StreamingMarkdown text={streamingText} theme={theme} />
                </div>
              ) : (
                <ThinkingIndicator startTime={streamingStartRef.current} theme={theme} />
              )
            )}
          </MessageErrorBoundary>
          </div>
        </div>

        {showJumpToBottom && (
          <button
            className={styles.jumpToBottom}
            onClick={jumpToBottom}
            style={{
              background: theme.background,
              color: theme.foreground,
              borderColor: `${theme.foreground}30`,
            }}
          >
            {"\u2193"} Jump to bottom
          </button>
        )}
      </div>

      {/* Input */}
      <div className={`${styles.inputArea} ${justTransitioned ? styles.inputSettling : ""}`}>
        <div className={styles.inputInner}>
        <div
          ref={inputRef}
          className={styles.input}
          contentEditable={connected}
          role="textbox"
          data-placeholder={isStreaming ? "Type to queue a follow-up\u2026" : "Type a message\u2026"}
          onInput={(e) => {
            const text = e.currentTarget.textContent || "";
            setInputValue(text);
            autoResize(e.currentTarget);
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          style={{
            color: theme.foreground,
          }}
        />
        {isStreaming && (
          <button
            className={styles.stopBtn}
            onClick={sendInterrupt}
            style={{
              background: theme.red,
              color: theme.background,
            }}
            title="Stop (Esc)"
          >
            {"\u25A0"}
          </button>
        )}
        <button
          className={styles.sendBtn}
          onClick={() => sendPrompt(inputValue)}
          disabled={!connected || !inputValue.trim()}
          style={{
            background: inputValue.trim() ? theme.cursor : "transparent",
            color: inputValue.trim() ? theme.background : theme.foreground,
          }}
        >
          {"\u21B5"}
        </button>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function ThinkingIndicator({ startTime, theme }: { startTime: number; theme: TerminalTheme }) {
  const effectiveStart = startTime || Date.now();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - effectiveStart) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveStart]);

  return (
    <div className={styles.streaming}>
      <span className={styles.streamingDot} style={{ background: theme.cursor }} />
      <span>
        {"thinking…"}
        {elapsed >= 3 && (
          <span style={{ marginLeft: 6, opacity: 0.5 }}>{elapsed}s</span>
        )}
      </span>
    </div>
  );
}

function StreamingMarkdown({ text, theme }: { text: string; theme: TerminalTheme }) {
  const [renderedText, setRenderedText] = useState(text);
  const lastRenderTime = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Safety valve: fall back to raw text for very long streaming content
    if (text.length > 50000) {
      setRenderedText(text);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastRenderTime.current;

    if (elapsed >= 200) {
      setRenderedText(text);
      lastRenderTime.current = now;
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    } else if (!pendingRef.current) {
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        setRenderedText(text);
        lastRenderTime.current = Date.now();
      }, 200 - elapsed);
    }

    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, [text]);

  if (text.length > 50000) {
    return (
      <div className={styles.textBlock}>
        <pre className={styles.streamingPre}>{text}</pre>
        <span className={styles.streamingCursor} style={{ background: theme.cursor }} />
      </div>
    );
  }

  return (
    <div className={styles.textBlock}>
      {renderMarkdown(renderedText, theme)}
      <span className={styles.streamingCursor} style={{ background: theme.cursor }} />
    </div>
  );
}

function TextBlock({ text, theme }: { text: string; theme: TerminalTheme }) {
  return (
    <div className={styles.textBlock}>
      <MemoizedMarkdown text={text} theme={theme} />
    </div>
  );
}

function ToolPairBlock({
  toolUse,
  toolResult,
  theme,
  collapsed,
  onToggle,
  compact,
  resultExpanded,
  onToggleResult,
  onOpenFile,
}: {
  toolUse: ContentBlockToolUse;
  toolResult: ContentBlockToolResult | null;
  theme: TerminalTheme;
  collapsed: boolean;
  onToggle: () => void;
  compact?: boolean;
  resultExpanded?: boolean;
  onToggleResult?: () => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const toolColor = getToolColor(toolUse.name, theme);
  const isEditTool = toolUse.name === "Edit" && toolUse.input.old_string != null;

  const resultContent = toolResult
    ? typeof toolResult.content === "string"
      ? toolResult.content
      : toolResult.content.map((c) => c.text || "").join("\n")
    : null;

  const resultLines = resultContent ? resultContent.split("\n") : [];
  const isResultLong = resultLines.length > 20;
  const isExpanded = resultExpanded || !isResultLong;
  const displayResult = resultContent
    ? isExpanded
      ? resultContent
      : resultLines.slice(0, 12).join("\n") + "\n…"
    : null;

  // Done hint for collapsed state
  const doneHint = collapsed && toolResult
    ? toolResult.is_error
      ? "error"
      : resultLines.length > 1
        ? `${resultLines.length} lines`
        : "\u2713"
    : null;

  return (
    <div
      className={`${styles.toolPair} ${compact ? styles.toolPairCompact : ""}`}
      style={{ background: `${toolColor}08` }}
    >
      <button className={styles.toolHeader} onClick={onToggle} style={{ color: toolColor }}>
        <span className={styles.toolChevron}>{collapsed ? "\u25B8" : "\u25BE"}</span>
        <span className={styles.toolIcon}>{getToolIcon(toolUse.name)}</span>
        <span className={styles.toolName}>{toolUse.name}</span>
        {onOpenFile && toolUse.input.file_path && ["Read", "Edit", "Write"].includes(toolUse.name) ? (
          <span
            className={`${styles.toolSummary} ${styles.toolSummaryClickable}`}
            style={{ color: `${theme.foreground}80` }}
            onClick={(e) => { e.stopPropagation(); onOpenFile(toolUse.input.file_path as string); }}
            title={`Open ${toolUse.input.file_path}`}
          >
            {getToolSummary(toolUse.name, toolUse.input)}
          </span>
        ) : (
          <span className={styles.toolSummary} style={{ color: `${theme.foreground}80` }}>
            {getToolSummary(toolUse.name, toolUse.input)}
          </span>
        )}
        {collapsed && toolResult === null && (
          <span className={styles.toolPending}>
            <span className={styles.toolPendingDot} style={{ background: toolColor }} />
          </span>
        )}
        {doneHint && (
          <span className={styles.toolDoneHint} style={{ color: `${theme.foreground}50` }}>
            {doneHint}
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          {isEditTool ? (
            <DiffView
              filePath={toolUse.input.file_path as string}
              oldStr={toolUse.input.old_string as string}
              newStr={(toolUse.input.new_string as string) || ""}
              theme={theme}
              onOpenFile={onOpenFile}
            />
          ) : (
            <pre
              className={styles.toolInput}
              style={{ background: `${toolColor}08`, color: `${theme.foreground}cc` }}
            >
              {formatToolInput(toolUse.name, toolUse.input)}
            </pre>
          )}

          {/* Inline result */}
          {toolResult === null ? (
            <div className={styles.toolPairRunning} style={{ color: toolColor }}>
              <span className={styles.toolPendingDot} style={{ background: toolColor }} />
              <span>{"running…"}</span>
            </div>
          ) : resultContent && resultContent.trim() ? (
            <div className={styles.toolPairResult}>
              <pre
                className={`${styles.toolResultContent} ${toolResult.is_error ? styles.toolResultError : ""}`}
                style={{
                  background: toolResult.is_error ? `${theme.red}10` : `${theme.foreground}05`,
                  color: toolResult.is_error ? theme.red : `${theme.foreground}90`,
                  borderColor: toolResult.is_error ? `${theme.red}25` : `${theme.foreground}10`,
                }}
              >
                {displayResult}
              </pre>
              {isResultLong && onToggleResult && (
                <button
                  className={styles.expandBtn}
                  onClick={onToggleResult}
                  style={{ color: theme.cyan }}
                >
                  {isExpanded ? "show less" : `show all (${resultLines.length} lines)`}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DiffView({
  filePath,
  oldStr,
  newStr,
  theme,
  onOpenFile,
}: {
  filePath: string;
  oldStr: string;
  newStr: string;
  theme: TerminalTheme;
  onOpenFile?: (filePath: string) => void;
}) {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Find common prefix and suffix
  let prefixLen = 0;
  while (prefixLen < oldLines.length && prefixLen < newLines.length
         && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (suffixLen < oldLines.length - prefixLen
         && suffixLen < newLines.length - prefixLen
         && oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]) {
    suffixLen++;
  }

  const removedLines = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const addedLines = newLines.slice(prefixLen, newLines.length - suffixLen);
  const contextBefore = oldLines.slice(Math.max(0, prefixLen - 2), prefixLen);
  const contextAfter = oldLines.slice(
    oldLines.length - suffixLen,
    Math.min(oldLines.length, oldLines.length - suffixLen + 2)
  );

  return (
    <div className={styles.diffView}>
      <div
        className={`${styles.diffFilePath} ${onOpenFile ? styles.toolSummaryClickable : ""}`}
        style={{ color: `${theme.foreground}60`, cursor: onOpenFile ? "pointer" : undefined }}
        onClick={onOpenFile ? () => onOpenFile(filePath) : undefined}
        title={onOpenFile ? `Open ${filePath}` : undefined}
      >
        {filePath}
      </div>
      <pre className={styles.diffContent}>
        {contextBefore.map((line, i) => (
          <div key={`ctx-b-${i}`} className={styles.diffContext} style={{ color: `${theme.foreground}50` }}>
            {`  ${line}`}
          </div>
        ))}
        {removedLines.map((line, i) => (
          <div key={`rem-${i}`} className={styles.diffRemoved} style={{ background: `${theme.red}15`, color: theme.red }}>
            {`- ${line}`}
          </div>
        ))}
        {addedLines.map((line, i) => (
          <div key={`add-${i}`} className={styles.diffAdded} style={{ background: `${theme.green}15`, color: theme.green }}>
            {`+ ${line}`}
          </div>
        ))}
        {contextAfter.map((line, i) => (
          <div key={`ctx-a-${i}`} className={styles.diffContext} style={{ color: `${theme.foreground}50` }}>
            {`  ${line}`}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ToolGroupBlock({
  name,
  pairs,
  theme,
  collapsedTools,
  onToggle,
  expandedResults,
  onToggleResult,
  onOpenFile,
}: {
  name: string;
  pairs: Array<{ toolUse: ContentBlockToolUse; toolResult: ContentBlockToolResult | null }>;
  theme: TerminalTheme;
  collapsedTools: Set<string>;
  onToggle: (id: string) => void;
  expandedResults: Set<string>;
  onToggleResult: (id: string) => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const toolColor = getToolColor(name, theme);
  const groupKey = `group-${pairs[0].toolUse.id}`;
  const doneCount = pairs.filter((p) => p.toolResult !== null).length;
  const allDone = doneCount === pairs.length;
  const isCollapsed = collapsedTools.has(groupKey);

  return (
    <div className={styles.toolGroup} style={{ background: `${toolColor}08` }}>
      <button
        className={styles.toolGroupHeader}
        onClick={() => onToggle(groupKey)}
        style={{ color: toolColor }}
      >
        <span className={styles.toolChevron}>{isCollapsed ? "\u25B8" : "\u25BE"}</span>
        <span className={styles.toolIcon}>{getToolIcon(name)}</span>
        <span className={styles.toolName}>{name}</span>
        <span className={styles.toolGroupCount} style={{ color: `${theme.foreground}60` }}>
          {allDone ? `(${pairs.length})` : `(${doneCount}/${pairs.length})`}
        </span>
        {!allDone && (
          <span className={styles.toolPending}>
            <span className={styles.toolPendingDot} style={{ background: toolColor }} />
          </span>
        )}
      </button>

      {!isCollapsed && (
        <div className={styles.toolGroupItems}>
          {pairs.map((pair) => (
            <ToolPairBlock
              key={pair.toolUse.id}
              toolUse={pair.toolUse}
              toolResult={pair.toolResult}
              theme={theme}
              collapsed={collapsedTools.has(pair.toolUse.id)}
              onToggle={() => onToggle(pair.toolUse.id)}
              resultExpanded={expandedResults.has(pair.toolUse.id)}
              onToggleResult={() => onToggleResult(pair.toolUse.id)}
              onOpenFile={onOpenFile}
              compact
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubagentBlock({
  toolUse,
  toolResult,
  theme,
  collapsed,
  onToggle,
  resultExpanded,
  onToggleResult,
  childMessages,
  onOpenFile,
}: {
  toolUse: ContentBlockToolUse;
  toolResult: ContentBlockToolResult | null;
  theme: TerminalTheme;
  collapsed: boolean;
  onToggle: () => void;
  resultExpanded?: boolean;
  onToggleResult?: () => void;
  childMessages?: RenderedMessage[];
  onOpenFile?: (filePath: string) => void;
}) {
  const agentColor = theme.mode === "light" ? theme.magenta : theme.brightMagenta;
  const subagentType = toolUse.input.subagent_type as string | undefined;
  const description = toolUse.input.description as string | undefined;

  const resultContent = toolResult
    ? typeof toolResult.content === "string"
      ? toolResult.content
      : toolResult.content.map((c) => c.text || "").join("\n")
    : null;

  const resultLines = resultContent ? resultContent.split("\n") : [];
  const isResultLong = resultLines.length > 20;
  const isExpanded = resultExpanded || !isResultLong;
  const displayResult = resultContent
    ? isExpanded
      ? resultContent
      : resultLines.slice(0, 12).join("\n") + "\n…"
    : null;

  // Build result map and render items for child messages
  const childResultMap = useMemo(() => {
    const map = new Map<string, ContentBlockToolResult>();
    if (!childMessages) return map;
    for (const msg of childMessages) {
      if (msg.role !== "user") continue;
      for (const block of msg.blocks) {
        if (block.type === "tool_result") map.set(block.tool_use_id, block);
      }
    }
    return map;
  }, [childMessages]);

  const childRenderItems = useMemo(() => {
    if (!childMessages) return [];
    return childMessages
      .filter((msg) => msg.role === "assistant")
      .map((msg) => ({
        msg,
        items: buildRenderItems(msg.blocks, childResultMap),
      }));
  }, [childMessages, childResultMap]);

  // All tool calls in nested view are collapsed by default
  const [nestedCollapsed, setNestedCollapsed] = useState<Set<string>>(new Set());
  const [nestedExpandedResults, setNestedExpandedResults] = useState<Set<string>>(new Set());

  // Auto-collapse nested tool calls
  useEffect(() => {
    const newCollapsed = new Set(nestedCollapsed);
    let changed = false;
    for (const { items } of childRenderItems) {
      for (const item of items) {
        if (item.kind === "tool_pair" || item.kind === "subagent") {
          if (!newCollapsed.has(item.toolUse.id)) {
            newCollapsed.add(item.toolUse.id);
            changed = true;
          }
        } else if (item.kind === "tool_group") {
          const groupKey = `group-${item.pairs[0].toolUse.id}`;
          if (!newCollapsed.has(groupKey)) {
            newCollapsed.add(groupKey);
            changed = true;
          }
          for (const pair of item.pairs) {
            if (!newCollapsed.has(pair.toolUse.id)) {
              newCollapsed.add(pair.toolUse.id);
              changed = true;
            }
          }
        }
      }
    }
    if (changed) setNestedCollapsed(newCollapsed);
  }, [childRenderItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNestedTool = (id: string) => {
    setNestedCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNestedResult = (id: string) => {
    setNestedExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasChildContent = childRenderItems.some(({ items }) => items.length > 0);

  return (
    <div
      className={styles.subagent}
      style={{
        background: `${agentColor}0d`,
      }}
    >
      <button className={styles.subagentHeader} onClick={onToggle} style={{ color: agentColor }}>
        <span className={styles.toolChevron}>{collapsed ? "\u25B8" : "\u25BE"}</span>
        <span className={styles.toolIcon}>{"\u229E"}</span>
        <span className={styles.toolName}>Task</span>
        {subagentType && (
          <span className={styles.subagentBadge} style={{ background: `${agentColor}25`, color: agentColor }}>
            {subagentType}
          </span>
        )}
        {collapsed && toolResult === null && (
          <span className={styles.subagentWorking}>
            <span className={styles.subagentDots} style={{ color: agentColor }}>
              <span>.</span><span>.</span><span>.</span>
            </span>
          </span>
        )}
        {collapsed && toolResult !== null && (
          <span className={styles.toolDoneHint} style={{ color: `${theme.foreground}50` }}>{"\u2713"}</span>
        )}
      </button>

      {!collapsed && (
        <div className={styles.subagentBody}>
          {description && (
            <div className={styles.subagentDescription}>
              <MemoizedMarkdown text={description} theme={theme} />
            </div>
          )}

          {/* Nested subagent content */}
          {hasChildContent && (
            <div className={styles.subagentContent} style={{ borderColor: `${agentColor}30` }}>
              {childRenderItems.map(({ msg, items }) => {
                if (items.length === 0) return null;
                return (
                  <div key={msg.id}>
                    {items.map((item, i) => {
                      const key = `${msg.id}-${i}`;
                      switch (item.kind) {
                        case "text":
                          return (
                            <div key={key} className={styles.subagentText}>
                              <MemoizedMarkdown text={item.block.text} theme={theme} />
                            </div>
                          );
                        case "tool_pair":
                          return (
                            <ToolPairBlock
                              key={key}
                              toolUse={item.toolUse}
                              toolResult={item.toolResult}
                              theme={theme}
                              collapsed={nestedCollapsed.has(item.toolUse.id)}
                              onToggle={() => toggleNestedTool(item.toolUse.id)}
                              resultExpanded={nestedExpandedResults.has(item.toolUse.id)}
                              onToggleResult={() => toggleNestedResult(item.toolUse.id)}
                              onOpenFile={onOpenFile}
                              compact
                            />
                          );
                        case "tool_group":
                          return (
                            <ToolGroupBlock
                              key={key}
                              name={item.name}
                              pairs={item.pairs}
                              theme={theme}
                              collapsedTools={nestedCollapsed}
                              onToggle={toggleNestedTool}
                              expandedResults={nestedExpandedResults}
                              onToggleResult={toggleNestedResult}
                              onOpenFile={onOpenFile}
                            />
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                );
              })}
              {toolResult === null && (
                <div className={styles.subagentWorkingInline} style={{ color: agentColor }}>
                  <span className={styles.subagentDots}>
                    <span>.</span><span>.</span><span>.</span>
                  </span>
                  <span>agent working</span>
                </div>
              )}
            </div>
          )}

          {/* Fallback: no child content yet */}
          {!hasChildContent && toolResult === null && (
            <div className={styles.subagentWorkingInline} style={{ color: agentColor }}>
              <span className={styles.subagentDots}>
                <span>.</span><span>.</span><span>.</span>
              </span>
              <span>agent working</span>
            </div>
          )}

          {/* Final result */}
          {resultContent && resultContent.trim() ? (
            <div className={styles.toolPairResult}>
              <pre
                className={`${styles.toolResultContent} ${toolResult!.is_error ? styles.toolResultError : ""}`}
                style={{
                  background: toolResult!.is_error ? `${theme.red}10` : `${theme.foreground}05`,
                  color: toolResult!.is_error ? theme.red : `${theme.foreground}90`,
                  borderColor: toolResult!.is_error ? `${theme.red}25` : `${theme.foreground}10`,
                }}
              >
                {displayResult}
              </pre>
              {isResultLong && onToggleResult && (
                <button
                  className={styles.expandBtn}
                  onClick={onToggleResult}
                  style={{ color: theme.cyan }}
                >
                  {isExpanded ? "show less" : `show all (${resultLines.length} lines)`}
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function QuestionBlock({
  toolUse,
  toolResult,
  theme,
  answered,
  onAnswer,
}: {
  toolUse: ContentBlockToolUse;
  toolResult: ContentBlockToolResult | null;
  theme: TerminalTheme;
  answered: boolean;
  onAnswer: (text: string) => void;
}) {
  const questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect: boolean;
  }> = toolUse.input.questions || [];

  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map());

  // Interactive if the tool was auto-denied and user hasn't answered yet
  const isInteractive = !answered && !!toolResult?.is_error;

  const toggleOption = (qIdx: number, oIdx: number, multiSelect: boolean) => {
    if (!isInteractive) return;
    setSelections((prev) => {
      const next = new Map(prev);
      if (multiSelect) {
        const current = new Set(next.get(qIdx) || []);
        if (current.has(oIdx)) current.delete(oIdx);
        else current.add(oIdx);
        next.set(qIdx, current);
      } else {
        next.set(qIdx, new Set([oIdx]));
      }
      return next;
    });
  };

  const allAnswered = questions.every((_, i) => {
    const sel = selections.get(i);
    return sel && sel.size > 0;
  });

  const handleSubmit = () => {
    const lines: string[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sel = selections.get(i) || new Set();
      const selected = [...sel].map((idx) => q.options[idx]?.label).filter(Boolean);
      lines.push(`- ${q.header}: ${selected.join(", ")}`);
    }
    onAnswer(`Here are my answers:\n${lines.join("\n")}`);
  };

  return (
    <div className={styles.questionBlock} style={{ background: `${theme.green}0a` }}>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className={styles.questionItem}>
          <div className={styles.questionHeader}>
            <span
              className={styles.questionBadge}
              style={{ background: `${theme.green}20`, color: theme.green }}
            >
              {q.header}
            </span>
            <span style={{ color: theme.foreground }}>{q.question}</span>
          </div>
          <div className={styles.questionOptions}>
            {q.options.map((opt, oIdx) => {
              const selected = selections.get(qIdx)?.has(oIdx) || false;
              return (
                <button
                  key={oIdx}
                  className={`${styles.questionOption} ${selected ? styles.questionOptionSelected : ""}`}
                  onClick={() => toggleOption(qIdx, oIdx, q.multiSelect)}
                  disabled={!isInteractive}
                  style={{
                    borderColor: selected ? theme.green : `${theme.foreground}20`,
                    background: selected ? `${theme.green}15` : "transparent",
                    color: theme.foreground,
                  }}
                >
                  <span className={styles.questionOptionLabel}>{opt.label}</span>
                  {opt.description && (
                    <span
                      className={styles.questionOptionDesc}
                      style={{ color: `${theme.foreground}60` }}
                    >
                      {opt.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {isInteractive && (
        <button
          className={styles.questionSubmit}
          onClick={handleSubmit}
          disabled={!allAnswered}
          style={{
            background: allAnswered ? theme.green : "transparent",
            color: allAnswered ? theme.background : `${theme.foreground}40`,
            borderColor: allAnswered ? theme.green : `${theme.foreground}20`,
          }}
        >
          Send answers
        </button>
      )}
      {answered && (
        <div className={styles.questionAnswered} style={{ color: `${theme.foreground}50` }}>
          {"\u2713"} answered
        </div>
      )}
    </div>
  );
}

// ---- Helpers (component-local) ----

function getToolColor(name: string, theme: TerminalTheme): string {
  // For light themes, use standard (darker) ANSI colors; for dark themes, bright variants are fine
  const isLight = theme.mode === "light";
  const map: Record<string, keyof TerminalTheme> = {
    Read: "blue",
    Edit: "yellow",
    Write: "green",
    Bash: "red",
    Glob: "cyan",
    Grep: "magenta",
    Task: isLight ? "magenta" : "brightMagenta",
    WebFetch: isLight ? "cyan" : "brightCyan",
    WebSearch: isLight ? "cyan" : "brightCyan",
  };
  const key = map[name];
  return key ? (theme[key] as string) : theme.cyan;
}
