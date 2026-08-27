export type TreeNodeView = {
  id: string;
  label: string;
  value?: string;
  suffix?: string;
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

export type TreeActions = {
  select: (id: string) => void;
  toggle: (id: string, open: boolean) => void;
  move: (id: string, direction: TreeDirection) => void;
  check?: (id: string) => void;
};

export type TreeActivity = {
  at: number;
};

export type TreeContext = {
  nodes: Map<string, TreeNodeView>;
  revision: number;
  selected: string;
  tabStop: string;
  expanded: Set<string>;
  activity: Map<string, TreeActivity>;
  showActivity: boolean;
  checkable: Set<string>;
  checked: Set<string>;
  checkDisabled: boolean;
  actions: TreeActions;
};

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

export function selectionAfterCollapse(
  selected: string,
  collapsed: string,
  nodes: Map<string, TreeNodeView>,
): string {
  return treeAncestorIds(selected, nodes).includes(collapsed)
    ? collapsed
    : selected;
}

export type TreeFilter = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  matches: string[];
  expanded: Set<string>;
  error?: string;
};

export function filterTree(
  roots: string[],
  nodes: Map<string, TreeNodeView>,
  query: string,
): TreeFilter {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { roots, nodes, matches: [], expanded: new Set() };

  return filterTreeBy(roots, nodes, (node) =>
    (node.title ?? node.label).toLocaleLowerCase().includes(needle),
  );
}

export function filterTopicTree(
  roots: string[],
  nodes: Map<string, TreeNodeView>,
  query: string,
): TreeFilter {
  const value = query.trim();
  if (!value) return { roots, nodes, matches: [], expanded: new Set() };
  if (!/[+#]/.test(value)) return filterTree(roots, nodes, value);
  const error = mqttFilterError(value);
  if (error)
    return {
      roots: [],
      nodes: new Map(),
      matches: [],
      expanded: new Set(),
      error,
    };
  return filterTreeBy(roots, nodes, (node) =>
    topicMatchesFilter((node.title ?? node.label).split("\n", 1)[0], value),
  );
}

export function topicMatchesFilter(topic: string, filter: string): boolean {
  if (mqttFilterError(filter)) return false;
  const topicLevels = topic.split("/");
  const filterLevels = filter.split("/");
  if (
    topic.startsWith("$") &&
    (filterLevels[0] === "+" || filterLevels[0] === "#")
  )
    return false;
  for (let index = 0; index < filterLevels.length; index += 1) {
    const level = filterLevels[index];
    if (level === "#") return true;
    if (index >= topicLevels.length) return false;
    if (level !== "+" && level !== topicLevels[index]) return false;
  }
  return topicLevels.length === filterLevels.length;
}

function mqttFilterError(filter: string): string | undefined {
  const levels = filter.split("/");
  for (const [index, level] of levels.entries()) {
    if (level.includes("+") && level !== "+")
      return "+ must occupy a complete topic level.";
    if (level.includes("#") && (level !== "#" || index !== levels.length - 1))
      return "# must occupy the final complete topic level.";
  }
  return undefined;
}

function filterTreeBy(
  roots: string[],
  nodes: Map<string, TreeNodeView>,
  matchesNode: (node: TreeNodeView) => boolean,
): TreeFilter {
  const matches = [...nodes.values()]
    .filter(matchesNode)
    .map((node) => node.id);
  const included = new Set(matches);
  for (const id of matches)
    treeAncestorIds(id, nodes).forEach((parent) => included.add(parent));

  const filtered = new Map<string, TreeNodeView>();
  for (const id of included) {
    const node = nodes.get(id);
    if (!node) continue;
    filtered.set(id, {
      ...node,
      children: node.children.filter((child) => included.has(child)),
    });
  }
  return {
    roots: roots.filter((id) => included.has(id)),
    nodes: filtered,
    matches,
    expanded: new Set(
      [...included].filter((id) => filtered.get(id)?.children.length),
    ),
  };
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

export function treeTabStopId(
  selected: string,
  visible: string[],
  nodes: Map<string, TreeNodeView>,
): string {
  let candidate = selected;
  while (candidate) {
    if (visible.includes(candidate)) return candidate;
    candidate = nodes.get(candidate)?.parent ?? "";
  }
  return visible[0] ?? "";
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
