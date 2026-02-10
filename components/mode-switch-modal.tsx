"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./dashboard.module.css";
import { DEFAULT_COMMAND } from "@/shared/constants";

interface Props {
  open: boolean;
  onSwitch: (mode: "terminal" | "rich", command: string) => void;
  onCancel: () => void;
}

export function ModeSwitchModal({ open, onSwitch, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [sessionType, setSessionType] = useState<"claude" | "custom">("claude");
  const [mode, setMode] = useState<"terminal" | "rich">("terminal");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [cmd, setCmd] = useState("");

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sessionType === "custom") {
      if (!cmd.trim()) return;
      onSwitch("terminal", cmd.trim());
    } else {
      const finalCmd = skipPermissions
        ? DEFAULT_COMMAND
        : "claude";
      onSwitch(mode, finalCmd);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onCancel}
    >
      {open && (
        <form onSubmit={handleSubmit}>
          <div className={styles.dialogHeader}>Switch mode</div>
          <div className={styles.dialogBody}>
            <div className={styles.modeToggle}>
              <button
                type="button"
                className={`${styles.modeOption} ${sessionType === "claude" ? styles.modeActive : ""}`}
                onClick={() => setSessionType("claude")}
              >
                Claude
              </button>
              <button
                type="button"
                className={`${styles.modeOption} ${sessionType === "custom" ? styles.modeActive : ""}`}
                onClick={() => setSessionType("custom")}
              >
                Custom
              </button>
            </div>
            {sessionType === "claude" && (
              <div className={styles.typeSection}>
                <div className={styles.subToggle}>
                  <button
                    type="button"
                    className={`${styles.modeOption} ${mode === "terminal" ? styles.modeActive : ""}`}
                    onClick={() => setMode("terminal")}
                  >
                    Terminal
                  </button>
                  <button
                    type="button"
                    className={`${styles.modeOption} ${mode === "rich" ? styles.modeActive : ""}`}
                    onClick={() => setMode("rich")}
                  >
                    Rich
                  </button>
                </div>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={(e) => setSkipPermissions(e.target.checked)}
                  />
                  Dangerously skip permissions
                </label>
              </div>
            )}
            {sessionType === "custom" && (
              <div className={styles.typeSection}>
                <input
                  type="text"
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  placeholder="Command (e.g. bash, python3)"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  className={styles.input}
                />
              </div>
            )}
          </div>
          <div className={styles.dialogFooter}>
            <div />
            <div className={styles.dialogFooterRight}>
              <button type="button" className="btn-ghost" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn-accent">
                Switch
              </button>
            </div>
          </div>
        </form>
      )}
    </dialog>
  );
}
