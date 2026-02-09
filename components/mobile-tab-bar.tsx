"use client";

import { useState, useRef, useEffect } from "react";
import {
  themesForMode,
  fonts,
  type TerminalTheme,
  type TerminalFont,
  ensureFontLoaded,
} from "@/lib/themes";
import { getAllLeaves } from "@/lib/layout";
import type { TabState } from "@/app/page";
import styles from "./mobile-tab-bar.module.css";

interface Props {
  tabs: TabState[];
  activeTabId: string | null;
  currentTheme: TerminalTheme;
  currentFont: TerminalFont;
  keyMode: "insert" | "control";
  onKeyModeChange: (mode: "insert" | "control") => void;
  onSelectTab: (tabId: string | null) => void;
  onNew: () => void;
  onThemeChange: (themeId: string) => void;
  onFontChange: (fontId: string) => void;
  onRefresh: () => void;
  mode: "dark" | "light";
  onModeChange: (mode: "dark" | "light") => void;
  onOpenExecutors: () => void;
  onOpenSettings: () => void;
}

function tabLabel(tab: TabState): string {
  const leaves = getAllLeaves(tab.layout);
  if (leaves.length === 1) return leaves[0].sessionName;
  return `${leaves[0].sessionName} +${leaves.length - 1}`;
}

export function MobileTabBar({
  tabs,
  activeTabId,
  currentTheme,
  currentFont,
  keyMode,
  onKeyModeChange,
  onSelectTab,
  onNew,
  onThemeChange,
  onFontChange,
  onRefresh,
  mode,
  onModeChange,
  onOpenExecutors,
  onOpenSettings,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<"none" | "fonts" | "themes">("none");
  const menuRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active tab
  useEffect(() => {
    if (!tabStripRef.current) return;
    const activeEl = tabStripRef.current.querySelector(
      `.${styles.tabActive}`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [activeTabId]);

  return (
    <div className={styles.mobileWrapper}>
      {/* Logo / dashboard button */}
      <button
        className={`${styles.logoBtn} ${activeTabId === null ? styles.logoBtnActive : ""}`}
        onClick={() => { onSelectTab(null); setMenuOpen(false); }}
        title="Dashboard"
      >
        <div className={styles.logoMark} />
      </button>

      {/* Scrollable tab strip */}
      <div className={styles.tabStrip} ref={tabStripRef}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTabId === tab.id ? styles.tabActive : ""}`}
            onClick={() => { onSelectTab(tab.id); setMenuOpen(false); }}
          >
            <span className={styles.dot} />
            <span className={styles.tabName}>{tabLabel(tab)}</span>
          </button>
        ))}
      </div>

      {/* New tab button */}
      <button
        className={styles.newBtn}
        onClick={() => { onNew(); setMenuOpen(false); }}
        title="New session"
      >
        +
      </button>

      {/* Overflow menu */}
      <div className={styles.overflowWrap} ref={menuRef}>
        <button
          className={`${styles.overflowBtn} ${menuOpen ? styles.overflowBtnOpen : ""}`}
          onClick={() => { setMenuOpen(!menuOpen); setSubMenu("none"); }}
          title="Menu"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        {menuOpen && (
          <>
            <div
              className={styles.backdrop}
              onClick={() => { setMenuOpen(false); setSubMenu("none"); }}
            />
            <div className={styles.overflowMenu}>
              {subMenu === "none" && (
                <>
                  {activeTabId !== null && activeTabId !== "executors" && (
                    <button
                      className={styles.menuItem}
                      onClick={() => { onRefresh(); setMenuOpen(false); }}
                    >
                      <span className={styles.menuIcon}>&#x21bb;</span>
                      <span className={styles.menuLabel}>Refresh terminal</span>
                    </button>
                  )}
                  <button
                    className={styles.menuItem}
                    onClick={() => {
                      onModeChange(mode === "dark" ? "light" : "dark");
                      setMenuOpen(false);
                    }}
                  >
                    <span className={styles.menuIcon}>
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
                    </span>
                    <span className={styles.menuLabel}>
                      {mode === "dark" ? "Light mode" : "Dark mode"}
                    </span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => {
                      fonts.forEach(ensureFontLoaded);
                      setSubMenu("fonts");
                    }}
                  >
                    <span className={styles.menuIcon} style={{ fontWeight: 600, fontSize: 13 }}>A</span>
                    <span className={styles.menuLabel}>Font</span>
                    <span className={styles.menuValue}>{currentFont.name}</span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => setSubMenu("themes")}
                  >
                    <span
                      className={styles.themeSwatch}
                      style={{ background: currentTheme.swatch }}
                    />
                    <span className={styles.menuLabel}>Theme</span>
                    <span className={styles.menuValue}>{currentTheme.name}</span>
                  </button>
                  <div className={styles.menuSep} />
                  <button
                    className={styles.menuItem}
                    onClick={() => {
                      onKeyModeChange(keyMode === "control" ? "insert" : "control");
                    }}
                  >
                    <span className={styles.menuLabel}>Key mode</span>
                    <span className={`${styles.modeIndicator} ${keyMode === "control" ? styles.modeControl : ""}`}>
                      {keyMode === "control" ? "PREFIX" : "INSERT"}
                    </span>
                  </button>
                  <div className={styles.menuSep} />
                  <button
                    className={styles.menuItem}
                    onClick={() => { onOpenExecutors(); setMenuOpen(false); }}
                  >
                    <span className={styles.menuIcon}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                        <line x1="6" y1="6" x2="6.01" y2="6" />
                        <line x1="6" y1="18" x2="6.01" y2="18" />
                      </svg>
                    </span>
                    <span className={styles.menuLabel}>Executors</span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => { onOpenSettings(); setMenuOpen(false); }}
                  >
                    <span className={styles.menuIcon}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                      </svg>
                    </span>
                    <span className={styles.menuLabel}>Settings</span>
                  </button>
                </>
              )}

              {subMenu === "fonts" && (
                <>
                  <button
                    className={`${styles.menuItem} ${styles.menuBack}`}
                    onClick={() => setSubMenu("none")}
                  >
                    &#8592; Fonts
                  </button>
                  {fonts.map((f) => (
                    <button
                      key={f.id}
                      className={`${styles.menuItem} ${f.id === currentFont.id ? styles.menuItemActive : ""}`}
                      onClick={() => {
                        onFontChange(f.id);
                        setSubMenu("none");
                        setMenuOpen(false);
                      }}
                    >
                      <span style={{ fontFamily: f.fontFamily }}>{f.name}</span>
                      {!f.googleFontsUrl && <span className={styles.fontSystem}>system</span>}
                    </button>
                  ))}
                </>
              )}

              {subMenu === "themes" && (
                <>
                  <button
                    className={`${styles.menuItem} ${styles.menuBack}`}
                    onClick={() => setSubMenu("none")}
                  >
                    &#8592; Themes
                  </button>
                  {themesForMode(mode).map((t) => (
                    <button
                      key={t.id}
                      className={`${styles.menuItem} ${t.id === currentTheme.id ? styles.menuItemActive : ""}`}
                      onClick={() => {
                        onThemeChange(t.id);
                        setSubMenu("none");
                        setMenuOpen(false);
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
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
