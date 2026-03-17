"use client";

import { useState, useEffect } from "react";

/**
 * On iOS PWA/Safari the virtual keyboard overlays content rather than
 * resizing the viewport. This hook returns the current keyboard height
 * (in px) so callers can add bottom padding to keep input bars visible.
 *
 * Returns 0 on platforms where the keyboard resizes the viewport normally.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      // keyboard height = full viewport minus visible portion
      const kb = window.innerHeight - vv!.height - vv!.offsetTop;
      setInset(Math.max(0, Math.round(kb)));
    }

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
