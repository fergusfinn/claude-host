"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { generateName } from "@/lib/names";
import styles from "./dashboard.module.css";

interface Session {
  name: string;
  created_at: string;
  description: string;
  command: string;
  alive: boolean;
}

export function Dashboard({ onConnect }: { onConnect: (name: string) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      setSessions(await res.json());
    } catch {}
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      setConfig(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadConfig();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, loadConfig]);

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

  useEffect(() => {
    if (settingsOpen) settingsRef.current?.showModal();
    else settingsRef.current?.close();
  }, [settingsOpen]);

  const alive = sessions.filter((s) => s.alive);
  const dead = sessions.filter((s) => !s.alive);
  const sorted = [...alive, ...dead];

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

  async function cleanupDead() {
    for (const s of dead) {
      await fetch(`/api/sessions/${encodeURIComponent(s.name)}`, { method: "DELETE" });
    }
    load();
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logoMark} />
          <h1 className={styles.title}>
            claude<span className={styles.dim}>/</span>host
          </h1>
          {sessions.length > 0 && (
            <span className={styles.count}>
              {alive.length} live{dead.length > 0 && ` / ${dead.length} dead`}
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          {dead.length > 0 && (
            <button className="btn-ghost" onClick={cleanupDead}>
              Clear dead
            </button>
          )}
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <button className="btn-accent" onClick={() => setDialogOpen(true)}>
            New session <kbd>N</kbd>
          </button>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className={styles.empty}>
          <pre className={styles.emptyArt}>{`  _\n |_|\n | |_`}</pre>
          <p>No sessions yet</p>
          <button className="btn-accent" onClick={() => setDialogOpen(true)}>
            Create your first session
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {sorted.map((s) => (
            <SessionCard
              key={s.name}
              session={s}
              onConnect={() => onConnect(s.name)}
              onDelete={() => handleDelete(s.name)}
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

      <dialog
        ref={settingsRef}
        className={styles.dialog}
        onClose={() => setSettingsOpen(false)}
      >
        <SettingsForm
          config={config}
          onSave={async (updated) => {
            const res = await fetch("/api/config", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updated),
            });
            setConfig(await res.json());
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        />
      </dialog>
    </div>
  );
}

function SessionCard({
  session: s,
  onConnect,
  onDelete,
}: {
  session: Session;
  onConnect: () => void;
  onDelete: () => void;
}) {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!s.alive) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(s.name)}/snapshot`)
      .then((r) => r.json())
      .then(({ text }) => {
        if (!cancelled) {
          const lines = text.replace(/\n+$/, "").split("\n");
          setSnapshot(lines.slice(-18).join("\n"));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [s.name, s.alive]);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2000);
      return;
    }
    onDelete();
  }

  return (
    <div
      className={`${styles.card} ${s.alive ? "" : styles.dead}`}
      onClick={() => s.alive && onConnect()}
    >
      <div className={styles.cardTop}>
        <div className={styles.cardName}>
          <div className={`${styles.dot} ${s.alive ? "" : styles.dotDead}`} />
          <span>{s.name}</span>
        </div>
        <div className={styles.cardActions}>
          <button
            className={confirmDelete ? styles.confirmBtn : styles.deleteBtn}
            onClick={handleDelete}
          >
            {confirmDelete ? "confirm?" : "delete"}
          </button>
        </div>
      </div>
      <div className={styles.cardMeta}>
        {timeAgo(s.created_at)}
        {s.description && ` \u00b7 ${s.description}`}
        {s.command && s.command !== "claude" && ` \u00b7 ${s.command}`}
      </div>
      <div className={`${styles.cardPreview} ${snapshot === null ? styles.loading : ""}`}>
        {snapshot ?? ""}
      </div>
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

function SettingsForm({
  config,
  onSave,
  onCancel,
}: {
  config: Record<string, string>;
  onSave: (config: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [defaultCommand, setDefaultCommand] = useState(config.defaultCommand || "claude");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ defaultCommand: defaultCommand.trim() || "claude" });
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
