<svelte:options runes={true} />

<script lang="ts">
  import { DURATION_OPTIONS, formatDuration } from "./lib/duration";

  type Props = {
    value: number | null;
    noneLabel: string;
    ariaLabel: string;
    prefix?: string;
    onchange: (value: number | null) => boolean | void;
  };

  let { value, noneLabel, ariaLabel, prefix = "", onchange }: Props = $props();
  let presetValues = new Set<number>(
    DURATION_OPTIONS.map(({ milliseconds }) => milliseconds),
  );

  function commit(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value ? Number(select.value) : null;
    if (onchange(next) === false) select.value = String(value ?? "");
  }
</script>

<select aria-label={ariaLabel} onchange={commit} value={value ?? ""}>
  <option value="">{noneLabel}</option>
  {#each DURATION_OPTIONS as option}
    <option value={option.milliseconds}>{prefix}{option.label}</option>
  {/each}
  {#if value !== null && !presetValues.has(value)}
    <option {value}>{prefix}{formatDuration(value)}</option>
  {/if}
</select>

<style>
  select {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: inherit;
    height: var(--line);
    padding-block: 0;
    width: auto;
  }
</style>
