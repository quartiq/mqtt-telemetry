<svelte:options runes={true} />

<script lang="ts">
  import {
    selectedMessageValue,
    type JsonPath,
    type TelemetryMessage,
  } from "./lib/model";

  type Props = {
    messages: TelemetryMessage[];
    selectedId: number | null;
    field: JsonPath;
    onselect: (id: number) => void;
    onlatest: () => void;
  };

  let { messages, selectedId, field, onselect, onlatest }: Props = $props();
  let newestFirst = $derived([...messages].reverse());

  function timestamp(value: number): string {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      fractionalSecondDigits: 3,
    });
  }
</script>

<section class="panel history-panel">
  <header>
    <h2>
      History <span class="count">({messages.length.toLocaleString()})</span>
    </h2>
    <button disabled={selectedId === null} type="button" onclick={onlatest}
      >Latest</button
    >
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
              aria-selected={selectedId === message.id}
              class:selected={selectedId === message.id}
              tabindex="0"
              onclick={() => onselect(message.id)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onselect(message.id);
                }
              }}
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
    min-height: 10rem;
  }

  header button {
    margin-left: auto;
  }

  .count {
    color: var(--muted);
    font-weight: 400;
  }

  .table-scroll {
    max-height: 18rem;
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
</style>
