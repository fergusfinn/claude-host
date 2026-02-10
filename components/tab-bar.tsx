"use client";

import { useState, useRef, useEffect } from "react";
import { themesForMode, fonts, type TerminalTheme, type TerminalFont, ensureFontLoaded } from "@/lib/themes";
import { RICH_FONT_OPTIONS, ensureRichFontLoaded } from "@/components/rich-view";
import { getAllLeaves } from "@/lib/layout";
import { tabLabel } from "@/lib/ui-utils";
import type { TabState } from "@/app/page";
import { Plus, RotateCw, Sun, Moon, X, LogOut } from "lucide-react";
import styles from "./tab-bar.module.css";

interface Props {
  tabs: TabState[];
  activeTabId: string | null;
  sessionExecutors?: Record<string, string>;
  currentTheme: TerminalTheme;
  currentFont: TerminalFont;
  richFont: string;
  keyMode: "insert" | "control";
  showHints: boolean;
  userName?: string | null;
  onSignOut?: () => void;
  onKeyModeChange: (mode: "insert" | "control") => void;
  onSelectTab: (tabId: string | null) => void;
  onCloseTab: (tabId: string) => void;
  onNew: () => void;
  onReorderTab: (fromIndex: number, toIndex: number) => void;
  onThemeChange: (themeId: string) => void;
  onFontChange: (fontId: string) => void;
  onRichFontChange: (fontId: string) => void;
  onRefresh: () => void;
  mode: "dark" | "light";
  onModeChange: (mode: "dark" | "light") => void;
}

function tabExecutor(tab: TabState, sessionExecutors?: Record<string, string>): string | null {
  if (!sessionExecutors) return null;
  const leaves = getAllLeaves(tab.layout);
  const exec = sessionExecutors[leaves[0]?.sessionName];
  return exec && exec !== "local" ? exec : null;
}

