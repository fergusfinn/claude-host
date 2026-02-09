"use client";

import { useEffect, useRef } from "react";
import type { TabState } from "@/app/page";

interface UseSwipeTabsOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tabs: TabState[];
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
}

export function useSwipeTabs({
  containerRef,
  tabs,
  activeTabId,
  setActiveTabId,
}: UseSwipeTabsOptions) {
  const stateRef = useRef({ tabs, activeTabId });
  stateRef.current = { tabs, activeTabId };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only enable on touch devices
    if (!("ontouchstart" in window)) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    // Edge swipe: only initiate from within 24px of screen edges.
    // This avoids conflicting with xterm.js touch scrolling and
    // rich-view interactions, since those happen in the middle of
    // the screen.
    const EDGE_ZONE = 24;
    const SWIPE_THRESHOLD = 50;
    const SWIPE_MAX_TIME = 500;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const screenWidth = window.innerWidth;

      // Only track touches starting near screen edges
      if (touch.clientX > EDGE_ZONE && touch.clientX < screenWidth - EDGE_ZONE) return;

      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const absDX = Math.abs(touch.clientX - startX);
      const absDY = Math.abs(touch.clientY - startY);

      // If it's clearly a horizontal swipe from the edge, prevent
      // default to stop the browser/xterm from also handling it
      if (absDX > 10 && absDX > absDY * 1.5) {
        e.preventDefault();
      } else if (absDY > absDX) {
        // Vertical gesture — stop tracking
        tracking = false;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const absDY = Math.abs(touch.clientY - startY);
      const elapsed = Date.now() - startTime;

      tracking = false;

      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
      if (elapsed > SWIPE_MAX_TIME) return;
      if (absDY > Math.abs(deltaX)) return;

      const { tabs: currentTabs, activeTabId: currentActive } = stateRef.current;
      const allIds: (string | null)[] = [null, ...currentTabs.map((t) => t.id)];
      const idx = allIds.indexOf(currentActive);

      if (deltaX < 0) {
        // Swipe left -> next tab
        setActiveTabId(allIds[(idx + 1) % allIds.length]);
      } else {
        // Swipe right -> previous tab
        setActiveTabId(allIds[(idx - 1 + allIds.length) % allIds.length]);
      }
    }

    // Use capture phase to fire before xterm's listeners
    container.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart, true);
      container.removeEventListener("touchmove", onTouchMove, true);
      container.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [containerRef, setActiveTabId]);
}
