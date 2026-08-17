<svelte:options runes={true} />

<script lang="ts">
  import {
    selectedMessageValue,
    type JsonPath,
    type TelemetryMessage,
  } from "./lib/model";
  import { MAX_HISTORY_LIMIT } from "./lib/routes";

  type Props = {
    messages: TelemetryMessage[];
    selectedId: number | null;
    field: JsonPath | undefined;
    historyLimit: number;
    onselect: (id: number) => void;
    onlatest: () => void;
    onlimit: (limit: number) => void;
    onclear: () => void;
  };

  let {
    messages,
    selectedId,
    field,
    historyLimit,
    onselect,
    onlatest,
    onlimit,
    onclear,
  }: Props = $props();
  let newestFirst = $derived([...messages].reverse());
  let activeId = $derived(selectedId ?? newestFirst[0]?.id);

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
    const index = newestFirst.findIndex((message) => message.id === id);
    const nextIndex =
      key === "Home"
        ? 0
        : key === "End"
          ? newestFirst.length - 1
          : index + (key === "ArrowDown" ? 1 : -1);
    const next =
      newestFirst[Math.max(0, Math.min(newestFirst.length - 1, nextIndex))];
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

  function changeLimit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.reportValidity()) {
      input.value = String(historyLimit);
      return;
    }
    onlimit(Number(input.value));
  }
</script>

<section class="panel history-panel">
  <header>
    <h2>
      History <span class="count">({messages.length.toLocaleString()})</span>
    </h2>
    <div class="controls">
      <label title="Maximum messages kept per topic">
        Limit
        <input
          aria-label="History limit"
          max={MAX_HISTORY_LIMIT}
          min="1"
          onchange={changeLimit}
          required
          step="1"
          type="number"
          value={historyLimit}
        />
      </label>
      <button disabled={!messages.length} type="button" onclick={onclear}
        >Clear</button
      >
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
          {#each newestFirst as message (message.id)}
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
              <td>QoS {message.qos}</td>
              <td title={selectedMessageValue(message, field)}
                >{selectedMessageValue(message, field)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="empty">No direct messages on this topic.</p>
  {/if}
</section>

<style>
  .history-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .controls {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
    margin-left: auto;
  }

  .controls label {
    align-items: baseline;
    color: var(--muted);
    display: flex;
    font-size: var(--text-small);
    gap: var(--space-tight);
  }

  .controls input {
    height: var(--line);
    padding-block: 0;
    width: 5.5rem;
  }

  .count {
    color: var(--muted);
    font-weight: 400;
  }

  .table-scroll {
    min-height: 0;
    overflow: auto;
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
    width: 4.5rem;
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
