export type TreeNodeView = {
  id: string;
  label: string;
  value?: string;
  parent?: string;
  children: string[];
  title?: string;
};

export type TreeDirection =
  | "next"
  | "previous"
  | "parent"
  | "child"
  | "first"
  | "last"
  | "pageNext"
  | "pagePrevious";

export function treeAncestorIds(
  id: string,
  nodes: Map<string, TreeNodeView>,
): string[] {
  const ancestors: string[] = [];
  let parent = nodes.get(id)?.parent;
  while (parent) {
    ancestors.push(parent);
    parent = nodes.get(parent)?.parent;
  }
  return ancestors;
}

export function visibleTreeIds(
  roots: string[],
  nodes: Map<string, TreeNodeView>,
  expanded: Set<string>,
): string[] {
  const visible: string[] = [];
  const append = (id: string) => {
    const node = nodes.get(id);
    if (!node) return;
    visible.push(id);
    if (expanded.has(id)) node.children.forEach(append);
  };
  roots.forEach(append);
  return visible;
}

export function moveTreeSelection(
  current: string,
  direction: TreeDirection,
  visible: string[],
  nodes: Map<string, TreeNodeView>,
  step = 10,
): string {
  const index = Math.max(0, visible.indexOf(current));
  switch (direction) {
    case "first":
      return visible[0] ?? current;
    case "last":
      return visible.at(-1) ?? current;
    case "next":
      return visible[Math.min(visible.length - 1, index + 1)] ?? current;
    case "previous":
      return visible[Math.max(0, index - 1)] ?? current;
    case "pageNext":
      return visible[Math.min(visible.length - 1, index + step)] ?? current;
    case "pagePrevious":
      return visible[Math.max(0, index - step)] ?? current;
    case "parent":
      return nodes.get(current)?.parent ?? current;
    case "child":
      return nodes.get(current)?.children[0] ?? current;
  }
}
