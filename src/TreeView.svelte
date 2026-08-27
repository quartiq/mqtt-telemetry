<svelte:options runes={true} />

<script lang="ts">
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
    revision?: number;
    selected: string;
    expanded: Set<string>;
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
    revision = 0,
    selected,
    expanded,
    activity = new Map(),
    checkable = new Set(),
    checked = new Set(),
    checkDisabled = false,
    label,
    onselect,
    ontoggle,
    oncheck,
  }: Props = $props();
  let focusId = $state("");
  const actions: TreeActions = {
    select: (id) => onselect(id),
    toggle: (id, open) => ontoggle(id, open),
    move,
    check: (id) => oncheck?.(id),
  };
  let visible = $derived.by(() => {
    revision;
    return visibleTreeIds(roots, nodes, expanded);
  });
  let tabStop = $derived(treeTabStopId(selected, visible, nodes));
  let context: TreeContext = $derived({
    nodes,
    revision,
    selected,
    tabStop,
    expanded,
    activity,
    checkable,
    checked,
    checkDisabled,
    actions,
  });

  $effect(() => {
    if (!focusId) return;
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(focusId)}"]`)
        ?.focus();
    });
  });

  function move(id: string, direction: TreeDirection) {
    const node = nodes.get(id);
    if (!node) return;
    if (direction === "child" && node.children.length && !expanded.has(id)) {
      ontoggle(id, true);
      return;
    }
    if (direction === "parent" && node.children.length && expanded.has(id)) {
      ontoggle(id, false);
      return;
    }
    const next = moveTreeSelection(id, direction, visible, nodes);
    if (next !== id) {
      onselect(next);
      focusId = next;
    }
  }
</script>

<ul aria-label={label} role="tree">
  {#each roots as id, index (id)}
    <TreeItem {id} {context} index={index + 1} size={roots.length} />
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    min-width: 0;
    padding: 0;
  }
</style>
