<svelte:options runes={true} />

<script lang="ts">
  import type { TreeContext, TreeDirection, TreeNodeView } from "./lib/tree";
  import TreeItem from "./TreeItem.svelte";

  type Props = {
    id: string;
    context: TreeContext;
    depth?: number;
    index?: number;
    size?: number;
  };

  let { id, context, depth = 0, index = 1, size = 1 }: Props = $props();
  let node = $derived.by(() => {
    context.revision;
    return context.nodes.get(id) as TreeNodeView;
  });
  let internal = $derived(node.children.length > 0);
  let open = $derived(context.expanded.has(node.id));
  let active = $derived(context.selected === node.id);
  let checkable = $derived(context.checkable.has(node.id));
  let checked = $derived(context.checked.has(node.id));
  let checkBlocked = $derived(checkable && !checked && context.checkDisabled);
  let activity = $derived.by(() => {
    context.revision;
    return context.activity.get(node.id);
  });
  const activityDurationMs = 1100;

  function indicateActivity(node: HTMLElement, initial?: typeof activity) {
    let timer = 0;
    const run = (next?: typeof activity) => {
      clearTimeout(timer);
      const remaining = next
        ? activityDurationMs - (performance.now() - next.at)
        : 0;
      node.style.opacity = remaining > 0 ? "1" : "0";
      if (remaining > 0)
        timer = window.setTimeout(() => {
          node.style.opacity = "0";
        }, remaining);
    };
    run(initial);
    return {
      update: run,
      destroy() {
        clearTimeout(timer);
      },
    };
  }

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    context.actions.toggle(node.id, !open);
  }

  function select(event: MouseEvent) {
    event.currentTarget instanceof HTMLElement && event.currentTarget.focus();
    context.actions.select(node.id);
  }

  function toggleCheck(event: MouseEvent) {
    event.stopPropagation();
    if (!checkBlocked) context.actions.check?.(node.id);
  }

  function activate() {
    context.actions.select(node.id);
    if (internal) context.actions.toggle(node.id, !open);
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
      context.actions.move(node.id, direction);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate();
    } else if (event.key === " " && checkable) {
      event.preventDefault();
      if (!checkBlocked) context.actions.check?.(node.id);
    } else if (event.key === " " && internal) {
      event.preventDefault();
      context.actions.toggle(node.id, !open);
    }
  }
</script>

<li>
  <div
    aria-expanded={internal ? open : undefined}
    aria-checked={checkable ? checked : undefined}
    aria-level={depth + 1}
    aria-posinset={index}
    aria-selected={active}
    aria-setsize={size}
    class:active
    data-tree-id={node.id}
    role="treeitem"
    style:padding-left={`calc(${depth} * var(--tree-indent))`}
    tabindex={context.tabStop === node.id ? 0 : -1}
    title={node.title ?? node.label}
    onclick={select}
    ondblclick={activate}
    onkeydown={keydown}
  >
    {#if internal && context.fixedExpanded}
      <span aria-hidden="true" class="control-slot fixed-caret">▾</span>
    {:else if internal}
      <button
        aria-label={open ? "Collapse" : "Expand"}
        class="caret"
        tabindex="-1"
        type="button"
        ondblclick={(event) => event.stopPropagation()}
        onclick={toggle}>{open ? "▾" : "▸"}</button
      >
    {:else}
      <span aria-hidden="true" class="control-slot"></span>
    {/if}
    {#if checkable}
      <button
        aria-label={checked ? "Remove plot" : "Add plot"}
        aria-pressed={checked}
        class="plot-toggle"
        disabled={checkBlocked}
        tabindex="-1"
        title={checkBlocked
          ? "The plot limit is reached"
          : checked
            ? "Remove plot"
            : "Add plot"}
        type="button"
        ondblclick={(event) => event.stopPropagation()}
        onclick={toggleCheck}
        ><span aria-hidden="true" class="pin-mark">{checked ? "✓" : ""}</span
        ></button
      >
    {:else}
      <span aria-hidden="true" class="control-slot"></span>
    {/if}
    <span aria-hidden="true" class="activity-slot">
      {#if context.showActivity}
        <span class="activity-dot" use:indicateActivity={activity}></span>
      {/if}
    </span>
    <span class="label">{node.label}</span>
    {#if node.suffix !== undefined}
      <span class="suffix">{" "}{node.suffix}</span>
    {/if}
    {#if node.value !== undefined}
      <span class="separator">{" = "}</span><span class="value"
        >{node.value}</span
      >
    {/if}
  </div>

  {#if internal && open}
    <ul role="group">
      {#each node.children as childId, childIndex (childId)}
        <TreeItem
          id={childId}
          {context}
          depth={depth + 1}
          index={childIndex + 1}
          size={node.children.length}
        />
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
    --tree-control: 1.3rem;
    --tree-indent: 1rem;
    align-items: center;
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

  .activity-slot {
    align-items: center;
    align-self: stretch;
    display: flex;
    flex: 0 0 8px;
    justify-content: center;
    margin-right: 0.2rem;
  }

  .activity-dot {
    background: currentColor;
    border-radius: 50%;
    height: 0.4rem;
    opacity: 0;
    width: 0.4rem;
  }

  .caret,
  .plot-toggle,
  .control-slot {
    flex: 0 0 var(--tree-control);
    width: var(--tree-control);
  }

  .fixed-caret {
    text-align: center;
  }

  .caret,
  .plot-toggle {
    appearance: none;
    align-items: center;
    align-self: stretch;
    background: transparent;
    border: 0;
    color: inherit;
    display: flex;
    font: inherit;
    justify-content: center;
    line-height: 1;
    margin: 0;
    min-height: 0;
    padding: 0;
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

  .suffix {
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

  .pin-mark {
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 0.2rem;
    display: flex;
    font-size: 0.75rem;
    height: 1rem;
    justify-content: center;
    width: 1rem;
  }

  .plot-toggle[aria-pressed="true"] .pin-mark {
    background: var(--fg);
    border-color: var(--fg);
    color: var(--bg);
  }

  @media (pointer: coarse) {
    [role="treeitem"] {
      --tree-control: 30px;
      --tree-indent: 12px;
      min-height: 40px;
    }
  }
</style>
