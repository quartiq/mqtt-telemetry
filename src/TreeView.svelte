<svelte:options runes={true} />

<script lang="ts">
  import { tick } from "svelte";
  import type {
    TreeActions,
    TreeActivity,
    TreeContext,
    TreeDirection,
    TreeNodeView,
  } from "./lib/tree";
  import { moveTreeSelection, treeTabStopId, visibleTreeIds } from "./lib/tree";
  import TreeItem from "./TreeItem.svelte";

  type Props = {
    roots: string[];
    nodes: Map<string, TreeNodeView>;
    selected: string;
    expanded: Set<string>;
    fixedExpanded?: boolean;
    activity?: Map<string, TreeActivity>;
    checkable?: Set<string>;
    checked?: Set<string>;
    checkDisabled?: boolean;
    label: string;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
    oncheck?: (id: string) => void;
  };

  let {
    roots,
    nodes,
    selected,
    expanded,
    fixedExpanded = false,
    activity,
    checkable = new Set(),
    checked = new Set(),
    checkDisabled = false,
    label,
    onselect,
    ontoggle,
    oncheck,
  }: Props = $props();
  const emptyActivity = new Map<string, TreeActivity>();
  const actions: TreeActions = {
    select: (id) => onselect(id),
    toggle: (id, open) => {
      if (!fixedExpanded) ontoggle(id, open);
    },
    move,
    check: (id) => oncheck?.(id),
  };
  let visible = $derived(visibleTreeIds(roots, nodes, expanded));
  let tabStop = $derived(treeTabStopId(selected, visible, nodes));
  let context: TreeContext = $derived({
    nodes,
    selected,
    tabStop,
    expanded,
    fixedExpanded,
    activity: activity ?? emptyActivity,
    showActivity: activity !== undefined,
    checkable,
    checked,
    checkDisabled,
    actions,
  });

  let tree: HTMLUListElement;
  $effect.pre(() => {
    const ids = visible;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !tree?.contains(active)) return;
    const row = active.closest<HTMLElement>("[data-tree-id]");
    if (!row || ids.includes(row.dataset.treeId!)) return;
    // Recover focus only when this tree removes the focused row. Preserve selection intent.
    let ancestor = row.parentElement?.parentElement?.closest("li");
    let target = tabStop;
    while (ancestor) {
      const candidate = ancestor.querySelector<HTMLElement>(
        ":scope > [data-tree-id]",
      )?.dataset.treeId;
      if (candidate && ids.includes(candidate)) {
        target = candidate;
        break;
      }
      ancestor = ancestor.parentElement?.closest("li") ?? null;
    }
    void tick().then(() => {
      if (!active.isConnected && document.activeElement === document.body)
        tree
          ?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(target)}"]`)
          ?.focus({ preventScroll: true });
    });
  });

  function move(id: string, direction: TreeDirection) {
    const node = nodes.get(id);
    if (!node) return;
    if (direction === "child" && node.children.length && !expanded.has(id)) {
      ontoggle(id, true);
      return;
    }
    if (
      !fixedExpanded &&
      direction === "parent" &&
      node.children.length &&
      expanded.has(id)
    ) {
      ontoggle(id, false);
      return;
    }
    const next = moveTreeSelection(id, direction, visible, nodes);
    if (next !== id) {
      onselect(next);
      requestAnimationFrame(() =>
        tree
          .querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(next)}"]`)
          ?.focus(),
      );
    }
  }
</script>

<ul bind:this={tree} aria-label={label} role="tree">
  {#each roots as id, index (id)}
    <TreeItem {id} {context} index={index + 1} size={roots.length} />
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    min-width: 100%;
    padding: 0;
    width: 100%;
  }
</style>
