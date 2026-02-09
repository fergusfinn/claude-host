"use client";

import { useEffect, useRef } from "react";
import type { TabState } from "@/app/page";

interface UseSwipeTabsOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tabs: TabState[];
  activeTabId: string | null;
  setActiveTabId: (id: string | null) => void;
}

/**
 * Adds edge-swipe tab switching on touch devices.
 *
 * Creates thin invisible strips (20px) at the left and right edges
 * of the container with `touch-action: none`. This prevents the
 * browser from initiating native scroll on those strips, giving
 * our JS touch handlers full control. Works reliably even over
 * scrollable children (xterm viewports, rich-view message lists).
 */
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

    const EDGE_WIDTH = 20; // px
    const SWIPE_THRESHOLD = 50;
    const SWIPE_MAX_TIME = 500;

    // Create edge strips
    function makeStrip(side: "left" | "right"): HTMLDivElement {
      const strip = document.createElement("div");
      strip.style.cssText = `
        position: absolute;
        top: 0;
        bottom: 0;
        ${side}: 0;
        width: ${EDGE_WIDTH}px;
        z-index: 50;
        touch-action: none;
      `;
      return strip;
    }

    const leftStrip = makeStrip("left");
    const rightStrip = makeStrip("right");
    container.appendChild(leftStrip);
    container.appendChild(rightStrip);

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const absDY = Math.abs(touch.clientY - startY);
      const absDX = Math.abs(touch.clientX - startX);

      if (absDY > absDX) {
        tracking = false;
        return;
      }
      // Horizontal movement on edge strip — prevent any default
      if (absDX > 5) {
        e.preventDefault();
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
        setActiveTabId(allIds[(idx + 1) % allIds.length]);
      } else {
        setActiveTabId(allIds[(idx - 1 + allIds.length) % allIds.length]);
      }
    }

    // Attach listeners to both edge strips
    for (const strip of [leftStrip, rightStrip]) {
      strip.addEventListener("touchstart", onTouchStart, { passive: true });
      strip.addEventListener("touchmove", onTouchMove, { passive: false });
      strip.addEventListener("touchend", onTouchEnd, { passive: true });
    }

    return () => {
      leftStrip.remove();
      rightStrip.remove();
    };
  }, [containerRef, setActiveTabId]);
}
