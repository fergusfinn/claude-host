"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./symphony-page.module.css";

interface RunningWorker {
  issue_id: string;
  issue_identifier: string;
  state: string;
  turn_count: number;
  last_event: string | null;
  last_message: string;
  started_at: string;
  last_event_at: string | null;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
}

interface RetryingWorker {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  due_at: string;
  error: string | null;
}

interface SymphonyState {
  generated_at: string;
  counts: { running: number; retrying: number };
  running: RunningWorker[];
  retrying: RetryingWorker[];
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
}

type Tab = "monitor" | "workflow";

export function SymphonyPage() {
  const [state, setState] = useState<SymphonyState | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("monitor");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/symphony/api/v1/state");
      if (!res.ok) throw new Error();
      setState(await res.json());
      setOffline(false);
    } catch {
      setOffline(true);
      setState(null);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch("/symphony/api/v1/refresh", { method: "POST" });
      setTimeout(load, 1000);
    } catch {}
    setRefreshing(false);
  }

  if (offline) {
    return (
      <div className={styles.root}>
        <div className={styles.offline}>
          <div className={styles.offlineTitle}>Symphony is not running</div>
          <div className={styles.offlineSub}>
            Start with <code>systemctl --user start symphony</code>
          </div>
          <button className={styles.retryBtn} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === "monitor" ? styles.tabActive : ""}`}
            onClick={() => setTab("monitor")}
          >
            Monitor
          </button>
          <button
            className={`${styles.tab} ${tab === "workflow" ? styles.tabActive : ""}`}
            onClick={() => setTab("workflow")}
          >
            Workflow
          </button>
        </div>
        {tab === "monitor" && (
          <button
            className={styles.refreshBtn}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Polling..." : "Poll now"}
          </button>
        )}
      </div>

      {tab === "monitor" ? (
        <MonitorView state={state} />
      ) : (
        <WorkflowEditor />
      )}
    </div>
  );
}

function MonitorView({ state }: { state: SymphonyState }) {
  return (
    <>
      <div className={styles.stats}>
        <Stat label="Running" value={state.counts.running} />
        <Stat label="Retrying" value={state.counts.retrying} />
        <Stat label="Tokens" value={formatNum(state.codex_totals.total_tokens)} />
        <Stat label="Runtime" value={`${Math.round(state.codex_totals.seconds_running)}s`} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Running</div>
        {state.running.length === 0 ? (
          <div className={styles.emptyMsg}>No active workers</div>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colId}>Issue</span>
              <span className={styles.colState}>State</span>
              <span className={styles.colNarrow}>Turns</span>
              <span className={styles.colWide}>Last message</span>
              <span className={styles.colNarrow}>Tokens</span>
              <span className={styles.colTime}>Duration</span>
            </div>
            {state.running.map((w) => (
              <div key={w.issue_id} className={styles.tableRow}>
                <span className={styles.colId}>{w.issue_identifier}</span>
                <span className={styles.colState}>{w.state}</span>
                <span className={styles.colNarrow}>{w.turn_count}</span>
                <span className={`${styles.colWide} ${styles.message}`}>
                  {w.last_message || w.last_event || "\u2014"}
                </span>
                <span className={styles.colNarrow}>{formatNum(w.tokens.total_tokens)}</span>
                <span className={styles.colTime}>{elapsed(w.started_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Retry queue</div>
        {state.retrying.length === 0 ? (
          <div className={styles.emptyMsg}>No retries queued</div>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colId}>Issue</span>
              <span className={styles.colNarrow}>Attempt</span>
              <span className={styles.colTime}>Due</span>
              <span className={styles.colWide}>Error</span>
            </div>
            {state.retrying.map((r) => (
              <div key={r.issue_id} className={styles.tableRow}>
                <span className={styles.colId}>{r.issue_identifier}</span>
                <span className={styles.colNarrow}>{r.attempt}</span>
                <span className={styles.colTime}>{formatTime(r.due_at)}</span>
                <span className={`${styles.colWide} ${styles.message}`}>{r.error || "\u2014"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        Updated {formatTime(state.generated_at)}
      </div>
    </>
  );
}

function WorkflowEditor() {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/symphony/api/v1/workflow");
      if (!res.ok) throw new Error("Failed to load workflow");
      const data = await res.json();
      setContent(data.content);
      setSavedContent(data.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflow");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  async function handleSave() {
    if (content === null) return;
    setSaving(true);
    setError(null);
    setSaveStatus(null);
    try {
      const res = await fetch("/symphony/api/v1/workflow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Failed to save");
      }
      setSavedContent(content);
      setSaveStatus("Saved — config reloaded automatically");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
    setSaving(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    // Tab key inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      setContent(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }

  const dirty = content !== savedContent;

  if (loading) {
    return <div className={styles.emptyMsg}>Loading workflow...</div>;
  }

  return (
    <div className={styles.editorContainer}>
      <div className={styles.editorToolbar}>
        <span className={styles.editorLabel}>WORKFLOW.md</span>
        <div className={styles.editorActions}>
          {saveStatus && <span className={styles.saveStatus}>{saveStatus}</span>}
          {error && <span className={styles.saveError}>{error}</span>}
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.editor}
        value={content ?? ""}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      {dirty && (
        <div className={styles.editorFooter}>
          Unsaved changes &middot; Cmd+S to save
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function elapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
