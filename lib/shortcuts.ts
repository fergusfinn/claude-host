/** Control-mode shortcut bindings — single keys, no modifiers needed */
export interface ShortcutMap {
  newTab: string;
  forkTab: string;
  dashboard: string;
  nextTab: string;
  prevTab: string;
  closeTab: string;
  refresh: string;
  splitH: string;
  splitV: string;
  plainSplitH: string;
  plainSplitV: string;
  breakPane: string;
  focusLeft: string;
  focusDown: string;
  focusUp: string;
  focusRight: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  newTab: "c",
  forkTab: "C",
  dashboard: "d",
  nextTab: "]",
  prevTab: "[",
  closeTab: "x",
  refresh: "r",
  splitH: "v",
  splitV: "s",
  plainSplitH: "V",
  plainSplitV: "S",
  breakPane: "b",
  focusLeft: "h",
  focusDown: "j",
  focusUp: "k",
  focusRight: "l",
};

export function loadShortcuts(json: string | undefined): ShortcutMap {
  if (!json) return { ...DEFAULT_SHORTCUTS };
  try {
    const overrides = JSON.parse(json);
    return { ...DEFAULT_SHORTCUTS, ...overrides };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

