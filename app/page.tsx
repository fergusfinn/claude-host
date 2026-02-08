"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dashboard } from "@/components/dashboard";
import { TerminalView } from "@/components/terminal-view";
import { TabBar } from "@/components/tab-bar";
import { getThemeById, DEFAULT_DARK_THEME, type TerminalTheme, getFontById, DEFAULT_FONT_ID, type TerminalFont, ensureFontLoaded, getDefaultThemeForMode } from "@/lib/themes";
import { generateName } from "@/lib/names";
import { loadShortcuts, type ShortcutMap } from "@/lib/shortcuts";

interface Session {
  name: string;
  alive: boolean;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read session from URL after hydration to avoid SSR/client mismatch
  useEffect(() => {
    const path = window.location.pathname;
    if (path !== "/") {
      const session = decodeURIComponent(path.slice(1));
      setActiveTab(session);
      setOpenTabs([session]);
    }
    setHydrated(true);
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveSessions, setLiveSessions] = useState<Session[] | null>(null);
  const closedTabsRef = useRef<Set<string>>(new Set());
  const [theme, setTheme] = useState<TerminalTheme>(() => getThemeById(DEFAULT_DARK_THEME));
  const [font, setFont] = useState<TerminalFont>(() => getFontById(DEFAULT_FONT_ID));
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [keyMode, setKeyMode] = useState<"insert" | "control">("insert");
  const configRef = useRef<Record<string, string>>({});
  const shortcutsRef = useRef<ShortcutMap>(loadShortcuts(undefined));

  // Restore saved preferences from server config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config: Record<string, string>) => {
        configRef.current = config;
        shortcutsRef.current = loadShortcuts(config.shortcuts);
        if (config.mode === "light" || config.mode === "dark") {
          setMode(config.mode);
          document.documentElement.setAttribute("data-mode", config.mode);
        }
        if (config.theme) setTheme(getThemeById(config.theme));
        if (config.font) {
          const f = getFontById(config.font);
          ensureFontLoaded(f);
          setFont(f);
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }, []);

