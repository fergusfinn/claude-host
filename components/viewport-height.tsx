"use client";

import { useEffect } from "react";

/**
 * On iOS PWA/Safari the virtual keyboard overlays content — `100dvh` doesn't
 * shrink when the keyboard opens. This component listens to visualViewport
 * resize events and sets a CSS custom property (--app-height) on <html> so
 * that body { height: var(--app-height, 100dvh) } tracks the actual visible
 * area.
 */
export function ViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      document.documentElement.style.setProperty(
        "--app-height",
        `${vv!.height}px`,
      );
    }

    vv.addEventListener("resize", update);
    update();
    return () => vv.removeEventListener("resize", update);
  }, []);

  return null;
}
