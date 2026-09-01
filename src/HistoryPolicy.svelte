<svelte:options runes={true} />

<script lang="ts">
  import { MAX_HISTORY_LIMIT } from "./lib/routes";
  import DurationSelect from "./DurationSelect.svelte";

  type Props = {
    value: number;
    onchange: (value: number) => boolean | void;
    ageMs: number | null;
    onagechange: (value: number | null) => boolean | void;
  };

  let { value, onchange, ageMs, onagechange }: Props = $props();

  function commit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.reportValidity() || onchange(Number(input.value)) === false)
      input.value = String(value);
  }
</script>

<div class="history-policy">
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
</div>

<style>
  .history-policy {
    align-items: baseline;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    font-size: var(--text-small);
    gap: var(--space-tight);
  }

  label {
    align-items: baseline;
    display: flex;
    gap: var(--space-tight);
    white-space: nowrap;
  }

  input {
    height: var(--line);
    padding-block: 0;
    width: 4rem;
  }
</style>
