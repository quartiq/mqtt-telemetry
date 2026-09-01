<svelte:options runes={true} />

<script lang="ts">
  import {
    formatTelemetryTime,
    historyNeedsDate,
    messagePayloadPreview,
    messageFrequency,
    messageSpan,
    selectedMessageValue,
    type JsonPath,
    type DisplayTimeZone,
    type TelemetryMessage,
  } from "./lib/model";

  type Props = {
    messages: readonly TelemetryMessage[];
    selectedId: number | null;
    field: JsonPath | undefined;
    fieldLabel?: string;
    timeZone: DisplayTimeZone;
    canClearTopic: boolean;
    canClearSubtree: boolean;
    canClearAll: boolean;
    onselect: (id: number) => void;
    onlatest: () => void;
    oncleartopic: () => void;
    onclearsubtree: () => void;
    onclearall: () => void;
  };

  let {
    messages,
    selectedId,
    field,
    fieldLabel,
    timeZone,
    canClearTopic,
    canClearSubtree,
    canClearAll,
    onselect,
    onlatest,
    oncleartopic,
    onclearsubtree,
    onclearall,
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

<section class="panel history-panel">
  <header class="panel-header">
    <h2>History</h2>
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
    <div class="panel-stats meta">
      <span>{messages.length.toLocaleString()} messages</span>
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
      <span title={fieldLabel ?? "Full payload summary"}
        >{fieldLabel ? `field ${fieldLabel}` : "payload"}</span
      >
    </div>
  </header>
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
</section>

<style>
  .history-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
  }

  .controls,
  .clear-controls {
    align-items: baseline;
    display: flex;
    white-space: nowrap;
  }

  .controls {
    gap: var(--space);
  }

  .clear-controls {
    gap: var(--space-tight);
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
    .history-panel {
      height: clamp(16rem, 40svh, 24rem);
    }
  }

  @media (max-width: 420px) {
    .history-panel > .panel-header {
      grid-template-columns: minmax(0, 1fr);
    }

    .history-panel > .panel-header h2 {
      grid-column: 1;
      grid-row: 1;
    }

    .controls {
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
