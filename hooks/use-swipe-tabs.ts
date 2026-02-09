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
    let decided = false;
    let isSwiping = false;

    const DECISION_DISTANCE = 10;
    const SWIPE_THRESHOLD = 50;
    const SWIPE_MAX_TIME = 400;
    const ANGLE_RATIO = 1.5;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
      decided = false;
      isSwiping = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      const absDX = Math.abs(deltaX);
      const absDY = Math.abs(deltaY);

      if (!decided) {
        const totalMove = Math.sqrt(absDX * absDX + absDY * absDY);
        if (totalMove < DECISION_DISTANCE) return;

        decided = true;
        if (absDX > absDY * ANGLE_RATIO) {
          isSwiping = true;
        } else {
          tracking = false;
          return;
        }
      }

      if (isSwiping) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking || !isSwiping) {
        tracking = false;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const elapsed = Date.now() - startTime;

      tracking = false;
      isSwiping = false;

      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
      if (elapsed > SWIPE_MAX_TIME) return;

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

      e.preventDefault();
      e.stopPropagation();
    }

    container.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

    return () => {
      container.removeEventListener("touchstart", onTouchStart, true);
      container.removeEventListener("touchmove", onTouchMove, true);
      container.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [containerRef, setActiveTabId]);
}
