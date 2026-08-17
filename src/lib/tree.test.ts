import { describe, expect, it } from "vitest";
import type { TreeNodeView } from "./tree";
import {
  filterTree,
  moveTreeSelection,
  selectionAfterCollapse,
  treeAncestorIds,
  treeTabStopId,
  visibleTreeIds,
} from "./tree";

const nodes = new Map<string, TreeNodeView>([
  ["a", { id: "a", label: "a", children: ["a/1", "a/2"] }],
  ["a/1", { id: "a/1", label: "1", parent: "a", children: [], title: "a/1" }],
  ["a/2", { id: "a/2", label: "2", parent: "a", children: [], title: "a/2" }],
  ["b", { id: "b", label: "b", children: [] }],
]);

describe("tree navigation", () => {
  it("flattens only expanded branches", () => {
    expect(visibleTreeIds(["a", "b"], nodes, new Set())).toEqual(["a", "b"]);
    expect(visibleTreeIds(["a", "b"], nodes, new Set(["a"]))).toEqual([
      "a",
      "a/1",
      "a/2",
      "b",
    ]);
  });

  it("moves structurally and by visible order", () => {
    const visible = visibleTreeIds(["a", "b"], nodes, new Set(["a"]));
    expect(moveTreeSelection("a", "child", visible, nodes)).toBe("a/1");
    expect(moveTreeSelection("a/2", "parent", visible, nodes)).toBe("a");
    expect(moveTreeSelection("a/2", "next", visible, nodes)).toBe("b");
    expect(moveTreeSelection("a", "last", visible, nodes)).toBe("b");
  });

  it("finds every ancestor needed to reveal a routed node", () => {
    expect(treeAncestorIds("a/1", nodes)).toEqual(["a"]);
    expect(treeAncestorIds("a", nodes)).toEqual([]);
  });

  it("keeps a visible tab stop when the selection is hidden or absent", () => {
    const visible = ["a", "b"];
    expect(treeTabStopId("a/1", visible, nodes)).toBe("a");
    expect(treeTabStopId("missing", visible, nodes)).toBe("a");
  });

  it("selects a collapsed ancestor when it would hide the selection", () => {
    expect(selectionAfterCollapse("a/1", "a", nodes)).toBe("a");
    expect(selectionAfterCollapse("b", "a", nodes)).toBe("b");
  });

  it("filters complete paths while retaining their ancestors", () => {
    const filtered = filterTree(["a", "b"], nodes, "a/2");
    expect(filtered.matches).toEqual(["a/2"]);
    expect(filtered.roots).toEqual(["a"]);
    expect([...filtered.nodes]).toEqual([
      ["a/2", nodes.get("a/2")],
      ["a", { ...nodes.get("a"), children: ["a/2"] }],
    ]);
    expect(filtered.expanded).toEqual(new Set(["a"]));
  });
});
