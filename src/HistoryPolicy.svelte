<svelte:options runes={true} />

<script lang="ts">
  import { MAX_HISTORY_LIMIT } from "./lib/routes";
  import DurationSelect from "./DurationSelect.svelte";

  type Props = {
    value: number;
    onchange: (value: number) => boolean | void;
    ageMs: number | null;
    onagechange: (value: number | null) => boolean | void;
    canClear: boolean;
    onclear: () => void;
  };

  let { value, onchange, ageMs, onagechange, canClear, onclear }: Props =
    $props();

  function commit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.reportValidity() || onchange(Number(input.value)) === false)
      input.value = String(value);
  }
</script>

<div aria-label="History policy" class="history-policy">
  <label
    title="Maximum recent live messages for each topic; the latest retained snapshot is kept separately"
  >
    Max
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
    /topic
  </label>
  <label
    title="Discard history messages older than this; retained snapshots are kept separately"
  >
    Age
    <DurationSelect
      ariaLabel="Maximum live history age"
      noneLabel="none"
      value={ageMs}
      onchange={onagechange}
    />
  </label>
  <button
    aria-label="Clear all history"
    disabled={!canClear}
    title="Does not clear retained broker messages"
    type="button"
    onclick={onclear}>Clear all</button
  >
</div>

<style>
  .history-policy,
  label {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
    white-space: nowrap;
  }

  .history-policy {
    color: var(--muted);
    flex-wrap: wrap;
    font-size: var(--text-small);
  }

  input {
    height: var(--line);
    padding-block: 0;
    width: 4rem;
  }
</style>
