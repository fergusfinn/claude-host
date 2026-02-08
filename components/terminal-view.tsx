"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { type TerminalTheme, type TerminalFont, toXtermTheme } from "@/lib/themes";
import "@xterm/xterm/css/xterm.css";
import styles from "./terminal-view.module.css";

interface Props {
  sessionName: string;
  isActive: boolean;
  theme: TerminalTheme;
  font: TerminalFont;
  onClose: () => void;
  onSwitch: (name: string) => void;
}

export function TerminalView({ sessionName, isActive, theme, font, onClose, onSwitch }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let intentionalClose = false;
    let ws: WebSocket | null = null;

    import("@xterm/xterm").then(async ({ Terminal }) => {
      if (cancelled) return;
      const { FitAddon } = await import("@xterm/addon-fit");
      if (cancelled) return;

      const term = new Terminal({
        fontSize: 14,
        fontFamily: font.fontFamily,
        theme: toXtermTheme(theme),
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 0,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      // Handle OSC 52 clipboard sequences from tmux
      term.parser.registerOscHandler(52, (data) => {
        const idx = data.indexOf(";");
        if (idx === -1) return true;
        const b64 = data.slice(idx + 1);
        if (!b64 || b64 === "?") return true;
        try {
          navigator.clipboard.writeText(atob(b64)).catch(() => {});
        } catch {}
        return true;
      });

      const ro = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ resize: [term.cols, term.rows] }));
        }
      });
      ro.observe(container);

      // Register cleanup immediately after opening the terminal so it
      // can't be missed if React tears down during a later await.
      cleanupRef.current = () => {
        intentionalClose = true;
        ro.disconnect();
        ws?.close();
        term.dispose();
        container.innerHTML = "";
      };

      // If cleanup already ran while we were awaiting imports, tear down now.
      if (cancelled) {
        cleanupRef.current();
        cleanupRef.current = null;
        return;
      }

      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        term.loadAddon(new WebglAddon());
      } catch {}

      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      term.loadAddon(new WebLinksAddon());

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${proto}//${location.host}/ws/sessions/${encodeURIComponent(sessionName)}`
      );

      ws.onopen = () => {
        setError(null);
        ws!.send(JSON.stringify({ resize: [term.cols, term.rows] }));
      };

      ws.onmessage = (e) => {
        term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
      };

      ws.onclose = () => {
        if (!intentionalClose) setError("disconnected");
      };

      ws.onerror = () => {
        if (!intentionalClose) setError("connection error");
      };

      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      });

      termRef.current = term;
      term.focus();
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      termRef.current = null;
    };
  }, [sessionName]);

  // Re-focus terminal when this tab becomes active
  useEffect(() => {
    if (isActive) {
      termRef.current?.focus();
    }
  }, [isActive]);

  // Apply theme changes live
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = toXtermTheme(theme);
    }
  }, [theme]);

  // Apply font changes live
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontFamily = font.fontFamily;
    }
  }, [font]);

  return (
    <div className={styles.root} style={{ background: theme.background }}>
      {error && <div className={styles.errorBar}>{error}</div>}
      <div ref={containerRef} className={styles.container} />
    </div>
  );
}
