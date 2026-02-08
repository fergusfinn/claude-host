import { describe, it, expect } from "vitest";
import {
  makeLeaf,
  makeSplit,
  findNode,
  getAllLeaves,
  getLeafCount,
  splitPane,
  removePane,
  extractPane,
  setRatio,
  findNeighbor,
  type PaneLeaf,
  type PaneSplit,
} from "./layout";

describe("makeLeaf", () => {
  it("creates a leaf with correct properties", () => {
    const leaf = makeLeaf("sess-1");
    expect(leaf.type).toBe("leaf");
    expect(leaf.sessionName).toBe("sess-1");
    expect(leaf.id).toMatch(/^pane-/);
  });

  it("generates unique ids", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    expect(a.id).not.toBe(b.id);
  });
});

describe("makeSplit", () => {
  it("creates a horizontal split with default ratio", () => {
    const left = makeLeaf("l");
    const right = makeLeaf("r");
    const split = makeSplit("h", left, right);
    expect(split.type).toBe("split");
    expect(split.direction).toBe("h");
    expect(split.ratio).toBe(0.5);
    expect(split.children).toEqual([left, right]);
  });

  it("creates a vertical split with custom ratio", () => {
    const top = makeLeaf("t");
    const bottom = makeLeaf("b");
    const split = makeSplit("v", top, bottom, 0.7);
    expect(split.direction).toBe("v");
    expect(split.ratio).toBe(0.7);
  });
});

describe("findNode", () => {
  it("finds a root leaf by id", () => {
    const leaf = makeLeaf("x");
    expect(findNode(leaf, leaf.id)).toBe(leaf);
  });

  it("returns null for non-existent id on a leaf", () => {
    const leaf = makeLeaf("x");
    expect(findNode(leaf, "nope")).toBeNull();
  });

  it("finds a leaf deep in a split tree", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const c = makeLeaf("c");
    const inner = makeSplit("h", a, b);
    const root = makeSplit("v", inner, c);

    expect(findNode(root, a.id)).toBe(a);
    expect(findNode(root, b.id)).toBe(b);
    expect(findNode(root, c.id)).toBe(c);
    expect(findNode(root, inner.id)).toBe(inner);
    expect(findNode(root, root.id)).toBe(root);
  });

  it("returns null for non-existent id in a tree", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    expect(findNode(root, "missing")).toBeNull();
  });
});

describe("getAllLeaves", () => {
  it("returns single leaf in array", () => {
    const leaf = makeLeaf("x");
    expect(getAllLeaves(leaf)).toEqual([leaf]);
  });

  it("returns all leaves in order (left to right)", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const c = makeLeaf("c");
    const root = makeSplit("h", makeSplit("v", a, b), c);
    const leaves = getAllLeaves(root);
    expect(leaves).toEqual([a, b, c]);
  });
});

describe("getLeafCount", () => {
  it("returns 1 for a single leaf", () => {
    expect(getLeafCount(makeLeaf("x"))).toBe(1);
  });

  it("counts leaves in a nested tree", () => {
    const root = makeSplit(
      "h",
      makeSplit("v", makeLeaf("a"), makeLeaf("b")),
      makeSplit("v", makeLeaf("c"), makeLeaf("d")),
    );
    expect(getLeafCount(root)).toBe(4);
  });
});

describe("splitPane", () => {
  it("splits a single leaf into two panes", () => {
    const root = makeLeaf("orig");
    const { root: newRoot, newPaneId } = splitPane(root, root.id, "h", "new-sess");

    expect(newRoot.type).toBe("split");
    const split = newRoot as PaneSplit;
    expect(split.direction).toBe("h");
    expect(split.ratio).toBe(0.5);

    // First child should be the original leaf
    expect(split.children[0].id).toBe(root.id);
    // Second child should be the new leaf
    expect((split.children[1] as PaneLeaf).sessionName).toBe("new-sess");
    expect(split.children[1].id).toBe(newPaneId);
  });

  it("splits a specific pane in a tree", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const root = makeSplit("h", a, b);

    const { root: newRoot, newPaneId } = splitPane(root, b.id, "v", "c");
    expect(getLeafCount(newRoot)).toBe(3);

    const newLeaf = findNode(newRoot, newPaneId) as PaneLeaf;
    expect(newLeaf.sessionName).toBe("c");
  });

  it("new pane gets correct session name", () => {
    const root = makeLeaf("orig");
    const { root: newRoot, newPaneId } = splitPane(root, root.id, "h", "new-sess");
    const newLeaf = findNode(newRoot, newPaneId) as PaneLeaf;
    expect(newLeaf.sessionName).toBe("new-sess");
  });
});

