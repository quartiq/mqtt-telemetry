<svelte:options runes={true} />

<script lang="ts">
  import { MAX_HISTORY_LIMIT } from "./lib/routes";

  type Props = {
    value: number;
    onchange: (value: number) => boolean | void;
    ageMs: number | null;
    onagechange: (value: number | null) => boolean | void;
  };

  let { value, onchange, ageMs, onagechange }: Props = $props();
  const ages = new Set([
    60_000, 600_000, 3_600_000, 21_600_000, 86_400_000, 604_800_000,
  ]);

  function commit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.reportValidity() || onchange(Number(input.value)) === false)
      input.value = String(value);
  }

  function commitAge(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value ? Number(select.value) : null;
    if (onagechange(next) === false) select.value = String(ageMs ?? "");
  }

  function formatAge(value: number): string {
    const seconds = value / 1000;
    return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
  }
</script>

<div class="retention">
  <label
    title="Maximum recent live messages for each topic; the latest retained snapshot is kept separately"
  >
    Keep
    <input
      aria-label="Live messages kept per topic"
      max={MAX_HISTORY_LIMIT}
      min="1"
      onchange={commit}
      required
      step="1"
      type="number"
      {value}
    />
    live/topic
  </label>
  <label
    title="Discard locally buffered live messages older than this; retained snapshots are kept separately"
  >
    for
    <select
      aria-label="Maximum live history age"
      onchange={commitAge}
      value={ageMs ?? ""}
    >
      <option value="">any age</option>
      <option value={60_000}>1 min</option>
      <option value={600_000}>10 min</option>
      <option value={3_600_000}>1 hour</option>
      <option value={21_600_000}>6 hours</option>
      <option value={86_400_000}>24 hours</option>
      <option value={604_800_000}>7 days</option>
      {#if ageMs !== null && !ages.has(ageMs)}
        <option value={ageMs}>{formatAge(ageMs)}</option>
      {/if}
    </select>
  </label>
</div>

<style>
  .retention,
  label {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
    white-space: nowrap;
  }

  .retention {
    color: var(--muted);
    flex-wrap: wrap;
    font-size: var(--text-small);
  }

  input {
    height: var(--line);
    padding-block: 0;
    width: 5.5rem;
  }

  select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: inherit;
    height: var(--line);
  }
</style>
