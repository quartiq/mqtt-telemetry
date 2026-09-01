<svelte:options runes={true} />

<script lang="ts">
  import {
    messagePayloadPreview,
    messageFrequency,
    messageSpan,
    selectedMessageValue,
    type TelemetryMessage,
  } from "./lib/telemetry";
  import type { JsonPath } from "./lib/json";
  import {
    formatTelemetryTime,
    historyNeedsDate,
    type DisplayTimeZone,
  } from "./lib/time";

  type Props = {
    expanded: boolean;
    messages: readonly TelemetryMessage[];
    selectedId: number | null;
    field: JsonPath | undefined;
    timeZone: DisplayTimeZone;
    canClearTopic: boolean;
    canClearSubtree: boolean;
    canClearAll: boolean;
    onselect: (id: number) => void;
    onlatest: () => void;
    oncleartopic: () => void;
    onclearsubtree: () => void;
    onclearall: () => void;
    ontoggle: () => void;
  };

  let {
    expanded,
    messages,
    selectedId,
    field,
    timeZone,
    canClearTopic,
    canClearSubtree,
    canClearAll,
    onselect,
    onlatest,
    oncleartopic,
    onclearsubtree,
    onclearall,
    ontoggle,
  }: Props = $props();
  const rowLimit = 500;
  let activeId = $derived(selectedId ?? messages.at(-1)?.id);
  let visibleMessages = $derived.by(() => {
    if (messages.length <= rowLimit) return [...messages].reverse();
    const selectedIndex =
      selectedId === null
        ? messages.length - 1
        : Math.max(
            0,
            messages.findIndex((message) => message.id === selectedId),
          );
    const start = Math.max(
      0,
      Math.min(
        messages.length - rowLimit,
        selectedIndex - Math.floor(rowLimit / 2),
      ),
    );
    return messages.slice(start, start + rowLimit).reverse();
  });
  let frequency = $derived(messageFrequency(messages));
  let span = $derived(messageSpan(messages));
  let retained = $derived(
    messages.filter((message) => message.retained).length,
  );
  let duplicates = $derived(
    messages.filter((message) => message.duplicate).length,
  );
  let gapBefore = $derived.by(() => {
    const ids = new Set<number>();
    for (let index = 1; index < messages.length; index += 1) {
      if (messages[index - 1].segment !== messages[index].segment)
        ids.add(messages[index].id);
    }
    return ids;
  });
  let showDate = $derived.by(() => {
    return historyNeedsDate(messages, Date.now(), timeZone);
  });
  let hasStatistics = $derived(
    Boolean(frequency || span || retained || duplicates || gapBefore.size),
  );

  function timestamp(value: number): string {
    return formatTelemetryTime(value, {
      timeZone,
      date: showDate,
      milliseconds: true,
    });
  }

  function selectRow(event: MouseEvent, id: number) {
    event.currentTarget instanceof HTMLElement && event.currentTarget.focus();
    onselect(id);
  }

  function move(id: number, key: string) {
    const index = messages.findIndex((message) => message.id === id);
    const nextIndex =
      key === "Home"
        ? messages.length - 1
        : key === "End"
          ? 0
          : index + (key === "ArrowDown" ? -1 : 1);
    const next =
      messages[Math.max(0, Math.min(messages.length - 1, nextIndex))];
    if (!next || next.id === id) return;
    onselect(next.id);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-history-id="${next.id}"]`)
        ?.focus(),
    );
  }

  function keydown(event: KeyboardEvent, id: number) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      move(id, event.key);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onselect(id);
    }
  }
</script>

<section class:expanded class="panel history-panel">
  <header class="panel-header">
    <h2>
      <button
        aria-controls="history-body"
        aria-expanded={expanded}
        class="history-disclosure"
        type="button"
        onclick={ontoggle}
        ><span aria-hidden="true">{expanded ? "▾" : "▸"}</span> History</button
      >
    </h2>
    <div class="controls">
      <button disabled={selectedId === null} type="button" onclick={onlatest}
        >Latest</button
      >
      <div class="clear-controls">
        <span class="meta">Clear</span>
        <button
          aria-label="Clear history for the selected topic"
          disabled={!canClearTopic}
          title="Does not clear retained broker messages"
          type="button"
          onclick={oncleartopic}>Topic</button
        >
        <button
          aria-label="Clear history for the selected topic and its descendants"
          disabled={!canClearSubtree}
          title="Does not clear retained broker messages"
          type="button"
          onclick={onclearsubtree}>Subtree</button
        >
        <button
          aria-label="Clear all history"
          disabled={!canClearAll}
          title="Does not clear retained broker messages"
          type="button"
          onclick={onclearall}>All</button
        >
      </div>
    </div>
    {#if hasStatistics}
      <div class="panel-stats meta">
        {#if frequency}<span>{frequency}</span>{/if}
        {#if span}<span>{span}</span>{/if}
        {#if retained}<span>{retained.toLocaleString()} retained</span>{/if}
        {#if duplicates}
          <span
            >{duplicates.toLocaleString()} possible {duplicates === 1
              ? "redelivery"
              : "redeliveries"}</span
          >
        {/if}
        {#if gapBefore.size}
          <span
            >{gapBefore.size.toLocaleString()} reconnect {gapBefore.size === 1
              ? "gap"
              : "gaps"}</span
          >
        {/if}
      </div>
    {/if}
  </header>
  {#if expanded}
    <div class="history-body" id="history-body">
      {#if messages.length}
        <div class="table-scroll">
          <table class:dated={showDate}>
            <thead>
              <tr>
                <th>Time</th><th>Value</th><th
                  title="R: retained; D: possible redelivery">R/D</th
                >
              </tr>
            </thead>
            <tbody>
              {#each visibleMessages as message (message.id)}
                {@const value = field
                  ? selectedMessageValue(message, field)
                  : messagePayloadPreview(message)}
                <tr
                  aria-selected={activeId === message.id}
                  class="message-row"
                  class:selected={activeId === message.id}
                  data-history-id={message.id}
                  tabindex={activeId === message.id ? 0 : -1}
                  onclick={(event) => selectRow(event, message.id)}
                  onkeydown={(event) => keydown(event, message.id)}
                >
                  <td>{timestamp(message.receivedAt)}</td>
                  <td title={value}>{value}</td>
                  <td
                    title={[
                      message.retained ? "Retained message" : "",
                      message.duplicate ? "Possible MQTT redelivery" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    >{message.retained ? "R" : ""}{message.retained &&
                    message.duplicate
                      ? " "
                      : ""}{message.duplicate ? "D" : ""}</td
                  >
                </tr>
                {#if gapBefore.has(message.id)}
                  <tr class="gap-row">
                    <td colspan="3"
                      >Reconnected · messages during gap unavailable</td
                    >
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
        {#if messages.length > visibleMessages.length}
          <span class="window-note meta">
            Showing {visibleMessages.length.toLocaleString()} rows around the selection
          </span>
        {/if}
      {:else}
        <p class="empty">No direct messages on this topic.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .history-panel {
    container-type: inline-size;
    display: grid;
    grid-template-rows: auto;
    min-height: 0;
  }

  .history-panel.expanded {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .history-panel:not(.expanded) > .panel-header {
    margin-bottom: 0;
  }

  .history-panel > .panel-header {
    column-gap: var(--space-tight);
  }

  .history-disclosure {
    background: transparent;
    border: 0;
    color: inherit;
    font: inherit;
    font-weight: inherit;
    min-height: 0;
    padding: 0;
  }

  .history-disclosure:hover {
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 0.2em;
  }

  .controls,
  .clear-controls {
    align-items: baseline;
    display: flex;
    white-space: nowrap;
  }

  .controls {
    font-size: var(--text-small);
    justify-content: flex-end;
    gap: var(--space-tight);
  }

  .clear-controls {
    gap: var(--space-tight);
  }

  .history-body {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-height: 0;
  }

  .table-scroll {
    min-height: 0;
    overflow: auto;
  }

  .window-note {
    border-top: 1px solid var(--border);
    padding-top: var(--space-tight);
  }

  table {
    border-collapse: collapse;
    font-size: var(--text-small);
    table-layout: fixed;
    min-width: 36rem;
    width: 100%;
  }

  th,
  td {
    border-bottom: 1px solid var(--border);
    line-height: var(--line);
    overflow: hidden;
    padding: 0 var(--space-tight);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  th {
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  th:first-child,
  td:first-child {
    width: 8.5rem;
  }

  table.dated th:first-child,
  table.dated td:first-child {
    width: 11rem;
  }

  th:last-child,
  td:last-child {
    width: 2.5rem;
  }

  tbody .message-row {
    cursor: default;
  }

  tbody .message-row:hover {
    background: var(--hover);
  }

  tbody .message-row:focus-visible {
    outline: 1px solid var(--focus);
    outline-offset: -1px;
  }

  tbody .message-row.selected {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--selected-mark);
  }

  .gap-row td {
    color: var(--muted);
    font-style: italic;
    text-align: center;
  }

  @media (max-width: 800px) {
    .history-panel.expanded {
      height: clamp(16rem, 40svh, 24rem);
    }
  }

  @media (max-width: 420px) {
    .history-panel > .panel-header {
      grid-template-columns: minmax(0, 1fr);
    }

    .controls {
      grid-column: 1;
      grid-row: 2;
    }

    .panel-stats {
      grid-column: 1;
      grid-row: 3;
    }
  }

  @container (max-width: 19rem) {
    .history-panel > .panel-header {
      grid-template-columns: minmax(0, 1fr);
    }

    .controls {
      grid-column: 1;
      grid-row: 2;
    }

    .panel-stats {
      grid-column: 1;
      grid-row: 3;
    }
  }
</style>
