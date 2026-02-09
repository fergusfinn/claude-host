"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dashboard, SettingsForm } from "@/components/dashboard";
import { ExecutorsPage } from "@/components/executors-page";
import { PaneLayout } from "@/components/pane-layout";
import { TabBar } from "@/components/tab-bar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ModeSwitchModal } from "@/components/mode-switch-modal";
import { getThemeById, DEFAULT_DARK_THEME, type TerminalTheme, getFontById, DEFAULT_FONT_ID, type TerminalFont, ensureFontLoaded, getDefaultThemeForMode, themeToChromeVars } from "@/lib/themes";
import { generateName } from "@/lib/names";
import { loadShortcuts, type ShortcutMap } from "@/lib/shortcuts";
import {
  makeLeaf,
  makeEditorLeaf,
  splitPane as layoutSplitPane,
  splitPaneWithLeaf,
  removePane as layoutRemovePane,
  extractPane as layoutExtractPane,
  setRatio as layoutSetRatio,
  findNeighbor,
  findEditorLeaf,
  updateEditorFile,
  getAllLeaves,
  getLeafCount,
  type LayoutNode,
} from "@/lib/layout";

interface Session {
  name: string;
  alive: boolean;
  mode?: "terminal" | "rich";
  executor: string;
}

export interface TabState {
  id: string;
  layout: LayoutNode;
  focusedPaneId: string;
}

let _tabId = 0;
function newTabId(): string {
  return `tab-${Date.now()}-${_tabId++}`;
}

function createTab(sessionName: string): TabState {
  const leaf = makeLeaf(sessionName);
  return { id: newTabId(), layout: leaf, focusedPaneId: leaf.id };
}