describe("removePane", () => {
  it("returns null when removing the only pane", () => {
    const leaf = makeLeaf("x");
    expect(removePane(leaf, leaf.id)).toBeNull();
  });

  it("returns the other child when removing from a simple split", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const root = makeSplit("h", a, b);

    expect(removePane(root, a.id)).toBe(b);
    expect(removePane(root, b.id)).toBe(a);
  });

  it("collapses a nested split correctly", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const c = makeLeaf("c");
    const inner = makeSplit("v", a, b);
    const root = makeSplit("h", inner, c);

    // Removing 'a' should collapse: root.left becomes just 'b'
    const result = removePane(root, a.id)!;
    expect(result.type).toBe("split");
    const split = result as PaneSplit;
    expect(getLeafCount(split)).toBe(2);
    expect(getAllLeaves(split).map((l) => l.sessionName)).toEqual(["b", "c"]);
  });

  it("returns unchanged root when id not found", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    expect(removePane(root, "missing")).toBe(root);
  });

  it("handles removing a leaf when it is the only child left in a subtree", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const c = makeLeaf("c");
    const root = makeSplit("h", a, makeSplit("v", b, c));

    const result = removePane(root, b.id)!;
    expect(getLeafCount(result)).toBe(2);
    expect(getAllLeaves(result).map((l) => l.sessionName)).toEqual(["a", "c"]);
  });
});

describe("extractPane", () => {
  it("extracts a leaf and returns remaining tree", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const root = makeSplit("h", a, b);

    const { remaining, extracted } = extractPane(root, a.id);
    expect(extracted).toBe(a);
    expect(remaining).toBe(b);
  });

  it("returns null extracted for non-existent id", () => {
    const root = makeLeaf("x");
    const { remaining, extracted } = extractPane(root, "nope");
    expect(extracted).toBeNull();
    expect(remaining).toBe(root);
  });

  it("returns null extracted for a split node id", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    const { remaining, extracted } = extractPane(root, root.id);
    expect(extracted).toBeNull();
    expect(remaining).toBe(root);
  });

  it("returns null remaining when extracting the only pane", () => {
    const leaf = makeLeaf("x");
    const { remaining, extracted } = extractPane(leaf, leaf.id);
    expect(extracted).toBe(leaf);
    expect(remaining).toBeNull();
  });
});

describe("setRatio", () => {
  it("updates ratio on the target split", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    const updated = setRatio(root, root.id, 0.3) as PaneSplit;
    expect(updated.ratio).toBe(0.3);
  });

  it("clamps ratio to [0.1, 0.9]", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    expect((setRatio(root, root.id, 0.0) as PaneSplit).ratio).toBe(0.1);
    expect((setRatio(root, root.id, 1.0) as PaneSplit).ratio).toBe(0.9);
    expect((setRatio(root, root.id, -5) as PaneSplit).ratio).toBe(0.1);
    expect((setRatio(root, root.id, 99) as PaneSplit).ratio).toBe(0.9);
  });

  it("returns leaf unchanged when id doesn't match", () => {
    const leaf = makeLeaf("x");
    expect(setRatio(leaf, "nope", 0.3)).toBe(leaf);
  });

  it("finds and updates a nested split", () => {
    const inner = makeSplit("v", makeLeaf("a"), makeLeaf("b"));
    const root = makeSplit("h", inner, makeLeaf("c"));
    const updated = setRatio(root, inner.id, 0.7) as PaneSplit;
    const updatedInner = updated.children[0] as PaneSplit;
    expect(updatedInner.ratio).toBe(0.7);
  });
});

describe("findNeighbor", () => {
  it("returns null for a single pane", () => {
    const leaf = makeLeaf("x");
    expect(findNeighbor(leaf, leaf.id, "h")).toBeNull();
    expect(findNeighbor(leaf, leaf.id, "l")).toBeNull();
  });

  it("finds left/right neighbors in horizontal split", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const root = makeSplit("h", a, b);

    // 'a' is on the left, 'b' is on the right
    expect(findNeighbor(root, a.id, "l")).toBe(b.id); // right of a → b
    expect(findNeighbor(root, b.id, "h")).toBe(a.id); // left of b → a
  });

  it("finds up/down neighbors in vertical split", () => {
    const top = makeLeaf("top");
    const bot = makeLeaf("bot");
    const root = makeSplit("v", top, bot);

    expect(findNeighbor(root, top.id, "j")).toBe(bot.id); // down from top → bot
    expect(findNeighbor(root, bot.id, "k")).toBe(top.id); // up from bot → top
  });

  it("returns null when there's no neighbor in that direction", () => {
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const root = makeSplit("h", a, b);

    expect(findNeighbor(root, a.id, "h")).toBeNull(); // nothing to the left of a
    expect(findNeighbor(root, b.id, "l")).toBeNull(); // nothing to the right of b
  });

  it("returns null for an unknown pane id", () => {
    const root = makeSplit("h", makeLeaf("a"), makeLeaf("b"));
    expect(findNeighbor(root, "nope", "l")).toBeNull();
  });

  it("finds neighbors in a three-pane horizontal layout", () => {
    // Layout:  [a | b | c]  (three panes side by side)
    const a = makeLeaf("a");
    const b = makeLeaf("b");
    const c = makeLeaf("c");
    const right = makeSplit("h", b, c);
    const root = makeSplit("h", a, right);

    // a → right is b (nearest to the right)
    expect(findNeighbor(root, a.id, "l")).toBe(b.id);
    // b → left is a, right is c
    expect(findNeighbor(root, b.id, "h")).toBe(a.id);
    expect(findNeighbor(root, b.id, "l")).toBe(c.id);
    // c → left is b
    expect(findNeighbor(root, c.id, "h")).toBe(b.id);
    // No vertical neighbors in a horizontal layout
    expect(findNeighbor(root, b.id, "j")).toBeNull();
    expect(findNeighbor(root, b.id, "k")).toBeNull();
  });
});
