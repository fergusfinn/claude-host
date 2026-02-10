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

export function ExecutorsPage() {
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [upgrading, setUpgrading] = useState<Set<string>>(new Set());
  const logSinceRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

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
    const t = setInterval(() => {
      loadExecutors();
      loadLogs();
    }, 3000);
    return () => clearInterval(t);
  }, [loadExecutors, loadLogs]);

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

  const remoteOnline = executors.filter((e) => e.status === "online" && e.id !== "local");
  const hostVersion = executors.find((e) => e.id === "local")?.version;

  return (
    <div className={styles.root}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Executors{hostVersion && <span className={styles.hostVersion}>host {hostVersion}</span>}</span>
          {remoteOnline.length > 0 && (
            <button className={styles.upgradeBtn} onClick={handleUpgradeAll}>
              Upgrade all remote
            </button>
          )}
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
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
