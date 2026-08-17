<svelte:options runes={true} />

<script lang="ts">
  import {
    messagePayloadPreview,
    messageFrequency,
    messageSpan,
    selectedMessageValue,
    type JsonPath,
    type TelemetryMessage,
  } from "./lib/model";

  type Props = {
    messages: TelemetryMessage[];
    selectedId: number | null;
    field: JsonPath | undefined;
    fieldLabel?: string;
    onselect: (id: number) => void;
    onlatest: () => void;
  };

  let { messages, selectedId, field, fieldLabel, onselect, onlatest }: Props =
    $props();
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

  function timestamp(value: number): string {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      fractionalSecondDigits: 3,
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
  <header>
    <h2>
      Topic history
      <span class="count">({messages.length.toLocaleString()})</span>
    </h2>
    <div class="summary meta">
      {#if frequency}<span>{frequency} · </span>{/if}
      {#if span}<span>{span} · </span>{/if}
      <span title={fieldLabel ?? "Full payload summary"}
        >{fieldLabel ? `field ${fieldLabel}` : "payload"}</span
      >
    </div>
    <div class="controls">
      <button disabled={selectedId === null} type="button" onclick={onlatest}
        >Latest</button
      >
    </div>
  </header>
  {#if messages.length}
    <div class="table-scroll">
      <table>
        <thead>
          <tr><th>Time</th><th>Delivery</th><th>Value</th></tr>
        </thead>
        <tbody>
          {#each visibleMessages as message (message.id)}
            {@const value = field
              ? selectedMessageValue(message, field)
              : messagePayloadPreview(message)}
            <tr
              aria-selected={activeId === message.id}
              class:selected={activeId === message.id}
              data-history-id={message.id}
              tabindex={activeId === message.id ? 0 : -1}
              onclick={(event) => selectRow(event, message.id)}
              onkeydown={(event) => keydown(event, message.id)}
            >
              <td
                >{message.retained
                  ? "retained"
                  : timestamp(message.receivedAt)}</td
              >
              <td title={message.duplicate ? "Possible MQTT redelivery" : ""}
                >QoS {message.qos}{message.duplicate ? " · DUP" : ""}</td
              >
              <td title={value}>{value}</td>
            </tr>
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

  .controls {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
    white-space: nowrap;
  }

  .count {
    color: var(--muted);
    font-weight: 400;
  }

  .history-panel > header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  h2 {
    white-space: nowrap;
  }

  .summary {
    grid-column: 1 / -1;
    grid-row: 2;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  th:first-child,
  td:first-child {
    width: 8.5rem;
  }

  th:nth-child(2),
  td:nth-child(2) {
    width: 6.5rem;
  }

  tbody tr {
    cursor: default;
  }

  tbody tr:hover {
    background: var(--hover);
  }

  tbody tr:focus-visible {
    outline: 1px solid var(--focus);
    outline-offset: -1px;
  }

  tbody tr.selected {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--selected-mark);
  }

  @media (max-width: 800px) {
    .history-panel {
      min-height: 14rem;
    }
  }
</style>
