import { describe, expect, it } from "vitest";
import type { TreeNodeView } from "./tree";
import { moveTreeSelection, visibleTreeIds } from "./tree";

const nodes = new Map<string, TreeNodeView>([
  ["a", { id: "a", label: "a", children: ["a/1", "a/2"] }],
  ["a/1", { id: "a/1", label: "1", parent: "a", children: [] }],
  ["a/2", { id: "a/2", label: "2", parent: "a", children: [] }],
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
});
