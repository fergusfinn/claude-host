"use client";

import { useCallback, useRef } from "react";

interface Props {
  direction: "h" | "v"; // h = vertical divider (side-by-side), v = horizontal divider (stacked)
  splitId: string;
  onResize: (splitId: string, ratio: number) => void;
}

export function ResizeHandle({ direction, splitId, onResize }: Props) {
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const handle = e.target as HTMLElement;
      const parent = handle.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      // The first child element is the "first pane" container
      const firstChild = parent.children[0] as HTMLElement;
      if (!firstChild) return;

      handle.style.background = "var(--accent)";

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        let ratio: number;
        if (direction === "h") {
          ratio = (ev.clientX - rect.left) / rect.width;
        } else {
          ratio = (ev.clientY - rect.top) / rect.height;
        }
        ratio = Math.min(0.9, Math.max(0.1, ratio));
        // Manipulate DOM directly during drag — no React re-render
        firstChild.style.flex = `0 0 calc(${ratio * 100}% - 2px)`;
        // Store latest ratio for commit on mouseup
        (handle as any).__pendingRatio = ratio;
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        handle.style.background = "var(--border)";
        // Commit final ratio to React state once
        const finalRatio = (handle as any).__pendingRatio;
        if (finalRatio !== undefined) {
          onResize(splitId, finalRatio);
          delete (handle as any).__pendingRatio;
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = direction === "h" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, splitId, onResize],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width: direction === "h" ? 4 : "100%",
        height: direction === "v" ? 4 : "100%",
        cursor: direction === "h" ? "col-resize" : "row-resize",
        background: "var(--border)",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.target as HTMLElement).style.background = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!dragging.current) {
          (e.target as HTMLElement).style.background = "var(--border)";
        }
      }}
    />
  );
}
