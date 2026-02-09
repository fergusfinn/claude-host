"use client";

import { useState, useEffect, useCallback, useRef, type MutableRefObject } from "react";
import { generateName } from "@/lib/names";
import styles from "./dashboard.module.css";

interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
  mode: "terminal" | "rich";
  parent: string | null;
  executor: string;
  last_activity: number;
  alive: boolean;
  job_prompt: string | null;
  job_max_iterations: number | null;
  needs_input: boolean;
}

interface ExecutorInfo {
  id: string;
  name: string;
  labels: string[];
  status: string;
  sessionCount: number;
}

interface SessionGroup {
  root: Session;
  children: Session[];
  maxActivity: number; // most recent activity across the group
}

export function Dashboard({ onConnect, config, openCreateRef }: { onConnect: (name: string, mode?: "terminal" | "rich") => void; config: Record<string, string>; openCreateRef?: MutableRefObject<(() => void) | null> }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Expose dialog trigger to parent
  useEffect(() => {
    if (openCreateRef) openCreateRef.current = () => setDialogOpen(true);
    return () => { if (openCreateRef) openCreateRef.current = null; };
  }, [openCreateRef]);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const jobDialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      setSessions(await res.json());
    } catch {}
  }, []);

  // Load executors once
  useEffect(() => {
    fetch("/api/executors")
      .then((r) => r.json())
      .then(setExecutors)
      .catch(() => {});
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
      if (e.key === "n" && !dialogOpen && !jobDialogOpen) {
        e.preventDefault();
        setDialogOpen(true);
      } else if (e.key === "j" && !dialogOpen && !jobDialogOpen) {
        e.preventDefault();
        setJobDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialogOpen, jobDialogOpen]);

  useEffect(() => {
    if (dialogOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialogOpen]);

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

  async function handleCreate(name: string, description: string, command: string, executor: string, mode: "terminal" | "rich" = "terminal") {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, command, executor, mode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create session");
    }
    setDialogOpen(false);
    await load();
    onConnect(name, mode);
  }

  async function handleDelete(name: string) {
    await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
  }

  async function handleCreateJob(name: string, prompt: string, maxIterations: number, executor: string) {
    const res = await fetch("/api/sessions/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, prompt, maxIterations, executor }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create job");
    }
    setJobDialogOpen(false);
    await load();
    onConnect(name);
  }

  return (
    <div className={styles.root}>
      {sessions.length === 0 ? (
        <div className={styles.empty}>
          <pre className={styles.emptyArt}>{`  _\n |_|\n | |_`}</pre>
          <p>No sessions yet</p>
          <button className="btn-accent" onClick={() => setDialogOpen(true)}>
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
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setDialogOpen(false)}
      >
        {dialogOpen && (
          <CreateForm
            defaultCommand={config.defaultCommand || "claude"}
            executors={executors}
            onSubmit={handleCreate}
            onCancel={() => setDialogOpen(false)}
          />
        )}
      </dialog>

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

  // Skip snapshot and auto-summarize for rich sessions
  useEffect(() => {
    if (s.mode === "rich") return;
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

  // Auto-summarize sessions without a meaningful description (skip jobs and rich).
  // Polls every 10s until a description is obtained.
  useEffect(() => {
    if (s.job_prompt || s.mode === "rich") return;

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
          {s.command && s.command !== "claude" && (
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

function CreateForm({
  defaultCommand,
  executors,
  onSubmit,
  onCancel,
}: {
  defaultCommand: string;
  executors: ExecutorInfo[];
  onSubmit: (name: string, desc: string, cmd: string, executor: string, mode: "terminal" | "rich") => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(generateName);
  const [desc, setDesc] = useState("");
  const [cmd, setCmd] = useState("");
  const [executor, setExecutor] = useState("local");
  const [mode, setMode] = useState<"terminal" | "rich">("terminal");
  const [showExtras, setShowExtras] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onlineExecutors = executors.filter((e) => e.status === "online");

  // Sync executor selection when executors load and current value isn't valid
  useEffect(() => {
    if (onlineExecutors.length > 0 && !onlineExecutors.some((e) => e.id === executor)) {
      setExecutor(onlineExecutors[0].id);
    }
  }, [executors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(name.trim(), desc.trim(), cmd.trim() || defaultCommand, executor, mode);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.dialogHeader}>New session</div>
      <div className={styles.dialogBody}>
        <div className={styles.nameRow}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-zA-Z0-9_-]+"
            required
            placeholder="Session name"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className={styles.input}
          />
          <button
            type="button"
            className={styles.rerollBtn}
            onClick={() => setName(generateName())}
            title="Generate new name"
          >
            &#x21bb;
          </button>
        </div>
        <div className={styles.modeToggle}>
          <button
            type="button"
            className={`${styles.modeOption} ${mode === "terminal" ? styles.modeActive : ""}`}
            onClick={() => setMode("terminal")}
          >
            <span className={styles.modeIcon}>&#xF0C8;</span>
            Terminal
          </button>
          <button
            type="button"
            className={`${styles.modeOption} ${mode === "rich" ? styles.modeActive : ""}`}
            onClick={() => setMode("rich")}
          >
            <span className={styles.modeIcon}>&#x25C7;</span>
            Rich
          </button>
        </div>
        {showExtras && (
          <>
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
            />
            {mode === "terminal" && (
              <input
                type="text"
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder={`Command (default: ${defaultCommand})`}
                autoComplete="off"
                spellCheck={false}
                className={styles.input}
              />
            )}
            {onlineExecutors.length > 0 && (
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
          </>
        )}
        {error && <div className={styles.error}>{error}</div>}
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className="btn-ghost" onClick={() => setShowExtras(!showExtras)}>
          {showExtras ? "Less" : "Options"}
        </button>
        <div className={styles.dialogFooterRight}>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={submitting}>
            {submitting ? "Creating..." : "Create & connect"}
          </button>
        </div>
      </div>
    </form>
  );
}

function CreateJobForm({
  executors,
  onSubmit,
  onCancel,
}: {
  executors: ExecutorInfo[];
  onSubmit: (name: string, prompt: string, maxIterations: number, executor: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(generateName);
  const [prompt, setPrompt] = useState("");
  const [maxIterations, setMaxIterations] = useState("50");
  const [executor, setExecutor] = useState("local");
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
      await onSubmit(name.trim(), prompt.trim(), parseInt(maxIterations) || 50, executor);
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
        <div className={styles.nameRow}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-zA-Z0-9_-]+"
            required
            placeholder="Job name"
            autoComplete="off"
            spellCheck={false}
            className={styles.input}
          />
          <button
            type="button"
            className={styles.rerollBtn}
            onClick={() => setName(generateName())}
            title="Generate new name"
          >
            &#x21bb;
          </button>
        </div>
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
        {onlineExecutors.length > 0 && (
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
  const [defaultCommand, setDefaultCommand] = useState(config.defaultCommand || "claude");
  const [prefixTimeout, setPrefixTimeout] = useState(config.prefixTimeout || "800");
  const [showHints, setShowHints] = useState(config.showHints !== "false");
  const [saving, setSaving] = useState(false);

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
        defaultCommand: defaultCommand.trim() || "claude",
        prefixTimeout: String(parseInt(prefixTimeout) || 800),
        forkHooks: JSON.stringify(forkHooks),
        showHints: String(showHints),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.dialogHeader}>Settings</div>
      <div className={styles.dialogBody}>
        <label className={styles.label}>Default command</label>
        <input
          type="text"
          value={defaultCommand}
          onChange={(e) => setDefaultCommand(e.target.value)}
          placeholder="claude"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className={styles.input}
        />
        <div className={styles.hint}>
          Command to run when creating new sessions
        </div>

        <label className={styles.label} style={{ marginTop: 12 }}>Prefix timeout (ms)</label>
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

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function activityAgo(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixTs);
  if (diff < 5) return "active";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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

  // Sort groups by most recent activity (most active first)
  groups.sort((a, b) => b.maxActivity - a.maxActivity);
  return groups;
}
