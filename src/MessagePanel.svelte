<svelte:options runes={true} />

<script lang="ts">
  import TreeView from "./TreeView.svelte";
  import {
    formatPayload,
    formatTelemetryTime,
    type DisplayTimeZone,
    type JsonSnapshot,
    type TelemetryMessage,
  } from "./lib/model";

  type Props = {
    message?: TelemetryMessage;
    topic: string;
    snapshot?: JsonSnapshot;
    selected: string;
    selectedLabel?: string;
    following: boolean;
    expanded: Set<string>;
    checkable: Set<string>;
    checked: Set<string>;
    checkDisabled: boolean;
    subtreePlotCount: number;
    plotCount: number;
    subtreeMessages: number;
    showPlotHint: boolean;
    timeZone: DisplayTimeZone;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
    oncheck: (id: string) => void;
    onremoveplots: () => void;
    onremoveallplots: () => void;
  };

  let {
    message,
    topic,
    snapshot,
    selected,
    selectedLabel,
    following,
    expanded,
    checkable,
    checked,
    checkDisabled,
    subtreePlotCount,
    plotCount,
    subtreeMessages,
    showPlotHint,
    timeZone,
    onselect,
    ontoggle,
    oncheck,
    onremoveplots,
    onremoveallplots,
  }: Props = $props();
  let fieldMissing = $derived(
    Boolean(selected && snapshot && !snapshot.nodes.has(selected)),
  );
  let statistics = $derived.by(() => {
    if (!message) return [];
    const items = [
      following ? "Following latest" : "Historical",
      `received ${formatTelemetryTime(message.receivedAt, { timeZone, date: true, milliseconds: true })}`,
    ];
    if (message.retained) items.push("retained");
    if (message.duplicate) items.push("possible duplicate");
    items.push(`${message.bytes.toLocaleString()} bytes`);
    if (snapshot) items.push(`${snapshot.nodes.size.toLocaleString()} nodes`);
    if (showPlotHint) items.push("check a numeric field to plot");
    if (message.unsafeIntegers) items.push("unsafe integer precision");
    return items;
  });
</script>

<section class="panel message-panel">
  <header class="panel-header">
    <h2 title={topic}>{topic || "No topic selected"}</h2>
    <div class="panel-controls">
      {#if fieldMissing}
        <span
          class="missing"
          title={`${selectedLabel} is absent from this message`}
          >field absent</span
        >
      {/if}
      {#if subtreePlotCount || plotCount > 1}
        <div class="remove-controls">
          <span class="meta">Remove</span>
          {#if subtreePlotCount}
            <button
              aria-label={`Remove ${subtreePlotCount} ${subtreePlotCount === 1 ? "plot" : "plots"} for the selected value`}
              type="button"
              onclick={onremoveplots}>Value ({subtreePlotCount})</button
            >
          {/if}
          {#if plotCount > 1}
            <button
              aria-label="Remove all plots"
              type="button"
              onclick={onremoveallplots}>All</button
            >
          {/if}
        </div>
      {/if}
    </div>
    {#if statistics.length}
      <div class="panel-stats meta">
        {#each statistics as statistic}<span>{statistic}</span>{/each}
      </div>
    {/if}
  </header>
  {#if message?.payload.kind === "json" && snapshot}
    <div class="message-tree">
      <TreeView
        roots={snapshot.roots}
        nodes={snapshot.nodes}
        {selected}
        {expanded}
        label="JSON fields"
        {checkable}
        {checked}
        {checkDisabled}
        {onselect}
        {ontoggle}
        {oncheck}
      />
    </div>
  {:else if message}
    <pre>{formatPayload(message.payload)}</pre>
  {:else if topic && subtreeMessages}
    <p class="empty">
      No message in history on this exact topic. Expand it and select a
      descendant with a message count.
    </p>
  {:else if topic}
    <p class="empty">No message in history on this topic.</p>
  {:else}
    <p class="empty">Select a topic with a message count.</p>
  {/if}
</section>

<style>
  .message-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .message-tree {
    min-height: 0;
    overflow: auto;
  }

  pre {
    min-height: 0;
    overflow: auto;
  }

  .missing {
    color: var(--muted);
    flex: none;
    font-size: var(--text-small);
  }

  .panel-controls,
  .remove-controls {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
  }

  .remove-controls {
    white-space: nowrap;
  }

  @media (max-width: 800px) {
    .message-panel {
      height: clamp(16rem, 40svh, 24rem);
    }
  }

  @media (max-width: 420px) {
    .message-panel > .panel-header {
      grid-template-columns: minmax(0, 1fr);
    }

    .message-panel > .panel-header h2 {
      grid-column: 1;
      grid-row: 1;
    }

    .panel-controls {
      grid-column: 1;
      grid-row: 2;
      justify-content: flex-end;
    }

    .panel-stats {
      grid-column: 1;
      grid-row: 3;
    }
  }
</style>