export default function Home() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null); // null=dashboard, "executors"=executors page, else tab ID
  const [hydrated, setHydrated] = useState(false);

  // Read session from URL after hydration to avoid SSR/client mismatch
  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/executors") {
      setActiveTabId("executors");
    } else if (path !== "/") {
      const session = decodeURIComponent(path.slice(1));
      const tab = createTab(session);
      setTabs([tab]);
      setActiveTabId(tab.id);
    }
    setHydrated(true);
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveSessions, setLiveSessions] = useState<Session[] | null>(null);
  const [sessionModes, setSessionModes] = useState<Record<string, "terminal" | "rich">>({});
  const closedTabsRef = useRef<Set<string>>(new Set());
  const [theme, setTheme] = useState<TerminalTheme>(() => getThemeById(DEFAULT_DARK_THEME));
  const [font, setFont] = useState<TerminalFont>(() => getFontById(DEFAULT_FONT_ID));
  const [richFont, setRichFont] = useState("system");
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [keyMode, _setKeyMode] = useState<"insert" | "control">("insert");
  const keyModeRef = useRef<"insert" | "control">("insert");
  const setKeyMode = useCallback((m: "insert" | "control") => {
    keyModeRef.current = m;
    _setKeyMode(m);
  }, []);
  const controlTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showHints, setShowHints] = useState(true);
  const configRef = useRef<Record<string, string>>({});
  const openCreateRef = useRef<(() => void) | null>(null);
  const shortcutsRef = useRef<ShortcutMap>(loadShortcuts(undefined));

  // Derived: active tab object, all session names across all tabs
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeSessionName = activeTab
    ? getAllLeaves(activeTab.layout).find((l) => l.id === activeTab.focusedPaneId)?.sessionName ?? null
    : null;

  // Get all session names across all tab layouts
  function getAllTabSessions(): string[] {
    return tabs.flatMap((t) => getAllLeaves(t.layout).map((l) => l.sessionName));
  }

  // Restore saved preferences from server config
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config: Record<string, string>) => {
        configRef.current = config;
        shortcutsRef.current = loadShortcuts(config.shortcuts);
        if (config.showHints === "false") setShowHints(false);
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
        if (config.richFont) setRichFont(config.richFont);
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

  // Apply theme-derived chrome colors to the document root
  useEffect(() => {
    const vars = themeToChromeVars(theme);
    const el = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      el.style.setProperty(key, value);
    }
  }, [theme]);

  function handleModeChange(m: "dark" | "light") {
    setMode(m);
    document.documentElement.setAttribute("data-mode", m);
    if (theme.mode !== m) {
      const t = getDefaultThemeForMode(m);
      setTheme(t);
      saveConfig({ mode: m, theme: t.id });
    } else {
      saveConfig({ mode: m });
    }
  }

  const prevSessionsJsonRef = useRef("");
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data: Session[] = await res.json();
      // Skip state updates if data hasn't changed — avoids re-renders
      // that steal focus on mobile during tap interactions.
      const json = JSON.stringify(data);
      if (json === prevSessionsJsonRef.current) return;
      prevSessionsJsonRef.current = json;
      setLiveSessions(data.filter((s) => s.alive));
      const modes: Record<string, "terminal" | "rich"> = {};
      for (const s of data) {
        if (s.mode) modes[s.name] = s.mode;
      }
      setSessionModes(modes);
    } catch {}
  }, []);

  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Sync tabs with live sessions — add new ones, remove dead panes from layouts
  useEffect(() => {
    if (liveSessions === null) return;
    const aliveNames = new Set(liveSessions.map((s) => s.name));

    // Forget closed-tab memory for sessions that no longer exist
    for (const name of closedTabsRef.current) {
      if (!aliveNames.has(name)) closedTabsRef.current.delete(name);
    }

    setTabs((prev) => {
      // Get all session names currently in tabs
      const tabSessions = new Set(prev.flatMap((t) => getAllLeaves(t.layout).map((l) => l.sessionName)));

      // Remove dead panes from existing tabs
      let updated = prev.map((tab) => {
        const leaves = getAllLeaves(tab.layout);
        const deadLeaves = leaves.filter((l) => !aliveNames.has(l.sessionName));
        if (deadLeaves.length === 0) return tab;

        let layout: LayoutNode | null = tab.layout;
        for (const dead of deadLeaves) {
          if (!layout) break;
          layout = layoutRemovePane(layout, dead.id);
        }
        if (!layout) return null; // all panes dead → remove tab

        const remainingLeaves = getAllLeaves(layout);
        const focusedStillExists = remainingLeaves.some((l) => l.id === tab.focusedPaneId);
        return {
          ...tab,
          layout,
          focusedPaneId: focusedStillExists ? tab.focusedPaneId : remainingLeaves[0].id,
        };
      }).filter((t): t is TabState => t !== null);

      // Add new live sessions not already in tabs (unless user closed them)
      const updatedSessions = new Set(updated.flatMap((t) => getAllLeaves(t.layout).map((l) => l.sessionName)));
      const added: TabState[] = [];
      for (const s of liveSessions) {
        if (!updatedSessions.has(s.name) && !closedTabsRef.current.has(s.name)) {
          added.push(createTab(s.name));
        }
      }

      if (added.length === 0 && updated.length === prev.length &&
          updated.every((t, i) => t === prev[i])) {
        return prev;
      }
      return [...updated, ...added];
    });
  }, [liveSessions]);

  // If active tab got removed, switch to another (skip special pages)
  useEffect(() => {
    if (activeTabId !== null && activeTabId !== "executors" && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs.length > 0 ? tabs[tabs.length - 1].id : null);
    }
  }, [tabs, activeTabId]);

  // Sync URL when active tab changes
  useEffect(() => {
    if (activeTabId === "executors") {
      if (window.location.pathname !== "/executors") {
        window.history.replaceState(null, "", "/executors");
      }
    } else if (activeTab === null) {
      if (window.location.pathname !== "/") {
        window.history.replaceState(null, "", "/");
      }
    } else {
      // Use the first leaf's session name for URL
      const firstName = getAllLeaves(activeTab.layout)[0]?.sessionName;
      if (firstName) {
        const path = `/${encodeURIComponent(firstName)}`;
        if (window.location.pathname !== path) {
          window.history.replaceState(null, "", path);
        }
      }
    }
  }, [activeTab, activeTabId]);

  function connectSession(name: string, mode?: "terminal" | "rich") {
    // Eagerly update sessionModes so the pane renders the right view immediately
    if (mode) {
      setSessionModes((prev) => ({ ...prev, [name]: mode }));
    }
    closedTabsRef.current.delete(name);
    // Check if session already in a tab
    const existing = tabs.find((t) =>
      getAllLeaves(t.layout).some((l) => l.sessionName === name)
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab = createTab(name);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closePane(paneId?: string) {
    if (!activeTab) return;
    const targetPaneId = paneId ?? activeTab.focusedPaneId;
    const leaf = getAllLeaves(activeTab.layout).find((l) => l.id === targetPaneId);
    if (!leaf) return;

    // Editor panes: just remove from layout, don't kill any session
    if (leaf.editor) {
      closeEditorPane(targetPaneId);
      return;
    }

    const remaining = layoutRemovePane(activeTab.layout, targetPaneId);
    if (remaining === null) {
      // Last pane → close the tab
      closedTabsRef.current.add(leaf.sessionName);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== activeTab.id);
        if (activeTabId === activeTab.id) {
          const idx = prev.findIndex((t) => t.id === activeTab.id);
          const newActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
          setActiveTabId(newActive);
        }
        return next;
      });
    } else {
      // Collapse the layout, focus first remaining leaf
      const remainingLeaves = getAllLeaves(remaining);
      const focusedStillExists = remainingLeaves.some((l) => l.id === activeTab.focusedPaneId);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                layout: remaining,
                focusedPaneId: focusedStillExists ? t.focusedPaneId : remainingLeaves[0].id,
              }
            : t
        )
      );
    }

    // Kill the tmux session
    fetch(`/api/sessions/${encodeURIComponent(leaf.sessionName)}`, { method: "DELETE" })
      .then(() => loadSessions())
      .catch(() => {});
  }

  function closeEditorPane(paneId: string) {
    if (!activeTab) return;
    const remaining = layoutRemovePane(activeTab.layout, paneId);
    if (!remaining) return; // shouldn't happen — editor is never the only pane
    const remainingLeaves = getAllLeaves(remaining);
    const focusedStillExists = remainingLeaves.some((l) => l.id === activeTab.focusedPaneId);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, layout: remaining, focusedPaneId: focusedStillExists ? t.focusedPaneId : remainingLeaves[0].id }
          : t
      )
    );
  }

  function openFileInEditor(paneId: string, filePath: string) {
    if (!activeTab) return;

    // Reuse existing editor pane if one exists in this tab
    const existingEditor = findEditorLeaf(activeTab.layout);
    if (existingEditor) {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return { ...t, layout: updateEditorFile(t.layout, existingEditor.id, filePath), focusedPaneId: existingEditor.id };
        })
      );
      return;
    }

    // Create a new editor pane as a horizontal split
    const sourceLeaf = getAllLeaves(activeTab.layout).find((l) => l.id === paneId);
    const editorLeaf = makeEditorLeaf(sourceLeaf?.sessionName || "", filePath);
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        return { ...t, layout: splitPaneWithLeaf(t.layout, paneId, "h", editorLeaf), focusedPaneId: editorLeaf.id };
      })
    );
  }

  async function splitActivePane(direction: "h" | "v", fork = true) {
    if (!activeTab) return;
    const name = generateName();

    // Find the focused pane's session name to use as fork source
    const focusedLeaf = getAllLeaves(activeTab.layout).find(
      (l) => l.id === activeTab.focusedPaneId,
    );
    const sourceSession = focusedLeaf?.sessionName;

    try {
      let res: Response;
      if (fork && sourceSession) {
        // Fork from the focused pane's session (works for both terminal and rich)
        res = await fetch("/api/sessions/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: sourceSession, name }),
        });
      } else {
        // Fresh session
        const command = configRef.current.defaultCommand || "claude";
        res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: "", command }),
        });
      }
      if (!res.ok) return;
      // Read the created session's mode so the pane renders correctly
      const created = await res.json();
      if (created.mode) {
        setSessionModes((prev) => ({ ...prev, [name]: created.mode }));
      }
      await loadSessions();

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          const { root, newPaneId } = layoutSplitPane(
            t.layout,
            t.focusedPaneId,
            direction,
            name,
          );
          return { ...t, layout: root, focusedPaneId: newPaneId };
        })
      );
    } catch {}
  }

  function breakPane() {
    if (!activeTab) return;
    if (getLeafCount(activeTab.layout) <= 1) return; // already its own tab

    const { remaining, extracted } = layoutExtractPane(activeTab.layout, activeTab.focusedPaneId);
    if (!extracted || !remaining) return;

    const newTab = createTab(extracted.sessionName);

    setTabs((prev) => {
      const updated = prev.map((t) => {
        if (t.id !== activeTab.id) return t;
        const leaves = getAllLeaves(remaining);
        return { ...t, layout: remaining, focusedPaneId: leaves[0].id };
      });
      return [...updated, newTab];
    });
    setActiveTabId(newTab.id);
  }

  function navigateFocus(direction: "h" | "j" | "k" | "l") {
    if (!activeTab) return;
    const neighbor = findNeighbor(activeTab.layout, activeTab.focusedPaneId, direction);
    if (neighbor) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id ? { ...t, focusedPaneId: neighbor } : t
        )
      );
    }
  }

  function handlePaneFocus(paneId: string) {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, focusedPaneId: paneId } : t
      )
    );
  }

  function handlePaneResize(splitId: string, ratio: number) {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, layout: layoutSetRatio(t.layout, splitId, ratio) }
          : t
      )
    );
  }

  function closeTabById(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    // Kill all sessions in this tab
    const leaves = getAllLeaves(tab.layout);
    for (const leaf of leaves) {
      closedTabsRef.current.add(leaf.sessionName);
      fetch(`/api/sessions/${encodeURIComponent(leaf.sessionName)}`, { method: "DELETE" })
        .catch(() => {});
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
        setActiveTabId(newActive);
      }
      return next;
    });
    loadSessions();
  }

  function quickCreate() {
    setActiveTabId(null);
    // Small delay so Dashboard mounts before we trigger the ref
    setTimeout(() => openCreateRef.current?.(), 0);
  }

  async function forkNewTab() {
    if (!activeTab) return quickCreate();
    const focusedLeaf = getAllLeaves(activeTab.layout).find(
      (l) => l.id === activeTab.focusedPaneId,
    );
    if (!focusedLeaf) return quickCreate();

    const name = generateName();
    try {
      const res = await fetch("/api/sessions/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: focusedLeaf.sessionName, name }),
      });
      if (!res.ok) return;
      await loadSessions();
      connectSession(name);
    } catch {}
  }

  const [executorPickerOptions, setExecutorPickerOptions] = useState<Array<{ id: string; name: string }> | null>(null);

  async function quickCreateRich() {
    // Fetch online executors; if multiple, show a picker
    let onlineExecutors: Array<{ id: string; name: string; status: string }> = [];
    try {
      const execRes = await fetch("/api/executors");
      const executors: Array<{ id: string; name: string; status: string }> = await execRes.json();
      onlineExecutors = executors.filter((e) => e.status === "online");
    } catch {}

    if (onlineExecutors.length > 1) {
      setExecutorPickerOptions(onlineExecutors);
      return;
    }

    const executor = onlineExecutors.length === 1 ? onlineExecutors[0].id : "local";
    await doCreateRich(executor);
  }

  async function doCreateRich(executor: string) {
    const name = generateName();
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: "",
          command: "claude --dangerously-skip-permissions",
          executor,
          mode: "rich",
        }),
      });
      if (!res.ok) return;
      await loadSessions();
      connectSession(name, "rich");
    } catch {}
  }

  const [modeSwitchSession, setModeSwitchSession] = useState<string | null>(null);

  async function handleModeSwitch(newMode: "terminal" | "rich", command: string) {
    if (!modeSwitchSession) return;
    const name = modeSwitchSession;
    setModeSwitchSession(null);

    // If staying on rich mode, nothing to do
    if (newMode === "rich") return;

    try {
      // Delete existing rich session, recreate with new mode
      await fetch(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "", command, executor: "local", mode: newMode }),
      });
      if (!res.ok) return;
      setSessionModes((prev) => ({ ...prev, [name]: newMode }));
      setRefreshKey((k) => k + 1);
      await loadSessions();
    } catch {}
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sc = shortcutsRef.current;

      // Ctrl+A toggles control mode (like screen/tmux prefix)
      if (e.key === "a" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (controlTimeoutRef.current) clearTimeout(controlTimeoutRef.current);
        setKeyMode("control");
        return;
      }

      // Escape in control mode → back to insert
      if (e.key === "Escape" && keyModeRef.current === "control") {
        e.preventDefault();
        e.stopPropagation();
        if (controlTimeoutRef.current) clearTimeout(controlTimeoutRef.current);
        setKeyMode("insert");
        return;
      }

      if (keyModeRef.current !== "control") return;

      const key = e.key;
      const keyLower = key.toLowerCase();
      let handled = true;

      if (key === sc.forkTab) {
        forkNewTab();
      } else if (keyLower === sc.newTab) {
        quickCreate();
      } else if (keyLower === sc.dashboard) {
        setActiveTabId(null);
      } else if (keyLower === sc.closeTab && activeTab !== null) {
        closePane();
      } else if (keyLower === sc.nextTab || key === "ArrowRight") {
        const allIds: (string | null)[] = [null, ...tabs.map((t) => t.id)];
        const idx = allIds.indexOf(activeTabId);
        setActiveTabId(allIds[(idx + 1) % allIds.length]);
      } else if (keyLower === sc.prevTab || key === "ArrowLeft") {
        const allIds: (string | null)[] = [null, ...tabs.map((t) => t.id)];
        const idx = allIds.indexOf(activeTabId);
        setActiveTabId(allIds[(idx - 1 + allIds.length) % allIds.length]);
      } else if (keyLower === sc.refresh && activeTab !== null) {
        setRefreshKey((k) => k + 1);
      } else if (key === sc.plainSplitH && activeTab !== null) {
        splitActivePane("h", false);
      } else if (key === sc.plainSplitV && activeTab !== null) {
        splitActivePane("v", false);
      } else if (keyLower === sc.splitH && activeTab !== null) {
        splitActivePane("h");
      } else if (keyLower === sc.splitV && activeTab !== null) {
        splitActivePane("v");
      } else if (keyLower === sc.breakPane && activeTab !== null) {
        breakPane();
      } else if (keyLower === sc.focusLeft || keyLower === sc.focusDown || keyLower === sc.focusUp || keyLower === sc.focusRight) {
        if (activeTab !== null) {
          const dir = keyLower === sc.focusLeft ? "h" : keyLower === sc.focusDown ? "j" : keyLower === sc.focusUp ? "k" : "l";
          navigateFocus(dir);
        }
      } else {
        // 1-9 = switch to tab
        const n = parseInt(keyLower);
        if (n >= 1 && n <= 9 && n <= tabs.length) {
          setActiveTabId(tabs[n - 1].id);
        } else if (keyLower === "0") {
          setActiveTabId(null);
        } else {
          handled = false;
        }
      }

      if (handled) {
        // Only intercept keys we actually handle
        e.preventDefault();
        e.stopPropagation();
        // Reset cooldown — stay in control mode briefly so repeated
        // keys work (e.g. Ctrl+A ]]] to move 3 tabs right)
        if (controlTimeoutRef.current) clearTimeout(controlTimeoutRef.current);
        const ms = parseInt(configRef.current.prefixTimeout) || 800;
        controlTimeoutRef.current = setTimeout(() => setKeyMode("insert"), ms);
      } else {
        // Unrecognized key — exit control mode and let it pass through
        if (controlTimeoutRef.current) clearTimeout(controlTimeoutRef.current);
        setKeyMode("insert");
      }
    };

    // Use capture phase so we intercept before xterm
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [tabs, activeTabId, activeTab]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (settingsOpen) settingsRef.current?.showModal();
    else settingsRef.current?.close();
  }, [settingsOpen]);

  if (!configLoaded) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <div className="app-header">
        <div className="app-header-left" onClick={() => setActiveTabId(null)}>
          <div className="app-header-logo" />
          <span className="app-header-title">
            claude<span className="app-header-dim">/</span>host
          </span>
        </div>
        <div className="app-header-right">
          <button
            className={`app-header-settings ${activeTabId === "executors" ? "app-header-settings-active" : ""}`}
            onClick={() => setActiveTabId(activeTabId === "executors" ? null : "executors")}
            title="Executors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </button>
          <button
            className="app-header-settings"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        sessionExecutors={Object.fromEntries((liveSessions ?? []).map(s => [s.name, s.executor]))}
        currentTheme={theme}
        currentFont={font}
        keyMode={keyMode}
        showHints={showHints}
        onKeyModeChange={setKeyMode}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTabById}
        onNew={quickCreate}
        onReorderTab={(fromIndex, toIndex) => {
          setTabs((prev) => {
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            // Persist the new order to the database
            const names = next.flatMap((t) => getAllLeaves(t.layout).map((l) => l.sessionName));
            fetch("/api/sessions/reorder", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names }),
            }).catch(() => {});
            return next;
          });
        }}
        onThemeChange={handleThemeChange}
        onFontChange={handleFontChange}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        mode={mode}
        onModeChange={handleModeChange}
      />
      <MobileTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        currentTheme={theme}
        currentFont={font}
        keyMode={keyMode}
        onKeyModeChange={setKeyMode}
        onSelectTab={setActiveTabId}
        onNew={quickCreateRich}
        onThemeChange={handleThemeChange}
        onFontChange={handleFontChange}
        onRefresh={() => setRefreshKey((k) => k + 1)}
        mode={mode}
        onModeChange={handleModeChange}
        onOpenExecutors={() => setActiveTabId(activeTabId === "executors" ? null : "executors")}
        onCloseTab={closeTabById}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0,
          display: activeTabId === null ? "flex" : "none",
          flexDirection: "column",
        }}>
          <Dashboard onConnect={connectSession} openCreateRef={openCreateRef} />
        </div>
        <div style={{
          position: "absolute", inset: 0,
          display: activeTabId === "executors" ? "flex" : "none",
          flexDirection: "column",
        }}>
          <ExecutorsPage />
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: "absolute", inset: 0,
              display: "flex",
              flexDirection: "column",
              visibility: activeTabId === tab.id ? "visible" : "hidden",
              pointerEvents: activeTabId === tab.id ? "auto" : "none",
            }}
          >
            <PaneLayout
              layout={tab.layout}
              focusedPaneId={tab.focusedPaneId}
              isTabActive={activeTabId === tab.id}
              theme={theme}
              font={font}
              richFont={richFont}
              refreshKey={refreshKey}
              sessionModes={sessionModes}
              onFocusPane={handlePaneFocus}
              onResize={handlePaneResize}
              onCloseSession={(name) => {
                const leaf = getAllLeaves(tab.layout).find((l) => l.sessionName === name);
                if (leaf) closePane(leaf.id);
              }}
              onSwitchSession={connectSession}
              onOpenFile={openFileInEditor}
              onCloseEditor={closeEditorPane}
              onSwitchMode={(sessionName) => setModeSwitchSession(sessionName)}
            />
          </div>
        ))}
      </div>

      <dialog
        ref={settingsRef}
        className="settings-dialog"
        onClose={() => setSettingsOpen(false)}
      >
        {settingsOpen && (
          <SettingsForm
            config={configRef.current}
            onSave={async (updated) => {
              const res = await fetch("/api/config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated),
              });
              const newConfig = await res.json();
              configRef.current = newConfig;
              if ("showHints" in updated) setShowHints(updated.showHints !== "false");
              if ("richFont" in updated) setRichFont(updated.richFont);
              setSettingsOpen(false);
            }}
            onCancel={() => setSettingsOpen(false)}
          />
        )}
      </dialog>

      <ModeSwitchModal
        open={modeSwitchSession !== null}
        onSwitch={handleModeSwitch}
        onCancel={() => setModeSwitchSession(null)}
      />

      {executorPickerOptions && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--backdrop)", backdropFilter: "blur(2px)",
          }}
          onClick={() => setExecutorPickerOptions(null)}
        >
          <div
            style={{
              background: "var(--bg-2)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 4, width: "min(320px, calc(100vw - 32px))",
              boxShadow: "0 16px 64px var(--shadow-dialog)",
              fontFamily: "var(--mono)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "12px 12px 8px", fontSize: 13, fontWeight: 600, color: "var(--text-0)" }}>
              Select executor
            </div>
            {executorPickerOptions.map((ex) => (
              <button
                key={ex.id}
                style={{
                  display: "block", width: "100%", padding: "10px 12px",
                  background: "transparent", border: "none", borderRadius: 8,
                  fontFamily: "var(--mono)", fontSize: 13, color: "var(--text-1)",
                  textAlign: "left", cursor: "pointer",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-3)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                onClick={() => {
                  setExecutorPickerOptions(null);
                  doCreateRich(ex.id);
                }}
              >
                {ex.name}{ex.name !== ex.id ? ` (${ex.id})` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
