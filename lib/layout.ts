/** Binary layout tree for pane splits — pure functions, no React dependency */

export interface PaneLeaf {
  type: "leaf";
  id: string;
  sessionName: string;
}

export interface PaneSplit {
  type: "split";
  id: string;
  direction: "h" | "v"; // h = children side-by-side, v = children stacked
  ratio: number; // 0.1–0.9, space given to first child
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneLeaf | PaneSplit;

let _nextId = 0;
function uid(): string {
  return `pane-${Date.now()}-${_nextId++}`;
}

export function makeLeaf(sessionName: string): PaneLeaf {
  return { type: "leaf", id: uid(), sessionName };
}

export function makeSplit(
  direction: "h" | "v",
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
): PaneSplit {
  return { type: "split", id: uid(), direction, ratio, children: [first, second] };
}

/** Find a node by id anywhere in the tree */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return root;
  if (root.type === "split") {
    return findNode(root.children[0], id) ?? findNode(root.children[1], id);
  }
  return null;
}

/** Collect every leaf in the tree */
export function getAllLeaves(root: LayoutNode): PaneLeaf[] {
  if (root.type === "leaf") return [root];
  return [...getAllLeaves(root.children[0]), ...getAllLeaves(root.children[1])];
}

export function getLeafCount(root: LayoutNode): number {
  if (root.type === "leaf") return 1;
  return getLeafCount(root.children[0]) + getLeafCount(root.children[1]);
}

/** Split an existing pane, returning a new tree root and the id of the new pane */
export function splitPane(
  root: LayoutNode,
  paneId: string,
  direction: "h" | "v",
  newSessionName: string,
): { root: LayoutNode; newPaneId: string } {
  const newLeaf = makeLeaf(newSessionName);
  return { root: replaceNode(root, paneId, (node) => makeSplit(direction, node, newLeaf)), newPaneId: newLeaf.id };
}

/** Remove a pane from the tree. Returns null if it was the last pane. */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === "leaf") {
    return root.id === paneId ? null : root;
  }
  // If one child is the target, return the other child (collapse the split)
  if (root.children[0].id === paneId) return root.children[1];
  if (root.children[1].id === paneId) return root.children[0];
  // Recurse
  const left = removePane(root.children[0], paneId);
  if (left !== root.children[0]) {
    // Found in left subtree
    if (left === null) return root.children[1];
    return { ...root, children: [left, root.children[1]] };
  }
  const right = removePane(root.children[1], paneId);
  if (right !== root.children[1]) {
    if (right === null) return root.children[0];
    return { ...root, children: [root.children[0], right] };
  }
  return root;
}

/** Extract a pane from the tree (for break-pane). Returns remaining tree and the extracted leaf. */
export function extractPane(
  root: LayoutNode,
  paneId: string,
): { remaining: LayoutNode | null; extracted: PaneLeaf | null } {
  const leaf = findNode(root, paneId);
  if (!leaf || leaf.type !== "leaf") return { remaining: root, extracted: null };
  const remaining = removePane(root, paneId);
  return { remaining, extracted: leaf };
}

/** Update the ratio of a split node */
export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const clamped = Math.min(0.9, Math.max(0.1, ratio));
  if (root.id === splitId && root.type === "split") {
    return { ...root, ratio: clamped };
  }
  if (root.type === "split") {
    return {
      ...root,
      children: [
        setRatio(root.children[0], splitId, ratio),
        setRatio(root.children[1], splitId, ratio),
      ],
    };
  }
  return root;
}

/** Geometric neighbor finding: assign rects then find adjacent pane in given direction */
export function findNeighbor(
  root: LayoutNode,
  paneId: string,
  direction: "h" | "j" | "k" | "l",
): string | null {
  interface Rect { x: number; y: number; w: number; h: number; }
  const rects = new Map<string, Rect>();

  function layout(node: LayoutNode, rect: Rect) {
    if (node.type === "leaf") {
      rects.set(node.id, rect);
      return;
    }
    const { direction: dir, ratio, children } = node;
    if (dir === "h") {
      layout(children[0], { ...rect, w: rect.w * ratio });
      layout(children[1], { x: rect.x + rect.w * ratio, y: rect.y, w: rect.w * (1 - ratio), h: rect.h });
    } else {
      layout(children[0], { ...rect, h: rect.h * ratio });
      layout(children[1], { x: rect.x, y: rect.y + rect.h * ratio, w: rect.w, h: rect.h * (1 - ratio) });
    }
  }

  layout(root, { x: 0, y: 0, w: 1, h: 1 });

  const src = rects.get(paneId);
  if (!src) return null;

  const cx = src.x + src.w / 2;
  const cy = src.y + src.h / 2;

  let best: string | null = null;
  let bestDist = Infinity;

  for (const [id, r] of rects) {
    if (id === paneId) continue;
    const rx = r.x + r.w / 2;
    const ry = r.y + r.h / 2;
    let valid = false;
    let dist = 0;

    switch (direction) {
      case "h": // left
        valid = rx < cx;
        dist = cx - rx;
        break;
      case "l": // right
        valid = rx > cx;
        dist = rx - cx;
        break;
      case "k": // up
        valid = ry < cy;
        dist = cy - ry;
        break;
      case "j": // down
        valid = ry > cy;
        dist = ry - cy;
        break;
    }

    if (valid && dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }

  return best;
}

/** Replace a node by id with the result of a transform function */
function replaceNode(
  root: LayoutNode,
  id: string,
  transform: (node: LayoutNode) => LayoutNode,
): LayoutNode {
  if (root.id === id) return transform(root);
  if (root.type === "split") {
    return {
      ...root,
      children: [
        replaceNode(root.children[0], id, transform),
        replaceNode(root.children[1], id, transform),
      ],
    };
  }
  return root;
}
