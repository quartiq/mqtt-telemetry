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
    subtreeMessages: number;
    showPlotHint: boolean;
    timeZone: DisplayTimeZone;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
    oncheck: (id: string) => void;
    onremoveplots: () => void;
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
    subtreeMessages,
    showPlotHint,
    timeZone,
    onselect,
    ontoggle,
    oncheck,
    onremoveplots,
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
    items.push(`QoS ${message.qos}`, `${message.bytes.toLocaleString()} bytes`);
    if (snapshot)
      items.push(`${snapshot.nodes.size.toLocaleString()} JSON nodes`);
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
      {#if subtreePlotCount}
        <button
          class="remove-plots"
          type="button"
          title="Remove plots for numeric fields in the selected JSON value"
          onclick={onremoveplots}
          >Remove {subtreePlotCount}
          {subtreePlotCount === 1 ? "plot" : "plots"}</button
        >
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
      No buffered message on this exact topic. Expand it and select a descendant
      with a message count.
    </p>
  {:else if topic}
    <p class="empty">No buffered message on this topic.</p>
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

  .remove-plots {
    white-space: nowrap;
  }

  .panel-controls {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
  }

  @media (max-width: 800px) {
    .message-panel {
      height: clamp(16rem, 40svh, 24rem);
    }
  }
</style>
