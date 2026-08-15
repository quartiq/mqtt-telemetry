<svelte:options runes={true} />

<script lang="ts">
  import type { TreeDirection, TreeNodeView } from "./lib/tree";
  import { moveTreeSelection, visibleTreeIds } from "./lib/tree";
  import TreeItem from "./TreeItem.svelte";

  type Props = {
    roots: string[];
    nodes: Map<string, TreeNodeView>;
    selected: string;
    expanded: Set<string>;
    label: string;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
  };

  let { roots, nodes, selected, expanded, label, onselect, ontoggle }: Props =
    $props();
  let focusId = $state("");
  let visible = $derived(visibleTreeIds(roots, nodes, expanded));

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
    {@const node = nodes.get(id)}
    {#if node}
      <TreeItem
        {node}
        {nodes}
        {selected}
        {expanded}
        {onselect}
        {ontoggle}
        {move}
        index={index + 1}
        size={roots.length}
      />
    {/if}
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    min-width: 0;
    padding: 0;
  }
</style>
