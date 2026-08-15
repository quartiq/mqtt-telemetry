<svelte:options runes={true} />

<script lang="ts">
  import type { TreeDirection, TreeNodeView } from "./lib/tree";
  import TreeItem from "./TreeItem.svelte";

  type Props = {
    node: TreeNodeView;
    nodes: Map<string, TreeNodeView>;
    selected: string;
    expanded: Set<string>;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
    onactivate?: (id: string) => void;
    move: (id: string, direction: TreeDirection) => void;
    depth?: number;
    index?: number;
    size?: number;
  };

  let {
    node,
    nodes,
    selected,
    expanded,
    onselect,
    ontoggle,
    onactivate,
    move,
    depth = 0,
    index = 1,
    size = 1,
  }: Props = $props();
  let internal = $derived(node.children.length > 0);
  let open = $derived(expanded.has(node.id));
  let active = $derived(selected === node.id);

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    ontoggle(node.id, !open);
  }

  function select(event: MouseEvent) {
    event.currentTarget instanceof HTMLElement && event.currentTarget.focus();
    onselect(node.id);
  }

  function activate() {
    onselect(node.id);
    onactivate?.(node.id);
  }

  function keydown(event: KeyboardEvent) {
    const directions: Record<string, TreeDirection> = {
      ArrowDown: "next",
      ArrowUp: "previous",
      ArrowLeft: "parent",
      ArrowRight: "child",
      Home: "first",
      End: "last",
      PageDown: "pageNext",
      PageUp: "pagePrevious",
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      move(node.id, direction);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate();
    } else if (event.key === " " && internal) {
      event.preventDefault();
      ontoggle(node.id, !open);
    }
  }
</script>

<li>
  <div
    aria-expanded={internal ? open : undefined}
    aria-level={depth + 1}
    aria-posinset={index}
    aria-selected={active}
    aria-setsize={size}
    class:active
    data-tree-id={node.id}
    role="treeitem"
    style:padding-left={`${depth}rem`}
    tabindex={active ? 0 : -1}
    title={onactivate
      ? `${node.title ?? node.label}\nDouble-click or Enter to open`
      : (node.title ?? node.label)}
    onclick={select}
    ondblclick={activate}
    onkeydown={keydown}
  >
    {#if internal}
      <button
        aria-label={open ? "Collapse" : "Expand"}
        class="caret"
        tabindex="-1"
        type="button"
        onclick={toggle}>{open ? "▾" : "▸"}</button
      >
    {:else}
      <span aria-hidden="true" class="spacer"></span>
    {/if}
    <span class="label">{node.label}</span>
    {#if node.value !== undefined}
      <span class="separator"> = </span><span class="value">{node.value}</span>
    {/if}
  </div>

  {#if internal && open}
    <ul role="group">
      {#each node.children as childId, childIndex (childId)}
        {@const child = nodes.get(childId)}
        {#if child}
          <TreeItem
            node={child}
            {nodes}
            {selected}
            {expanded}
            {onselect}
            {ontoggle}
            {onactivate}
            {move}
            depth={depth + 1}
            index={childIndex + 1}
            size={node.children.length}
          />
        {/if}
      {/each}
    </ul>
  {/if}
</li>

<style>
  li {
    list-style: none;
    min-width: 0;
  }

  ul {
    margin: 0;
    padding: 0;
  }

  [role="treeitem"] {
    align-items: baseline;
    border-radius: var(--radius);
    cursor: default;
    display: flex;
    line-height: var(--line);
    min-height: var(--line);
    min-width: 0;
    overflow: hidden;
    padding-right: var(--space-tight);
  }

  [role="treeitem"]:focus-visible {
    outline: 1px solid var(--focus);
    outline-offset: -1px;
  }

  .active {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--selected-mark);
  }

  .caret,
  .spacer {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    flex: 0 0 var(--caret);
    font: inherit;
    line-height: inherit;
    margin: 0;
    padding: 0;
    text-align: left;
    width: var(--caret);
  }

  .caret {
    cursor: pointer;
  }

  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .separator {
    color: var(--muted);
    flex: none;
    white-space: pre;
  }

  .value {
    color: var(--muted);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
