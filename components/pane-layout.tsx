"use client";

import { memo } from "react";
import type { LayoutNode } from "@/lib/layout";
import { TerminalView } from "./terminal-view";
import { RichView } from "./rich-view";
import { ResizeHandle } from "./resize-handle";
import type { TerminalTheme, TerminalFont } from "@/lib/themes";

interface Props {
  layout: LayoutNode;
  focusedPaneId: string;
  isTabActive: boolean;
  theme: TerminalTheme;
  font: TerminalFont;
  richFont?: string;
  refreshKey: number;
  sessionModes?: Record<string, "terminal" | "rich">;
  pendingPrompt?: { session: string; text: string } | null;
  onFocusPane: (paneId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onCloseSession: (sessionName: string) => void;
  onSwitchSession: (sessionName: string) => void;
  onInitialPromptSent?: () => void;
}

export function PaneLayout(props: Props) {
  const isSinglePane = props.layout.type === "leaf";
  return <PaneNode {...props} node={props.layout} isSinglePane={isSinglePane} />;
}

interface NodeProps extends Omit<Props, "layout"> {
  node: LayoutNode;
  isTabActive: boolean;
  isSinglePane: boolean;
}

function PaneNode({ node, ...rest }: NodeProps) {
  if (node.type === "leaf") {
    return <PaneTerminal leaf={node} {...rest} />;
  }
  return <PaneSplitView split={node} {...rest} />;
}

function PaneSplitView({
  split,
  ...rest
}: { split: Extract<LayoutNode, { type: "split" }> } & Omit<NodeProps, "node">) {
  const { direction, ratio, children } = split;
  const isRow = direction === "h";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isRow ? "row" : "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: `0 0 calc(${ratio * 100}% - 2px)`, overflow: "hidden", display: "flex" }}>
        <PaneNode node={children[0]} {...rest} />
      </div>
      <ResizeHandle direction={direction} splitId={split.id} onResize={rest.onResize} />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", minWidth: 0, minHeight: 0 }}>
        <PaneNode node={children[1]} {...rest} />
      </div>
    </div>
  );
}

const PaneTerminal = memo(function PaneTerminal({
  leaf,
  focusedPaneId,
  theme,
  font,
  richFont,
  refreshKey,
  sessionModes,
  pendingPrompt,
  onFocusPane,
  onCloseSession,
  onSwitchSession,
  onInitialPromptSent,
  isTabActive,
  isSinglePane,
}: { leaf: Extract<LayoutNode, { type: "leaf" }> } & Omit<NodeProps, "node">) {
  const isFocused = leaf.id === focusedPaneId;
  const showBorder = !isSinglePane;
  const isRich = sessionModes?.[leaf.sessionName] === "rich";

  return (
    <div
      onMouseDown={() => onFocusPane(leaf.id)}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: showBorder
          ? isFocused ? "1px solid var(--accent)" : "1px solid transparent"
          : "none",
        transition: "border-color 0.1s",
      }}
    >
      {isRich ? (
        <RichView
          key={`${leaf.sessionName}-${refreshKey}`}
          sessionName={leaf.sessionName}
          isActive={isTabActive && isFocused}
          theme={theme}
          font={font}
          richFont={richFont}
          initialPrompt={pendingPrompt?.session === leaf.sessionName ? pendingPrompt.text : null}
          onInitialPromptSent={onInitialPromptSent}
        />
      ) : (
        <TerminalView
          key={`${leaf.sessionName}-${refreshKey}`}
          sessionName={leaf.sessionName}
          isActive={isTabActive && isFocused}
          theme={theme}
          font={font}
          onClose={() => onCloseSession(leaf.sessionName)}
        />
      )}
    </div>
  );
});
