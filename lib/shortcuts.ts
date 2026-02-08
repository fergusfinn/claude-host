/** Control-mode shortcut bindings — single keys, no modifiers needed */
export interface ShortcutMap {
  newTab: string;
  dashboard: string;
  nextTab: string;
  prevTab: string;
  closeTab: string;
  refresh: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  newTab: "n",
  dashboard: "d",
  nextTab: "]",
  prevTab: "[",
  closeTab: "x",
  refresh: "r",
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

/** Format a single key for display */
export function formatKey(key: string): string {
  if (!key) return "";
  return key.toUpperCase();
}
