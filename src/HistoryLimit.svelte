<svelte:options runes={true} />

<script lang="ts">
  import { MAX_HISTORY_LIMIT } from "./lib/routes";

  type Props = {
    value: number;
    onchange: (value: number) => boolean | void;
  };

  let { value, onchange }: Props = $props();

  function commit(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.reportValidity() || onchange(Number(input.value)) === false)
      input.value = String(value);
  }
</script>

<label title="Maximum buffered messages for each topic">
  Keep up to
  <input
    aria-label="Messages kept per topic"
    max={MAX_HISTORY_LIMIT}
    min="1"
    onchange={commit}
    required
    step="1"
    type="number"
    {value}
  />
  messages/topic
</label>

<style>
  label {
    align-items: baseline;
    color: var(--muted);
    display: flex;
    font-size: var(--text-small);
    gap: var(--space-tight);
    white-space: nowrap;
  }

  input {
    height: var(--line);
    padding-block: 0;
    width: 5.5rem;
  }
</style>
