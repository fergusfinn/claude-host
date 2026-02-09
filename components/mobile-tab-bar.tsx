"use client";

import { useState, useRef, useEffect } from "react";
import {
  themesForMode,
  fonts,
  type TerminalTheme,
  type TerminalFont,
  ensureFontLoaded,
} from "@/lib/themes";
import { RICH_FONT_OPTIONS, ensureRichFontLoaded } from "@/components/rich-view";
import { getAllLeaves } from "@/lib/layout";
import type { TabState } from "@/app/page";
import { Plus, RotateCw, Sun, Moon, X, EllipsisVertical, Server, Settings, RefreshCw } from "lucide-react";
import styles from "./mobile-tab-bar.module.css";

interface Props {
  tabs: TabState[];
  activeTabId: string | null;
  currentTheme: TerminalTheme;
  currentFont: TerminalFont;
  richFont?: string;
  keyMode: "insert" | "control";
  onKeyModeChange: (mode: "insert" | "control") => void;
  onSelectTab: (tabId: string | null) => void;
  onCloseTab: (tabId: string) => void;
  onNew: () => void;
  onThemeChange: (themeId: string) => void;
  onFontChange: (fontId: string) => void;
  onRichFontChange?: (fontId: string) => void;
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
  richFont = "system",
  keyMode,
  onKeyModeChange,
  onSelectTab,
  onCloseTab,
  onNew,
  onThemeChange,
  onFontChange,
  onRichFontChange,
  onRefresh,
  mode,
  onModeChange,
  onOpenExecutors,
  onOpenSettings,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<"none" | "fonts" | "richFonts" | "themes">("none");
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
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
        <Plus size={14} />
      </button>

      {/* Overflow menu */}
      <div className={styles.overflowWrap} ref={menuRef}>
        <button
          className={`${styles.overflowBtn} ${menuOpen ? styles.overflowBtnOpen : ""}`}
          onClick={() => { setMenuOpen(!menuOpen); setSubMenu("none"); }}
          title="Menu"
        >
          <EllipsisVertical size={14} />
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
                    <>
                      <button
                        className={styles.menuItem}
                        onClick={() => { onRefresh(); setMenuOpen(false); }}
                      >
                        <span className={styles.menuIcon}><RotateCw size={14} /></span>
                        <span className={styles.menuLabel}>Refresh terminal</span>
                      </button>
                      <button
                        className={`${styles.menuItem} ${confirmCloseId === activeTabId ? styles.menuItemDanger : ""}`}
                        onClick={() => {
                          if (confirmCloseId === activeTabId) {
                            onCloseTab(activeTabId);
                            setConfirmCloseId(null);
                            setMenuOpen(false);
                          } else {
                            setConfirmCloseId(activeTabId);
                            setTimeout(() => setConfirmCloseId(null), 2000);
                          }
                        }}
                      >
                        <span className={styles.menuIcon}><X size={14} /></span>
                        <span className={styles.menuLabel}>
                          {confirmCloseId === activeTabId ? "Tap again to close" : "Close tab"}
                        </span>
                      </button>
                    </>
                  )}
                  <button
                    className={styles.menuItem}
                    onClick={() => {
                      onModeChange(mode === "dark" ? "light" : "dark");
                      setMenuOpen(false);
                    }}
                  >
                    <span className={styles.menuIcon}>
                      {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                    </span>
                    <span className={styles.menuLabel}>
                      {mode === "dark" ? "Light mode" : "Dark mode"}
                    </span>
                  </button>
                  {onRichFontChange && (
                    <button
                      className={styles.menuItem}
                      onClick={() => {
                        Object.keys(RICH_FONT_OPTIONS).forEach(ensureRichFontLoaded);
                        setSubMenu("richFonts");
                      }}
                    >
                      <span className={styles.menuIcon} style={{ fontWeight: 600, fontSize: 13, fontStyle: "italic" }}>A</span>
                      <span className={styles.menuLabel}>UI Font</span>
                      <span className={styles.menuValue}>{RICH_FONT_OPTIONS[richFont]?.label ?? "System"}</span>
                    </button>
                  )}
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
                    <span className={styles.menuIcon}><Server size={14} /></span>
                    <span className={styles.menuLabel}>Executors</span>
                  </button>
                  <button
                    className={styles.menuItem}
                    onClick={() => { onOpenSettings(); setMenuOpen(false); }}
                  >
                    <span className={styles.menuIcon}><Settings size={14} /></span>
                    <span className={styles.menuLabel}>Settings</span>
                  </button>
                  <div className={styles.menuSep} />
                  <button
                    className={styles.menuItem}
                    onClick={() => window.location.reload()}
                  >
                    <span className={styles.menuIcon}><RefreshCw size={14} /></span>
                    <span className={styles.menuLabel}>Reload page</span>
                  </button>
                </>
              )}

              {subMenu === "richFonts" && onRichFontChange && (
                <>
                  <button
                    className={`${styles.menuItem} ${styles.menuBack}`}
                    onClick={() => setSubMenu("none")}
                  >
                    &#8592; UI Font
                  </button>
                  {Object.entries(RICH_FONT_OPTIONS).map(([id, opt]) => (
                    <button
                      key={id}
                      className={`${styles.menuItem} ${id === richFont ? styles.menuItemActive : ""}`}
                      onClick={() => {
                        onRichFontChange(id);
                        setSubMenu("none");
                        setMenuOpen(false);
                      }}
                    >
                      <span style={{ fontFamily: opt.fontFamily }}>{opt.label}</span>
                    </button>
                  ))}
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