export function TabBar({ tabs, activeTabId, sessionExecutors, currentTheme, currentFont, richFont, keyMode, showHints, userName, onSignOut, onKeyModeChange, onSelectTab, onCloseTab, onNew, onReorderTab, onThemeChange, onFontChange, onRichFontChange, onRefresh, mode, onModeChange }: Props) {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [richFontPickerOpen, setRichFontPickerOpen] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const fontPickerRef = useRef<HTMLDivElement>(null);
  const richFontPickerRef = useRef<HTMLDivElement>(null);

  // Close pickers on outside click
  useEffect(() => {
    if (!themePickerOpen && !fontPickerOpen && !richFontPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (themePickerOpen && themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false);
      }
      if (fontPickerOpen && fontPickerRef.current && !fontPickerRef.current.contains(e.target as Node)) {
        setFontPickerOpen(false);
      }
      if (richFontPickerOpen && richFontPickerRef.current && !richFontPickerRef.current.contains(e.target as Node)) {
        setRichFontPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [themePickerOpen, fontPickerOpen, richFontPickerOpen]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.bar}>
        <button
          className={`${styles.tab} ${activeTabId === null ? styles.active : ""}`}
          onClick={() => onSelectTab(null)}
          title="Dashboard (^A 0)"
        >
          <div className={styles.logoMark} />
          <span>dashboard</span>
          <kbd className={styles.kbd}>^A 0</kbd>
        </button>

        {tabs.map((tab, i) => {
          const exec = tabExecutor(tab, sessionExecutors);
          return (
          <div
            key={tab.id}
            className={`${styles.tab} ${activeTabId === tab.id ? styles.active : ""} ${draggingIndex === i ? styles.dragging : ""}`}
            role="tab"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              setDraggingIndex(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const midX = rect.left + rect.width / 2;
              const dropIndex = e.clientX < midX ? i : i + 1;
              setDragOverIndex(dropIndex);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
              setDragOverIndex(null);
              setDraggingIndex(null);
              if (isNaN(fromIndex)) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const midX = rect.left + rect.width / 2;
              let toIndex = e.clientX < midX ? i : i + 1;
              // Adjust for the removal of the source element
              if (fromIndex < toIndex) toIndex--;
              if (fromIndex !== toIndex) onReorderTab(fromIndex, toIndex);
            }}
            onDragEnd={() => {
              setDragOverIndex(null);
              setDraggingIndex(null);
            }}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTab(tab.id); } }}
            title={`${tabLabel(tab)}${exec ? ` (${exec})` : ""} (^A ${i + 1})`}
          >
            {dragOverIndex === i && <div className={styles.dropIndicator} />}
            <span className={styles.tabName}>{tabLabel(tab)}</span>
            {exec && <span className={styles.executorBadge}>{exec}</span>}
            {i < 9 && <kbd className={styles.kbd}>^A {i + 1}</kbd>}
            <button
              className={styles.closeBtn}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              title="Close tab"
            >
              <X size={12} />
            </button>
            {dragOverIndex === i + 1 && <div className={styles.dropIndicator} style={{ left: "auto", right: "-1px" }} />}
          </div>
          );
        })}

        <button
          className={styles.newBtn}
          onClick={onNew}
          title="New session (^A c)"
        >
          <Plus size={14} />
        </button>

        <div className={styles.spacer} />
      </div>

      {activeTabId !== null && (
        <button
          className={styles.refreshBtn}
          onClick={onRefresh}
          title="Re-render terminal"
        >
          <RotateCw size={14} />
        </button>
      )}

      <button
        className={styles.modeBtn}
        onClick={() => onModeChange(mode === "dark" ? "light" : "dark")}
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <div className={styles.themePicker} ref={richFontPickerRef}>
        <button
          className={styles.themeBtn}
          onClick={() => {
            if (!richFontPickerOpen) Object.keys(RICH_FONT_OPTIONS).forEach(ensureRichFontLoaded);
            setRichFontPickerOpen(!richFontPickerOpen);
            setFontPickerOpen(false);
            setThemePickerOpen(false);
          }}
          title={`UI Font: ${RICH_FONT_OPTIONS[richFont]?.label ?? "System"}`}
        >
          <span className={styles.fontIcon} style={{ fontStyle: "italic" }}>A</span>
          <span className={styles.themeName}>{RICH_FONT_OPTIONS[richFont]?.label ?? "System"}</span>
        </button>
        {richFontPickerOpen && (
          <div className={styles.themeDropdown}>
            {Object.entries(RICH_FONT_OPTIONS).map(([id, opt]) => (
              <button
                key={id}
                className={`${styles.themeOption} ${id === richFont ? styles.themeOptionActive : ""}`}
                onClick={() => {
                  onRichFontChange(id);
                  setRichFontPickerOpen(false);
                }}
              >
                <span className={styles.fontPreviewLabel} style={{ fontFamily: opt.fontFamily }}>{opt.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.themePicker} ref={fontPickerRef}>
        <button
          className={styles.themeBtn}
          onClick={() => {
            if (!fontPickerOpen) fonts.forEach(ensureFontLoaded);
            setFontPickerOpen(!fontPickerOpen);
            setRichFontPickerOpen(false);
            setThemePickerOpen(false);
          }}
          title={`Font: ${currentFont.name}`}
        >
          <span className={styles.fontIcon}>A</span>
          <span className={styles.themeName}>{currentFont.name}</span>
        </button>
        {fontPickerOpen && (
          <div className={styles.themeDropdown}>
            {fonts.map((f) => (
              <button
                key={f.id}
                className={`${styles.themeOption} ${f.id === currentFont.id ? styles.themeOptionActive : ""}`}
                onClick={() => {
                  onFontChange(f.id);
                  setFontPickerOpen(false);
                }}
              >
                <span className={styles.fontPreviewLabel} style={{ fontFamily: f.fontFamily }}>{f.name}</span>
                {!f.googleFontsUrl && <span className={styles.fontSystem}>system</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.themePicker} ref={themePickerRef}>
        <button
          className={styles.themeBtn}
          onClick={() => { setThemePickerOpen(!themePickerOpen); setFontPickerOpen(false); setRichFontPickerOpen(false); }}
          title={`Theme: ${currentTheme.name}`}
        >
          <span
            className={styles.themeSwatch}
            style={{ background: currentTheme.swatch }}
          />
          <span className={styles.themeName}>{currentTheme.name}</span>
        </button>
        {themePickerOpen && (
          <div className={styles.themeDropdown}>
            {themesForMode(mode).map((t) => (
              <button
                key={t.id}
                className={`${styles.themeOption} ${t.id === currentTheme.id ? styles.themeOptionActive : ""}`}
                onClick={() => {
                  onThemeChange(t.id);
                  setThemePickerOpen(false);
                }}
              >
                <span
                  className={styles.themeSwatch}
                  style={{ background: t.swatch }}
                />
                <span>{t.name}</span>
                <div className={styles.themePreview} style={{ background: t.background }}>
                  <span style={{ color: t.red }}>r</span>
                  <span style={{ color: t.green }}>g</span>
                  <span style={{ color: t.blue }}>b</span>
                  <span style={{ color: t.yellow }}>y</span>
                  <span style={{ color: t.magenta }}>m</span>
                  <span style={{ color: t.cyan }}>c</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {userName && (
        <div className={styles.userBadge}>
          <span className={styles.userName}>{userName}</span>
          {onSignOut && (
            <button className={styles.signOutBtn} onClick={onSignOut} title="Sign out">
              <LogOut size={12} />
            </button>
          )}
        </div>
      )}

      <div className={styles.modeWrap}>
        <button
          className={`${styles.modeIndicator} ${keyMode === "control" ? styles.modeControl : ""}`}
          onClick={() => onKeyModeChange(keyMode === "control" ? "insert" : "control")}
          title="Prefix: Ctrl+A"
        >
          {keyMode === "control" ? "PREFIX" : "INSERT"}
        </button>
        {keyMode === "control" && showHints && (
          <div className={styles.controlDropdown}>
            <div className={styles.controlRow}><kbd>c</kbd><span>new tab</span></div>
            <div className={styles.controlRow}><kbd>C</kbd><span>fork tab</span></div>
            <div className={styles.controlRow}><kbd>x</kbd><span>close pane</span></div>
            <div className={styles.controlRow}><kbd>d</kbd><span>dashboard</span></div>
            <div className={styles.controlRow}><kbd>[ ] ← →</kbd><span>cycle tabs</span></div>
            <div className={styles.controlRow}><kbd>0-9</kbd><span>go to tab</span></div>
            <div className={styles.controlRow}><kbd>r</kbd><span>refresh</span></div>
            <div className={styles.controlSep} />
            <div className={styles.controlRow}><kbd>v</kbd><span>fork split right</span></div>
            <div className={styles.controlRow}><kbd>s</kbd><span>fork split down</span></div>
            <div className={styles.controlRow}><kbd>V</kbd><span>split right</span></div>
            <div className={styles.controlRow}><kbd>S</kbd><span>split down</span></div>
            <div className={styles.controlRow}><kbd>b</kbd><span>break pane</span></div>
            <div className={styles.controlRow}><kbd>hjkl</kbd><span>navigate</span></div>
          </div>
        )}
      </div>

    </div>
  );
}
