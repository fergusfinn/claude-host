"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { RICH_FONT_OPTIONS, ensureRichFontLoaded } from "./rich-view";
import { activityAgo } from "@/lib/ui-utils";
import styles from "./dashboard.module.css";
import type { Session, ExecutorInfo } from "@/shared/types";

interface SessionGroup {
  root: Session;
  children: Session[];
  maxActivity: number; // most recent activity across the group
}

export function Dashboard({ onConnect, onNew }: { onConnect: (name: string, mode?: "terminal" | "rich") => void; onNew?: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const jobDialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const [sessRes, execRes] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/executors"),
      ]);
      setSessions(await sessRes.json());
      setExecutors(await execRes.json());
    } catch (e) { console.warn("failed to load sessions/executors", e); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Keyboard shortcuts: N to create session, J to create job
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "n" && !jobDialogOpen) {
        e.preventDefault();
        onNew?.();
      } else if (e.key === "j" && !jobDialogOpen) {
        e.preventDefault();
        setJobDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jobDialogOpen, onNew]);

  useEffect(() => {
    if (jobDialogOpen) jobDialogRef.current?.showModal();
    else jobDialogRef.current?.close();
  }, [jobDialogOpen]);

  const groups = buildGroups(sessions);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapse(rootName: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rootName)) next.delete(rootName);
      else next.add(rootName);
      return next;
    });
  }

  async function handleDelete(name: string) {
    await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
  }

  async function handleCreateJob(prompt: string, maxIterations: number, executor: string, skipPermissions: boolean) {
    const res = await fetch("/api/sessions/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxIterations, executor, skipPermissions }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create job");
    }
    const created = await res.json();
    setJobDialogOpen(false);
    await load();
    onConnect(created.name);
  }

  return (
    <div className={styles.root}>
      {sessions.length === 0 ? (
        <div className={styles.empty}>
          <pre className={styles.emptyArt}>{`  _\n |_|\n | |_`}</pre>
          <p>No sessions yet</p>
          <button className="btn-accent" onClick={() => onNew?.()}>
            Create your first session
          </button>
          <button className="btn-ghost" onClick={() => setJobDialogOpen(true)}>
            Start a job
          </button>
        </div>
      ) : (
        <>
          <div className={styles.listHeader}>
            <button className="btn-ghost" onClick={() => setJobDialogOpen(true)}>
              Start a job
            </button>
          </div>
          <div className={styles.list}>
            {groups.map((g) => (
              <SessionGroupView
                key={g.root.name}
                group={g}
                isCollapsed={collapsed.has(g.root.name)}
                onToggle={() => toggleCollapse(g.root.name)}
                onConnect={onConnect}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}

      <dialog
        ref={jobDialogRef}
        className={styles.dialog}
        onClose={() => setJobDialogOpen(false)}
      >
        {jobDialogOpen && (
          <CreateJobForm
            executors={executors}
            onSubmit={handleCreateJob}
            onCancel={() => setJobDialogOpen(false)}
          />
        )}
      </dialog>
    </div>
  );
}

function SessionGroupView({
  group,
  isCollapsed,
  onToggle,
  onConnect,
  onDelete,
}: {
  group: SessionGroup;
  isCollapsed: boolean;
  onToggle: () => void;
  onConnect: (name: string, mode?: "terminal" | "rich") => void;
  onDelete: (name: string) => void;
}) {
  const hasChildren = group.children.length > 0;

  return (
    <div className={styles.group}>
      <SessionRow
        session={group.root}
        depth={0}
        hasChildren={hasChildren}
        childCount={group.children.length}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onConnect={() => onConnect(group.root.name, group.root.mode)}
        onDelete={() => onDelete(group.root.name)}
      />
      {hasChildren && !isCollapsed && (
        <div className={styles.groupChildren}>
          {group.children.map((child) => (
            <SessionRow
              key={child.name}
              session={child}
              depth={1}
              hasChildren={false}
              childCount={0}
              isCollapsed={false}
              onToggle={() => {}}
              onConnect={() => onConnect(child.name, child.mode)}
              onDelete={() => onDelete(child.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session: s,
  depth,
  hasChildren,
  childCount,
  isCollapsed,
  onToggle,
  onConnect,
  onDelete,
}: {
  session: Session;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  isCollapsed: boolean;
  onToggle: () => void;
  onConnect: () => void;
  onDelete: () => void;
}) {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [description, setDescription] = useState(s.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const summarizeRequested = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(s.name)}/snapshot`)
      .then((r) => r.json())
      .then(({ text }) => {
        if (!cancelled) {
          const lines = text.replace(/\n+$/, "").split("\n");
          setSnapshot(lines.slice(-12).join("\n"));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [s.name, s.mode]);

  // Auto-summarize sessions without a meaningful description (skip jobs).
  // Polls every 10s until a description is obtained.
  useEffect(() => {
    if (s.job_prompt) return;

    function trySum() {
      if (summarizeRequested.current) return;
      summarizeRequested.current = true;
      fetch(`/api/sessions/${encodeURIComponent(s.name)}/summarize`, { method: "POST" })
        .then((r) => r.json())
        .then(({ description: desc }) => {
          if (desc) setDescription(desc);
          summarizeRequested.current = false;
        })
        .catch(() => { summarizeRequested.current = false; });
    }

    const interval = setInterval(() => {
      const hasDesc = description && !description.startsWith("forked from");
      if (hasDesc) return;
      trySum();
    }, 10_000);

    return () => clearInterval(interval);
  }, [s.name, s.mode, s.job_prompt, description]);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2000);
      return;
    }
    onDelete();
  }

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    onToggle();
  }

  const isStale = (Date.now() / 1000 - s.last_activity) > 600; // 10 min

  function handlePreviewToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setPreviewOpen((v) => !v);
  }

  return (
    <div
      className={`${styles.row} ${depth > 0 ? styles.rowChild : ""}`}
      onClick={() => onConnect()}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowLeft}>
          {hasChildren ? (
            <button className={styles.collapseBtn} onClick={handleToggle}>
              {isCollapsed ? "\u25b8" : "\u25be"}
            </button>
          ) : (
            <button className={styles.collapseBtn} onClick={handlePreviewToggle}>
              {previewOpen ? "\u25be" : "\u25b8"}
            </button>
          )}
          <div className={`${styles.dot} ${isStale ? styles.dotStale : ""}`} />
          <span className={styles.rowName}>{s.name}</span>
          {s.mode === "rich" && (
            <span className={styles.modeBadge}>rich</span>
          )}
          {s.needs_input && (
            <span className={styles.inputBadge}>waiting</span>
          )}
          {s.job_prompt && (
            <span className={styles.jobBadge}>job</span>
          )}
          {s.executor && s.executor !== "local" && (
            <span className={styles.executorBadge}>{s.executor}</span>
          )}
          <span className={styles.rowTime}>{activityAgo(s.last_activity)}</span>
          {s.command && !s.command.startsWith("claude") && (
            <span className={styles.rowCmd}>{s.command}</span>
          )}
        </div>
        <div className={styles.rowRight}>
          {hasChildren && isCollapsed && (
            <span className={styles.forkCount}>
              +{childCount} fork{childCount !== 1 ? "s" : ""}
            </span>
          )}
          <div className={styles.cardActions}>
            <button
              className={confirmDelete ? styles.confirmBtn : styles.deleteBtn}
              onClick={handleDelete}
            >
              {confirmDelete ? "confirm?" : "delete"}
            </button>
          </div>
        </div>
      </div>
      {description && !description.startsWith("forked from") && (
        <div className={styles.rowDesc}>{description}</div>
      )}
      {previewOpen && !isCollapsed && (
        <div className={styles.rowPreviewWrap}>
          <div className={`${styles.rowPreview} ${snapshot === null ? styles.loading : ""}`}>
            {snapshot ?? ""}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateJobForm({
  executors,
  onSubmit,
  onCancel,
}: {
  executors: ExecutorInfo[];
  onSubmit: (prompt: string, maxIterations: number, executor: string, skipPermissions: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [maxIterations, setMaxIterations] = useState("50");
  const [executor, setExecutor] = useState("local");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onlineExecutors = executors.filter((e) => e.status === "online");

  useEffect(() => {
    if (onlineExecutors.length > 0 && !onlineExecutors.some((e) => e.id === executor)) {
      setExecutor(onlineExecutors[0].id);
    }
  }, [executors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(prompt.trim(), parseInt(maxIterations) || 50, executor, skipPermissions);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.dialogHeader}>Start a job</div>
      <div className={styles.dialogBody}>
        <label className={styles.label}>Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the task for Claude to work on..."
          autoComplete="off"
          spellCheck={false}
          autoFocus
          required
          className={styles.textarea}
          rows={4}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label className={styles.label} style={{ margin: 0 }}>Max iterations</label>
          <input
            type="number"
            value={maxIterations}
            onChange={(e) => setMaxIterations(e.target.value)}
            min="1"
            max="500"
            autoComplete="off"
            className={styles.input}
            style={{ width: 80 }}
          />
        </div>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => setSkipPermissions(e.target.checked)}
          />
          Dangerously skip permissions
        </label>
        {onlineExecutors.length > 1 && (
          <>
            <label className={styles.label}>Executor</label>
            <select
              value={executor}
              onChange={(e) => setExecutor(e.target.value)}
              className={styles.input}
            >
              {onlineExecutors.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}{ex.name !== ex.id ? ` (${ex.id})` : ""}
                </option>
              ))}
            </select>
          </>
        )}
        {error && <div className={styles.error}>{error}</div>}
      </div>
      <div className={styles.dialogFooter}>
        <div />
        <div className={styles.dialogFooterRight}>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={submitting || !prompt.trim()}>
            {submitting ? "Starting..." : "Start job"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function SettingsForm({
  config,
  onSave,
  onCancel,
}: {
  config: Record<string, string>;
  onSave: (config: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [prefixTimeout, setPrefixTimeout] = useState(config.prefixTimeout || "800");
  const [showHints, setShowHints] = useState(config.showHints !== "false");
  const [selectedRichFont, setSelectedRichFont] = useState(config.richFont || "system");
  const [saving, setSaving] = useState(false);

  // Load all rich font options so button labels preview in the correct font
  useEffect(() => {
    for (const id of Object.keys(RICH_FONT_OPTIONS)) ensureRichFontLoaded(id);
  }, []);

  const parsedHooks: Record<string, string> = (() => {
    try { return config.forkHooks ? JSON.parse(config.forkHooks) : {}; } catch { return {}; }
  })();
  const [hooks, setHooks] = useState<Array<{ command: string; path: string }>>(
    Object.entries(parsedHooks).length > 0
      ? Object.entries(parsedHooks).map(([command, path]) => ({ command, path }))
      : [{ command: "claude", path: "hooks/fork-claude.sh" }],
  );

  function addHook() {
    setHooks((prev) => [...prev, { command: "", path: "" }]);
  }

  function removeHook(index: number) {
    setHooks((prev) => prev.filter((_, i) => i !== index));
  }

  function updateHook(index: number, field: "command" | "path", value: string) {
    setHooks((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const forkHooks: Record<string, string> = {};
      for (const h of hooks) {
        const cmd = h.command.trim();
        const path = h.path.trim();
        if (cmd && path) forkHooks[cmd] = path;
      }
      await onSave({
        prefixTimeout: String(parseInt(prefixTimeout) || 800),
        forkHooks: JSON.stringify(forkHooks),
        showHints: String(showHints),
        richFont: selectedRichFont,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.dialogHeader}>Settings</div>
      <div className={styles.dialogBody}>
        <label className={styles.label}>Prefix timeout (ms)</label>
        <input
          type="number"
          value={prefixTimeout}
          onChange={(e) => setPrefixTimeout(e.target.value)}
          min="100"
          step="100"
          autoComplete="off"
          className={styles.input}
          style={{ width: 100 }}
        />
        <div className={styles.hint}>
          How long control mode stays active after a shortcut key (default 800ms)
        </div>

        <label className={styles.checkboxLabel} style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={showHints}
            onChange={(e) => setShowHints(e.target.checked)}
          />
          Show control mode hints
        </label>
        <div className={styles.hint}>
          Show shortcut hints when control mode is active (Ctrl+A)
        </div>

        <label className={styles.label} style={{ marginTop: 12 }}>Rich mode font</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          {Object.entries(RICH_FONT_OPTIONS).map(([id, opt]) => (
            <button
              key={id}
              type="button"
              className={styles.input}
              onClick={() => {
                ensureRichFontLoaded(id);
                setSelectedRichFont(id);
              }}
              style={{
                width: "auto",
                padding: "6px 12px",
                cursor: "pointer",
                fontFamily: opt.fontFamily,
                border: id === selectedRichFont ? "1px solid var(--accent)" : undefined,
                opacity: id === selectedRichFont ? 1 : 0.7,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className={styles.hint}>
          Font used for rich mode message text
        </div>

        <div style={{ marginTop: 12 }}>
          <label className={styles.label}>Fork hooks</label>
          <div className={styles.hint} style={{ marginBottom: 8 }}>
            When splitting a pane, run a hook script to determine the command for the new pane.
            The hook receives SOURCE_SESSION, SOURCE_CWD, and SOURCE_COMMAND as env vars.
          </div>
          {hooks.map((hook, i) => (
            <div key={i} className={styles.hookRow}>
              <input
                type="text"
                value={hook.command}
                onChange={(e) => updateHook(i, "command", e.target.value)}
                placeholder="command"
                autoComplete="off"
                spellCheck={false}
                className={styles.input}
                style={{ width: 100, flex: "0 0 100px" }}
              />
              <input
                type="text"
                value={hook.path}
                onChange={(e) => updateHook(i, "path", e.target.value)}
                placeholder="path/to/hook.sh"
                autoComplete="off"
                spellCheck={false}
                className={styles.input}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className={styles.hookRemoveBtn}
                onClick={() => removeHook(i)}
                title="Remove hook"
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={addHook} style={{ marginTop: 4, fontSize: 12 }}>
            + Add hook
          </button>
        </div>
      </div>
      <div className={styles.dialogFooter}>
        <div />
        <div className={styles.dialogFooterRight}>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}



/** Build session groups: root sessions with their fork children, sorted by most recent activity */
function buildGroups(sessions: Session[]): SessionGroup[] {
  const byName = new Map(sessions.map((s) => [s.name, s]));

  // Find root for each session (walk parent chain)
  function findRoot(s: Session): string {
    const visited = new Set<string>();
    let current = s;
    while (current.parent && byName.has(current.parent) && !visited.has(current.name)) {
      visited.add(current.name);
      current = byName.get(current.parent)!;
    }
    return current.name;
  }

  // Group by root
  const groupMap = new Map<string, Session[]>();
  for (const s of sessions) {
    const rootName = findRoot(s);
    if (!groupMap.has(rootName)) groupMap.set(rootName, []);
    groupMap.get(rootName)!.push(s);
  }

  // Build groups
  const groups: SessionGroup[] = [];
  for (const [rootName, members] of groupMap) {
    const root = byName.get(rootName)!;
    const children = members
      .filter((s) => s.name !== rootName)
      .sort((a, b) => b.last_activity - a.last_activity);
    const maxActivity = Math.max(...members.map((s) => s.last_activity));
    groups.push({ root, children, maxActivity });
  }

  // Sort groups by creation time (oldest first, stable order)
  groups.sort((a, b) =>
    new Date(a.root.created_at).getTime() - new Date(b.root.created_at).getTime()
  );
  return groups;
}
