import { describe, it, expect } from "vitest";
import { DEFAULT_SHORTCUTS, loadShortcuts, formatKey } from "./shortcuts";

describe("DEFAULT_SHORTCUTS", () => {
  it("has all expected keys", () => {
    expect(DEFAULT_SHORTCUTS.newTab).toBe("c");
    expect(DEFAULT_SHORTCUTS.forkTab).toBe("C");
    expect(DEFAULT_SHORTCUTS.dashboard).toBe("d");
    expect(DEFAULT_SHORTCUTS.nextTab).toBe("]");
    expect(DEFAULT_SHORTCUTS.prevTab).toBe("[");
    expect(DEFAULT_SHORTCUTS.closeTab).toBe("x");
    expect(DEFAULT_SHORTCUTS.splitH).toBe("v");
    expect(DEFAULT_SHORTCUTS.splitV).toBe("s");
    expect(DEFAULT_SHORTCUTS.focusLeft).toBe("h");
    expect(DEFAULT_SHORTCUTS.focusDown).toBe("j");
    expect(DEFAULT_SHORTCUTS.focusUp).toBe("k");
    expect(DEFAULT_SHORTCUTS.focusRight).toBe("l");
  });
});

describe("loadShortcuts", () => {
  it("returns defaults when given undefined", () => {
    const result = loadShortcuts(undefined);
    expect(result).toEqual(DEFAULT_SHORTCUTS);
    // Should be a copy, not the same object
    expect(result).not.toBe(DEFAULT_SHORTCUTS);
  });

  it("returns defaults for invalid JSON", () => {
    expect(loadShortcuts("not json")).toEqual(DEFAULT_SHORTCUTS);
  });

  it("merges overrides on top of defaults", () => {
    const result = loadShortcuts(JSON.stringify({ newTab: "t", closeTab: "q" }));
    expect(result.newTab).toBe("t");
    expect(result.closeTab).toBe("q");
    // Non-overridden keys remain default
    expect(result.dashboard).toBe("d");
    expect(result.focusLeft).toBe("h");
  });

  it("returns defaults for empty string", () => {
    expect(loadShortcuts("")).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe("formatKey", () => {
  it("uppercases a lowercase key", () => {
    expect(formatKey("c")).toBe("C");
  });

  it("keeps uppercase keys uppercase", () => {
    expect(formatKey("C")).toBe("C");
  });

  it("uppercases bracket keys", () => {
    expect(formatKey("[")).toBe("[");
    expect(formatKey("]")).toBe("]");
  });

  it("returns empty string for empty input", () => {
    expect(formatKey("")).toBe("");
  });
});