  function saveConfig(updates: Record<string, string>) {
    Object.assign(configRef.current, updates);
    fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).catch(() => {});
  }

  function handleThemeChange(themeId: string) {
    const t = getThemeById(themeId);
    setTheme(t);
    saveConfig({ theme: themeId });
  }

  function handleFontChange(fontId: string) {
    const f = getFontById(fontId);
    ensureFontLoaded(f);
    setFont(f);
    saveConfig({ font: fontId });
  }

  function handleModeChange(m: "dark" | "light") {
    setMode(m);
    document.documentElement.setAttribute("data-mode", m);
    // Auto-switch terminal theme if current one doesn't match the new mode
    if (theme.mode !== m) {
      const t = getDefaultThemeForMode(m);
      setTheme(t);
      saveConfig({ mode: m, theme: t.id });
    } else {
      saveConfig({ mode: m });
    }
  }

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data: Session[] = await res.json();
      setLiveSessions(data.filter((s) => s.alive));
    } catch {}
  }, []);

  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Sync tabs with live sessions — add new ones, remove dead ones
  useEffect(() => {
    if (liveSessions === null) return; // wait for first fetch
    const aliveNames = liveSessions.map((s) => s.name);
    const aliveSet = new Set(aliveNames);

    // Forget closed-tab memory for sessions that no longer exist
    for (const name of closedTabsRef.current) {
      if (!aliveSet.has(name)) closedTabsRef.current.delete(name);
    }

    setOpenTabs((prev) => {
      // Keep existing tabs that are still alive, in their current order
      const kept = prev.filter((t) => aliveSet.has(t));
      // Add any new live sessions not already in tabs (unless user closed them)
      const keptSet = new Set(kept);
      const added = aliveNames.filter(
        (n) => !keptSet.has(n) && !closedTabsRef.current.has(n)
      );
      if (added.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...added];
    });
  }, [liveSessions]);

  // Sync URL when activeTab changes
  useEffect(() => {
    const path = activeTab === null ? "/" : `/${encodeURIComponent(activeTab)}`;
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [activeTab]);

  function connectSession(name: string) {
    closedTabsRef.current.delete(name);
    if (!openTabs.includes(name)) {
      setOpenTabs((prev) => [...prev, name]);
    }
    setActiveTab(name);
  }

  function closeTab(name: string) {
    closedTabsRef.current.add(name);
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== name);
      if (activeTab === name) {
        // Switch to the adjacent tab, or back to dashboard
        const idx = prev.indexOf(name);
        const newActive = next[Math.min(idx, next.length - 1)] ?? null;
        setActiveTab(newActive);
      }
      return next;
    });
    // Kill the tmux session
    fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" })
      .then(() => loadSessions())
      .catch(() => {});
  }

  async function quickCreate() {
    const name = generateName();
    const command = configRef.current.defaultCommand || "claude";
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "", command }),
      });
      if (!res.ok) return;
      await loadSessions();
      connectSession(name);
    } catch {}
  }

  // Modal keyboard shortcuts: Ctrl+Space toggles control mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sc = shortcutsRef.current;

      // Ctrl+A toggles control mode (like screen/tmux prefix)
      if (e.key === "a" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        setKeyMode(keyMode === "control" ? "insert" : "control");
        return;
      }

      // Escape in control mode → back to insert
      if (e.key === "Escape" && keyMode === "control") {
        e.preventDefault();
        e.stopPropagation();
        setKeyMode("insert");
        return;
      }

      if (keyMode !== "control") return;

      // In control mode, intercept all keys
      e.preventDefault();
      e.stopPropagation();

      const key = e.key.toLowerCase();
      let handled = true;

      if (key === sc.newTab) {
        quickCreate();
      } else if (key === sc.dashboard) {
        setActiveTab(null);
      } else if (key === sc.closeTab && activeTab !== null) {
        closeTab(activeTab);
      } else if (key === sc.nextTab) {
        const all: (string | null)[] = [null, ...openTabs];
        const idx = all.indexOf(activeTab);
        setActiveTab(all[(idx + 1) % all.length]);
      } else if (key === sc.prevTab) {
        const all: (string | null)[] = [null, ...openTabs];
        const idx = all.indexOf(activeTab);
        setActiveTab(all[(idx - 1 + all.length) % all.length]);
      } else if (key === sc.refresh && activeTab !== null) {
        setRefreshKey((k) => k + 1);
      } else {
        // 1-9 = switch to tab
        const n = parseInt(key);
        if (n >= 1 && n <= 9 && n <= openTabs.length) {
          setActiveTab(openTabs[n - 1]);
        } else if (key === "0") {
          setActiveTab(null);
        } else {
          handled = false;
        }
      }

      // Return to insert mode after any recognized action
      if (handled) setKeyMode("insert");
    };

    // Use capture phase so we intercept before xterm
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [openTabs, activeTab, keyMode]);

  if (!configLoaded) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TabBar
        activeTab={activeTab}
        openTabs={openTabs}
        currentTheme={theme}
        currentFont={font}
        keyMode={keyMode}
        onKeyModeChange={setKeyMode}
        onSelect={setActiveTab}
        onClose={closeTab}
        onNew={quickCreate}
        onThemeChange={handleThemeChange}
        onFontChange={handleFontChange}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        mode={mode}
        onModeChange={handleModeChange}
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0,
          display: activeTab === null ? "flex" : "none",
          flexDirection: "column",
        }}>
          <Dashboard onConnect={connectSession} />
        </div>
        {openTabs.map((name) => (
          <div
            key={`${name}-${refreshKey}`}
            style={{
              position: "absolute", inset: 0,
              display: activeTab === name ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <TerminalView
              sessionName={name}
              isActive={activeTab === name}
              theme={theme}
              font={font}
              onClose={() => closeTab(name)}
              onSwitch={connectSession}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
