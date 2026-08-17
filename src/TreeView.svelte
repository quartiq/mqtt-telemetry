<svelte:options runes={true} />

<script lang="ts">
  import type { TreeDirection, TreeNodeView } from "./lib/tree";
  import { moveTreeSelection, treeTabStopId, visibleTreeIds } from "./lib/tree";
  import TreeItem from "./TreeItem.svelte";

  type Props = {
    roots: string[];
    nodes: Map<string, TreeNodeView>;
    version: number;
    selected: string;
    expanded: Set<string>;
    label: string;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
  };

  let {
    roots,
    nodes,
    version,
    selected,
    expanded,
    label,
    onselect,
    ontoggle,
  }: Props = $props();
  let focusId = $state("");
  let visible = $derived.by(() => {
    version;
    return visibleTreeIds(roots, nodes, expanded);
  });
  let tabStop = $derived(treeTabStopId(selected, visible, nodes));

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
    <TreeItem
      {id}
      {nodes}
      {version}
      {selected}
      {tabStop}
      {expanded}
      {onselect}
      {ontoggle}
      {move}
      index={index + 1}
      size={roots.length}
    />
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    min-width: 0;
    padding: 0;
  }
</style>
