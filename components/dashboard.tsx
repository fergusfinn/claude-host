"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { generateName } from "@/lib/names";
import styles from "./dashboard.module.css";

interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
  parent: string | null;
  last_activity: number;
}

interface SessionGroup {
  root: Session;
  children: Session[];
  maxActivity: number; // most recent activity across the group
}

export function Dashboard({ onConnect, config }: { onConnect: (name: string) => void; config: Record<string, string> }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      setSessions(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Keyboard shortcut: N to create
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !dialogOpen) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          setDialogOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialogOpen]);

  useEffect(() => {
    if (dialogOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialogOpen]);

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

  async function handleCreate(name: string, description: string, command: string) {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, command }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create session");
    }
    setDialogOpen(false);
    await load();
    onConnect(name);
  }

  async function handleDelete(name: string) {
    await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
    load();
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
        </div>
      ) : (
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
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onClose={() => setDialogOpen(false)}
      >
        {dialogOpen && (
          <CreateForm
            defaultCommand={config.defaultCommand || "claude"}
            onSubmit={handleCreate}
            onCancel={() => setDialogOpen(false)}
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
  onConnect: (name: string) => void;
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
        onConnect={() => onConnect(group.root.name)}
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
              onConnect={() => onConnect(child.name)}
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
  }, [s.name]);

  // Auto-summarize sessions without a meaningful description
  useEffect(() => {
    const hasDesc = s.description && !s.description.startsWith("forked from");
    if (hasDesc || summarizeRequested.current) return;
    // Wait a bit for the session to produce output
    const timer = setTimeout(() => {
      summarizeRequested.current = true;
      fetch(`/api/sessions/${encodeURIComponent(s.name)}/summarize`, { method: "POST" })
        .then((r) => r.json())
        .then(({ description: desc }) => { if (desc) setDescription(desc); })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [s.name, s.description]);

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
  onSubmit,
  onCancel,
}: {
  defaultCommand: string;
  onSubmit: (name: string, desc: string, cmd: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(generateName);
  const [desc, setDesc] = useState("");
  const [cmd, setCmd] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(name.trim(), desc.trim(), cmd.trim() || defaultCommand);
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
            <input
              type="text"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder={`Command (default: ${defaultCommand})`}
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
            />
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
  const [defaultCwd, setDefaultCwd] = useState(config.defaultCwd || "");
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
        defaultCwd: defaultCwd.trim(),
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

        <label className={styles.label} style={{ marginTop: 12 }}>Working directory</label>
        <input
          type="text"
          value={defaultCwd}
          onChange={(e) => setDefaultCwd(e.target.value)}
          placeholder="(server working directory)"
          autoComplete="off"
          spellCheck={false}
          className={styles.input}
        />
        <div className={styles.hint}>
          Starting directory for new sessions (leave empty for server default)
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
