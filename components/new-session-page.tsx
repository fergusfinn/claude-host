"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowUp, Sparkles, GitFork, ChevronDown, Terminal, Play } from "lucide-react";
import type { TerminalTheme } from "@/lib/themes";
import { getRichFontFamily, ensureRichFontLoaded } from "./rich-view";
import { activityAgo } from "@/lib/ui-utils";
import styles from "./new-session-page.module.css";
import type { Session, ExecutorInfo } from "@/shared/types";
import { DEFAULT_COMMAND } from "@/shared/constants";

type SessionMode = "rich" | "terminal" | "custom";

type SessionMode = "rich" | "terminal" | "custom";

interface Props {
  theme: TerminalTheme;
  richFont?: string;
  onSessionCreated: (name: string, mode: "rich" | "terminal", initialPrompt: string) => void;
  onCancel: () => void;
}

export function NewSessionPage({ theme, richFont, onSessionCreated, onCancel }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [forkSource, setForkSource] = useState<string | null>(null);
  const [executor, setExecutor] = useState("local");
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("rich");
  const [modeOpen, setModeOpen] = useState(false);
  const [customCmd, setCustomCmd] = useState("");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cmdRef = useRef<HTMLInputElement>(null);
  const forkRef = useRef<HTMLDivElement>(null);
  const execRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (richFont) ensureRichFontLoaded(richFont);
  }, [richFont]);

  // Load sessions and executors
  useEffect(() => {
    Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/executors").then((r) => r.json()),
    ])
      .then(([sess, execs]) => {
        setSessions(sess);
        const online = execs.filter((e: ExecutorInfo) => e.status === "online");
        setExecutors(online);
        if (online.length > 0) setExecutor(online[0].id);
      })
      .catch((e) => { console.warn("failed to load sessions/executors", e); });
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (forkOpen && forkRef.current && !forkRef.current.contains(e.target as Node)) {
        setForkOpen(false);
      }
      if (execOpen && execRef.current && !execRef.current.contains(e.target as Node)) {
        setExecOpen(false);
      }
      if (modeOpen && modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [forkOpen, execOpen, modeOpen]);

  const richSessions = sessions.filter((s) => s.mode === "rich");

  function autoResize(el: HTMLTextAreaElement) {
    el.style.overflow = "hidden";
    el.style.height = "0";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    el.style.overflow = "";
  }

  const handleSubmitRich = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || submitting) return;
    setSubmitting(true);

    try {
      let createdName: string;

      if (forkSource) {
        const res = await fetch("/api/sessions/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: forkSource }),
        });
        if (!res.ok) {
          setSubmitting(false);
          return;
        }
        const created = await res.json();
        createdName = created.name;
      } else {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "",
            command: DEFAULT_COMMAND,
            executor,
            mode: "rich",
          }),
        });
        if (!res.ok) {
          setSubmitting(false);
          return;
        }
        const created = await res.json();
        createdName = created.name;
      }

      onSessionCreated(createdName, "rich", text);
    } catch (e) {
      console.warn("failed to create session", e);
      setSubmitting(false);
    }
  }, [inputValue, submitting, forkSource, executor, onSessionCreated]);

  const handleSubmitTerminal = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const command = skipPermissions ? DEFAULT_COMMAND : "claude";
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "",
          command,
          executor,
          mode: "terminal",
        }),
      });
      if (!res.ok) {
        setSubmitting(false);
        return;
      }
      const created = await res.json();
      onSessionCreated(created.name, "terminal", "");
    } catch (e) {
      console.warn("failed to create session", e);
      setSubmitting(false);
    }
  }, [submitting, skipPermissions, executor, onSessionCreated]);

  const handleSubmitCustom = useCallback(async () => {
    const cmd = customCmd.trim();
    if (!cmd || submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "",
          command: cmd,
          executor,
          mode: "terminal",
        }),
      });
      if (!res.ok) {
        setSubmitting(false);
        return;
      }
      const created = await res.json();
      onSessionCreated(created.name, "terminal", "");
    } catch (e) {
      console.warn("failed to create session", e);
      setSubmitting(false);
    }
  }, [customCmd, submitting, executor, onSessionCreated]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sessionMode === "rich") handleSubmitRich();
      else if (sessionMode === "custom") handleSubmitCustom();
      else handleSubmitTerminal();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  const forkLabel = forkSource
    ? richSessions.find((s) => s.name === forkSource)?.name ?? forkSource
    : "New";

  const modeLabels: Record<SessionMode, string> = {
    rich: "Rich",
    terminal: "Terminal",
    custom: "Custom",
  };

  const fontFamily = getRichFontFamily(richFont ?? "system");

  const welcomeTitle = forkSource
    ? `Fork ${forkSource}`
    : sessionMode === "terminal"
      ? "Terminal session"
      : sessionMode === "custom"
        ? "Custom session"
        : "New session";

  const welcomeHint = forkSource
    ? "Type a message to continue"
    : sessionMode === "terminal"
      ? "Opens claude in terminal mode"
      : sessionMode === "custom"
        ? "Run a custom command"
        : "Type a message to start a conversation";

  return (
    <div
      className={styles.root}
      style={{ background: theme.background, color: theme.foreground, fontFamily }}
    >
      {/* Dropdown bar */}
      <div className={styles.dropdownBar}>
        {/* Fork source dropdown — only for rich mode */}
        {sessionMode === "rich" && richSessions.length > 0 && (
          <div className={styles.dropdownWrap} ref={forkRef}>
            <button
              className={styles.dropdownBtn}
              onClick={() => { setForkOpen(!forkOpen); setExecOpen(false); setModeOpen(false); }}
              style={{ color: theme.foreground, borderColor: `${theme.foreground}20` }}
            >
              {forkSource ? (
                <GitFork size={12} style={{ opacity: 0.6 }} />
              ) : (
                <Sparkles size={12} style={{ opacity: 0.6 }} />
              )}
              <span className={styles.dropdownLabel}>{forkLabel}</span>
              <ChevronDown size={10} style={{ opacity: 0.4 }} />
            </button>
            {forkOpen && (
              <div className={styles.dropdown} style={{ background: theme.background, borderColor: `${theme.foreground}20` }}>
                <button
                  className={`${styles.dropdownItem} ${!forkSource ? styles.dropdownItemActive : ""}`}
                  onClick={() => { setForkSource(null); setForkOpen(false); }}
                  style={{ color: theme.foreground }}
                >
                  <Sparkles size={12} style={{ opacity: 0.5 }} />
                  <span>New session</span>
                </button>
                <div className={styles.dropdownSep} style={{ background: `${theme.foreground}10` }} />
                {richSessions.map((s) => (
                  <button
                    key={s.name}
                    className={`${styles.dropdownItem} ${forkSource === s.name ? styles.dropdownItemActive : ""}`}
                    onClick={() => { setForkSource(s.name); setForkOpen(false); }}
                    style={{ color: theme.foreground }}
                  >
                    <GitFork size={12} style={{ opacity: 0.5 }} />
                    <div className={styles.dropdownItemContent}>
                      <span className={styles.dropdownItemName}>{s.name}</span>
                      {s.description && !s.description.startsWith("forked from") && (
                        <span className={styles.dropdownItemDesc} style={{ color: `${theme.foreground}60` }}>
                          {s.description}
                        </span>
                      )}
                      <span className={styles.dropdownItemTime} style={{ color: `${theme.foreground}40` }}>
                        {activityAgo(s.last_activity)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mode dropdown */}
        <div className={styles.dropdownWrap} ref={modeRef}>
          <button
            className={styles.dropdownBtn}
            onClick={() => { setModeOpen(!modeOpen); setForkOpen(false); setExecOpen(false); }}
            style={{ color: theme.foreground, borderColor: `${theme.foreground}20` }}
          >
            {sessionMode === "terminal" || sessionMode === "custom" ? (
              <Terminal size={12} style={{ opacity: 0.6 }} />
            ) : (
              <Sparkles size={12} style={{ opacity: 0.6 }} />
            )}
            <span className={styles.dropdownLabel}>{modeLabels[sessionMode]}</span>
            <ChevronDown size={10} style={{ opacity: 0.4 }} />
          </button>
          {modeOpen && (
            <div className={styles.dropdown} style={{ background: theme.background, borderColor: `${theme.foreground}20` }}>
              <button
                className={`${styles.dropdownItem} ${sessionMode === "rich" ? styles.dropdownItemActive : ""}`}
                onClick={() => { setSessionMode("rich"); setModeOpen(false); setForkSource(null); }}
                style={{ color: theme.foreground }}
              >
                <Sparkles size={12} style={{ opacity: 0.5 }} />
                <span>Rich</span>
              </button>
              <button
                className={`${styles.dropdownItem} ${sessionMode === "terminal" ? styles.dropdownItemActive : ""}`}
                onClick={() => { setSessionMode("terminal"); setModeOpen(false); setForkSource(null); }}
                style={{ color: theme.foreground }}
              >
                <Terminal size={12} style={{ opacity: 0.5 }} />
                <span>Terminal</span>
              </button>
              <button
                className={`${styles.dropdownItem} ${sessionMode === "custom" ? styles.dropdownItemActive : ""}`}
                onClick={() => { setSessionMode("custom"); setModeOpen(false); setForkSource(null); }}
                style={{ color: theme.foreground }}
              >
                <Play size={12} style={{ opacity: 0.5 }} />
                <span>Custom</span>
              </button>
            </div>
          )}
        </div>

        {/* Executor dropdown */}
        {executors.length > 1 && (
          <div className={styles.dropdownWrap} ref={execRef}>
            <button
              className={styles.dropdownBtn}
              onClick={() => { setExecOpen(!execOpen); setForkOpen(false); setModeOpen(false); }}
              style={{ color: theme.foreground, borderColor: `${theme.foreground}20` }}
            >
              <span className={styles.dropdownLabel}>
                {executors.find((e) => e.id === executor)?.name ?? executor}
              </span>
              <ChevronDown size={10} style={{ opacity: 0.4 }} />
            </button>
            {execOpen && (
              <div className={styles.dropdown} style={{ background: theme.background, borderColor: `${theme.foreground}20` }}>
                {executors.map((ex) => (
                  <button
                    key={ex.id}
                    className={`${styles.dropdownItem} ${executor === ex.id ? styles.dropdownItemActive : ""}`}
                    onClick={() => { setExecutor(ex.id); setExecOpen(false); }}
                    style={{ color: theme.foreground }}
                  >
                    <span>{ex.name}{ex.name !== ex.id ? ` (${ex.id})` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Welcome area */}
      <div className={styles.welcomeArea}>
        <div className={styles.welcomeIcon}>
          <div className={styles.welcomeMark} style={{ background: theme.cursor }} />
        </div>
        <div className={styles.welcomeText}>
          <p className={styles.welcomeTitle} style={{ color: theme.foreground }}>
            {welcomeTitle}
          </p>
          <p className={styles.welcomeHint} style={{ color: `${theme.foreground}80` }}>
            {welcomeHint}
          </p>
        </div>
      </div>

      {/* Input area — varies by mode */}
      {sessionMode === "rich" && (
        <div className={styles.inputArea}>
          <div className={styles.inputInner}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                autoResize(e.target);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              autoFocus
              disabled={submitting}
              style={{ color: theme.foreground }}
            />
            <button
              className={styles.sendBtn}
              onMouseDown={(e) => { e.preventDefault(); handleSubmitRich(); }}
              disabled={!inputValue.trim() || submitting}
              style={{
                background: inputValue.trim() ? theme.cursor : "transparent",
                color: inputValue.trim() ? theme.background : theme.foreground,
              }}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      )}

      {sessionMode === "terminal" && (
        <div className={styles.inputArea}>
          <div className={styles.createActions}>
            <label className={styles.checkLabel} style={{ color: `${theme.foreground}80` }}>
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.target.checked)}
              />
              Skip permissions
            </label>
            <button
              className={styles.createBtn}
              onClick={handleSubmitTerminal}
              disabled={submitting}
              onKeyDown={handleKeyDown}
              autoFocus
              style={{
                background: theme.cursor,
                color: theme.background,
              }}
            >
              {submitting ? "Creating…" : "Create session"}
            </button>
          </div>
        </div>
      )}

      {sessionMode === "custom" && (
        <div className={styles.inputArea}>
          <div className={styles.inputInner}>
            <input
              ref={cmdRef}
              className={styles.input}
              type="text"
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Command (e.g. bash, python3)"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
              style={{ color: theme.foreground }}
            />
            <button
              className={styles.sendBtn}
              onMouseDown={(e) => { e.preventDefault(); handleSubmitCustom(); }}
              disabled={!customCmd.trim() || submitting}
              style={{
                background: customCmd.trim() ? theme.cursor : "transparent",
                color: customCmd.trim() ? theme.background : theme.foreground,
              }}
            >
              <Play size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
