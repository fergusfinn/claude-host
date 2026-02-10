"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import styles from "./executors-page.module.css";

interface ExecutorInfo {
  id: string;
  name: string;
  labels: string[];
  status: string;
  sessionCount: number;
  version?: string;
}

interface LogEntry {
  timestamp: number;
  executorId: string;
  event: string;
  detail?: string;
}

interface ExecutorKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  expires_at: number | null;
  last_used: number | null;
  revoked: boolean;
}

interface NewKeyResult {
  id: string;
  name: string;
  token: string;
  key_prefix: string;
  created_at: number;
  expires_at: number | null;
}

export function ExecutorsPage() {
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [upgrading, setUpgrading] = useState<Set<string>>(new Set());
  const [keys, setKeys] = useState<ExecutorKeyInfo[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState<number | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const logSinceRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/executor-keys");
      if (res.ok) setKeys(await res.json());
    } catch {}
  }, []);

  const loadExecutors = useCallback(async () => {
    try {
      const res = await fetch("/api/executors");
      setExecutors(await res.json());
    } catch (e) { console.warn("failed to load executors", e); }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const url = logSinceRef.current
        ? `/api/executors/logs?since=${logSinceRef.current}`
        : "/api/executors/logs";
      const res = await fetch(url);
      const newLogs: LogEntry[] = await res.json();
      if (newLogs.length > 0) {
        logSinceRef.current = newLogs[newLogs.length - 1].timestamp;
        setLogs((prev) => [...prev, ...newLogs].slice(-200));
      }
    } catch (e) { console.warn("failed to load executor logs", e); }
  }, []);

  useEffect(() => {
    loadExecutors();
    loadLogs();
    loadKeys();
    const t = setInterval(() => {
      loadExecutors();
      loadLogs();
    }, 3000);
    return () => clearInterval(t);
  }, [loadExecutors, loadLogs, loadKeys]);

  // Auto-scroll log to bottom when new entries arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Clear upgrading state when executor comes back online with different version or reconnects
  useEffect(() => {
    setUpgrading((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        const ex = executors.find((e) => e.id === id);
        // Clear if executor reconnected (online) or disappeared from list
        if (!ex || ex.status === "online") {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [executors]);

  async function handleUpgrade(executorId: string) {
    setUpgrading((prev) => new Set(prev).add(executorId));
    try {
      const res = await fetch("/api/executors/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executorId }),
      });
      if (!res.ok) {
        setUpgrading((prev) => {
          const next = new Set(prev);
          next.delete(executorId);
          return next;
        });
      }
    } catch {
      setUpgrading((prev) => {
        const next = new Set(prev);
        next.delete(executorId);
        return next;
      });
    }
  }

  async function handleUpgradeAll() {
    const remote = executors.filter((e) => e.status === "online" && e.id !== "local");
    for (const ex of remote) {
      setUpgrading((prev) => new Set(prev).add(ex.id));
    }
    try {
      await fetch("/api/executors/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (e) { console.warn("failed to trigger reconnect", e); }
  }

  async function handleCreateKey() {
    setCreating(true);
    try {
      const res = await fetch("/api/executor-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName, expiresInDays: newKeyExpiry }),
      });
      if (res.ok) {
        const result: NewKeyResult = await res.json();
        setNewKeyResult(result);
        loadKeys();
      }
    } catch {}
    setCreating(false);
  }

  async function handleRevokeKey(keyId: string) {
    if (!confirm("Revoke this key? Executors using it will be unable to reconnect.")) return;
    try {
      const res = await fetch(`/api/executor-keys/${keyId}`, { method: "DELETE" });
      if (res.ok) loadKeys();
    } catch {}
  }

  function handleCloseDialog() {
    setShowAddDialog(false);
    setNewKeyResult(null);
    setNewKeyName("");
    setNewKeyExpiry(undefined);
    setCopied(false);
  }

  function getStartupCommand(): string {
    const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";
    const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const name = newKeyName || "My Executor";
    const lines = [
      `git clone https://github.com/fergusfinn/claude-host.git claude-host-executor`,
      `cd claude-host-executor && npm install --omit=dev`,
      `npx tsx executor/index.ts \\`,
      `  --url ${proto}://${host} \\`,
      `  --token ${newKeyResult!.token} \\`,
      `  --name "${name}"`,
    ];
    return lines.join("\n");
  }

  async function handleCopy() {
    const text = getStartupCommand();
    try {
      // Clipboard API requires HTTPS; fall back to execCommand for HTTP
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const remoteOnline = executors.filter((e) => e.status === "online" && e.id !== "local");
  const hostVersion = executors.find((e) => e.id === "local")?.version;
  const activeKeys = keys.filter((k) => !k.revoked);
  const revokedKeys = keys.filter((k) => k.revoked);

  return (
    <div className={styles.root}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Executors{hostVersion && <span className={styles.hostVersion}>host {hostVersion}</span>}</span>
          <div className={styles.headerActions}>
            {remoteOnline.length > 0 && (
              <button className={styles.upgradeBtn} onClick={handleUpgradeAll}>
                Upgrade all remote
              </button>
            )}
            <button className={styles.addBtn} onClick={() => setShowAddDialog(true)}>
              + Add executor
            </button>
          </div>
        </div>
        <div className={styles.list}>
          {executors.length === 0 && (
            <div className={styles.emptyMsg}>No executors registered</div>
          )}
          {executors.map((ex) => {
            const isLocal = ex.id === "local";
            const isUpgrading = upgrading.has(ex.id);
            return (
              <div key={ex.id} className={styles.row}>
                <div className={styles.rowLeft}>
                  <div className={`${styles.dot} ${ex.status !== "online" ? styles.dotStale : ""} ${isUpgrading ? styles.dotUpgrading : ""}`} />
                  <span className={styles.name}>{ex.name}</span>
                  {ex.version && (
                    <span className={styles.version}>{ex.version}</span>
                  )}
                  <span className={styles.meta}>
                    {isUpgrading
                      ? "upgrading..."
                      : ex.status === "online"
                        ? `${ex.sessionCount} session${ex.sessionCount !== 1 ? "s" : ""}`
                        : "offline"}
                  </span>
                  {ex.labels.length > 0 && (
                    <span className={styles.labels}>{ex.labels.join(", ")}</span>
                  )}
                  {isLocal && <span className={styles.localBadge}>local</span>}
                </div>
                {!isLocal && ex.status === "online" && !isUpgrading && (
                  <button className={styles.upgradeBtn} onClick={() => handleUpgrade(ex.id)}>
                    Upgrade
                  </button>
                )}
                {isUpgrading && (
                  <span className={styles.upgradingLabel}>upgrading...</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Keys section */}
      <div className={styles.keysPanel}>
        <div className={styles.header}>
          <span className={styles.title}>Executor keys</span>
        </div>
        {activeKeys.length === 0 && revokedKeys.length === 0 && (
          <div className={styles.emptyMsg}>No executor keys yet. Click &quot;Add executor&quot; to create one.</div>
        )}
        {activeKeys.length > 0 && (
          <div className={styles.keyTable}>
            <div className={styles.keyTableHeader}>
              <span className={styles.keyCol}>Prefix</span>
              <span className={styles.keyColWide}>Name</span>
              <span className={styles.keyCol}>Created</span>
              <span className={styles.keyCol}>Expires</span>
              <span className={styles.keyCol}>Last used</span>
              <span className={styles.keyColAction} />
            </div>
            {activeKeys.map((k) => (
              <div key={k.id} className={styles.keyRow}>
                <span className={`${styles.keyCol} ${styles.keyPrefix}`}>chk_{k.key_prefix}...</span>
                <span className={`${styles.keyColWide} ${styles.keyName}`}>{k.name || "—"}</span>
                <span className={styles.keyCol}>{formatDate(k.created_at)}</span>
                <span className={styles.keyCol}>{k.expires_at ? formatDate(k.expires_at) : "Never"}</span>
                <span className={styles.keyCol}>{k.last_used ? formatDate(k.last_used) : "Never"}</span>
                <span className={styles.keyColAction}>
                  <button className={styles.revokeBtn} onClick={() => handleRevokeKey(k.id)}>Revoke</button>
                </span>
              </div>
            ))}
          </div>
        )}
        {revokedKeys.length > 0 && (
          <div className={styles.keyTable}>
            {revokedKeys.map((k) => (
              <div key={k.id} className={`${styles.keyRow} ${styles.keyRowRevoked}`}>
                <span className={`${styles.keyCol} ${styles.keyPrefix}`}>chk_{k.key_prefix}...</span>
                <span className={`${styles.keyColWide} ${styles.keyName}`}>{k.name || "—"}</span>
                <span className={styles.keyCol}>{formatDate(k.created_at)}</span>
                <span className={styles.keyCol}>—</span>
                <span className={styles.keyCol}>{k.last_used ? formatDate(k.last_used) : "Never"}</span>
                <span className={`${styles.keyColAction} ${styles.revokedLabel}`}>Revoked</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.logPanel}>
        <div className={styles.header}>
          <span className={styles.title}>Remote executor log</span>
          {logs.length > 0 && (
            <button
              className={styles.clearBtn}
              onClick={() => { setLogs([]); logSinceRef.current = Date.now(); }}
            >
              Clear
            </button>
          )}
        </div>
        <div className={styles.logScroll}>
          {logs.length === 0 && (
            <div className={styles.emptyMsg}>No remote executor events yet</div>
          )}
          {logs.map((entry, i) => (
            <div key={i} className={styles.logEntry}>
              <span className={styles.logTime}>{formatTime(entry.timestamp)}</span>
              <span className={styles.logExecutor}>{entry.executorId}</span>
              <span className={`${styles.logEvent} ${styles[`event_${entry.event}`] || ""}`}>
                {entry.event}
              </span>
              {entry.detail && <span className={styles.logDetail}>{entry.detail}</span>}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Add Executor dialog */}
      {showAddDialog && (
        <div className={styles.overlay} onClick={handleCloseDialog}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            {!newKeyResult ? (
              <>
                <div className={styles.dialogTitle}>Add Executor</div>
                <label className={styles.fieldLabel}>
                  Name
                  <input
                    className={styles.input}
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g. My Laptop"
                    autoFocus
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Key expiry
                  <select
                    className={styles.select}
                    value={newKeyExpiry ?? ""}
                    onChange={(e) => setNewKeyExpiry(e.target.value ? Number(e.target.value) : undefined)}
                  >
                    <option value="">Never</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </select>
                </label>
                <div className={styles.dialogActions}>
                  <button className={styles.cancelBtn} onClick={handleCloseDialog}>Cancel</button>
                  <button className={styles.generateBtn} onClick={handleCreateKey} disabled={creating}>
                    {creating ? "Generating..." : "Generate key"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.dialogTitle}>Executor setup</div>
                <div className={styles.warning}>
                  This token will only be shown once. Run these commands on the executor machine.
                </div>
                <div className={styles.codeBlock}>
                  <pre className={styles.code}>{getStartupCommand()}</pre>
                  <button className={styles.copyBtn} onClick={handleCopy}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className={styles.dialogActions}>
                  <button className={styles.generateBtn} onClick={handleCloseDialog}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
