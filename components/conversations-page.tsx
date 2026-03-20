"use client";

import { useState, useEffect, useCallback } from "react";
import { activityAgo } from "@/lib/ui-utils";
import styles from "./conversations-page.module.css";

interface ClosedConversation {
  name: string;
  description: string;
  provider: string;
  created_at: string;
  last_activity: number;
  message_count: number;
  total_cost: number;
  executor: string;
  parent: string | null;
}

export function ConversationsPage({ onReopen }: { onReopen: (name: string) => void }) {
  const [conversations, setConversations] = useState<ClosedConversation[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setConversations(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReopen(name: string) {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/reopen`, { method: "POST" });
      if (res.ok) {
        onReopen(name);
        load();
      }
    } catch {}
  }

  async function handleDelete(name: string) {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
      setConfirmDelete(null);
      load();
    } catch {}
  }

  function formatCost(cost: number): string {
    if (cost === 0) return "";
    return `$${cost.toFixed(2)}`;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>
          Conversations
          {conversations.length > 0 && (
            <span className={styles.count}>{conversations.length}</span>
          )}
        </span>
      </div>
      {conversations.length === 0 ? (
        <div className={styles.empty}>
          <p>No closed conversations yet</p>
          <p>When you close a rich session, it will appear here for later browsing</p>
        </div>
      ) : (
        <div className={styles.list}>
          {conversations.map((c) => (
            <div key={c.name} className={styles.row} onClick={() => handleReopen(c.name)}>
              <div className={styles.rowMain}>
                <div className={styles.rowLeft}>
                  <span className={styles.name}>{c.name}</span>
                  {c.message_count > 0 && (
                    <span className={styles.msgCount}>
                      {c.message_count} {c.message_count === 1 ? "message" : "messages"}
                    </span>
                  )}
                </div>
                <div className={styles.rowRight}>
                  {c.total_cost > 0 && (
                    <span className={styles.costBadge}>{formatCost(c.total_cost)}</span>
                  )}
                  <span className={styles.meta}>{activityAgo(c.last_activity)}</span>
                  <div className={styles.actions}>
                    <button
                      className={styles.reopenBtn}
                      onClick={(e) => { e.stopPropagation(); handleReopen(c.name); }}
                    >
                      Resume
                    </button>
                    {confirmDelete === c.name ? (
                      <button
                        className={styles.deleteBtn}
                        style={{ color: "var(--danger)", background: "var(--danger-dim)" }}
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.name); }}
                      >
                        Confirm
                      </button>
                    ) : (
                      <button
                        className={styles.deleteBtn}
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(c.name); }}
                        title="Delete permanently"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {c.description && <div className={styles.desc}>{c.description}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
