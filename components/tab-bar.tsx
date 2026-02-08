"use client";

import { useState, useRef, useEffect } from "react";
import { themesForMode, fonts, type TerminalTheme, type TerminalFont, ensureFontLoaded } from "@/lib/themes";
import { getAllLeaves, getLeafCount } from "@/lib/layout";
import type { TabState } from "@/app/page";
import styles from "./tab-bar.module.css";

interface Props {
  tabs: TabState[];
  activeTabId: string | null;
  sessionExecutors?: Record<string, string>;
  currentTheme: TerminalTheme;
  currentFont: TerminalFont;
  keyMode: "insert" | "control";
  showHints: boolean;
  onKeyModeChange: (mode: "insert" | "control") => void;
  onSelectTab: (tabId: string | null) => void;
  onCloseTab: (tabId: string) => void;
  onNew: () => void;
  onThemeChange: (themeId: string) => void;
  onFontChange: (fontId: string) => void;
  onRefresh: () => void;
  mode: "dark" | "light";
  onModeChange: (mode: "dark" | "light") => void;
}

function tabLabel(tab: TabState): string {
  const leaves = getAllLeaves(tab.layout);
  if (leaves.length === 1) return leaves[0].sessionName;
  return `${leaves[0].sessionName} +${leaves.length - 1}`;
}

function tabExecutor(tab: TabState, sessionExecutors?: Record<string, string>): string | null {
  if (!sessionExecutors) return null;
  const leaves = getAllLeaves(tab.layout);
  const exec = sessionExecutors[leaves[0]?.sessionName];
  return exec && exec !== "local" ? exec : null;
}

export function TabBar({ tabs, activeTabId, sessionExecutors, currentTheme, currentFont, keyMode, showHints, onKeyModeChange, onSelectTab, onCloseTab, onNew, onThemeChange, onFontChange, onRefresh, mode, onModeChange }: Props) {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const fontPickerRef = useRef<HTMLDivElement>(null);

  // Close pickers on outside click
  useEffect(() => {
    if (!themePickerOpen && !fontPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (themePickerOpen && themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false);
      }
      if (fontPickerOpen && fontPickerRef.current && !fontPickerRef.current.contains(e.target as Node)) {
        setFontPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [themePickerOpen, fontPickerOpen]);

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
            className={`${styles.tab} ${activeTabId === tab.id ? styles.active : ""}`}
            role="tab"
            tabIndex={0}
            onClick={() => onSelectTab(tab.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectTab(tab.id); } }}
            title={`${tabLabel(tab)}${exec ? ` (${exec})` : ""} (^A ${i + 1})`}
          >
            <div className={styles.dot} />
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
              ×
            </button>
          </div>
          );
        })}

        <button
          className={styles.newBtn}
          onClick={onNew}
          title="New session (^A c)"
        >
          +
        </button>

        <div className={styles.spacer} />
      </div>

      {activeTabId !== null && (
        <button
          className={styles.refreshBtn}
          onClick={onRefresh}
          title="Re-render terminal"
        >
          &#x21bb;
        </button>
      )}

      <button
        className={styles.modeBtn}
        onClick={() => onModeChange(mode === "dark" ? "light" : "dark")}
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {mode === "dark" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <div className={styles.themePicker} ref={fontPickerRef}>
        <button
          className={styles.themeBtn}
          onClick={() => {
            if (!fontPickerOpen) fonts.forEach(ensureFontLoaded);
            setFontPickerOpen(!fontPickerOpen);
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
          onClick={() => { setThemePickerOpen(!themePickerOpen); setFontPickerOpen(false); }}
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
            <div className={styles.controlRow}><kbd>[ ]</kbd><span>cycle tabs</span></div>
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
