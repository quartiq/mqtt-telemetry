<svelte:options runes={true} />

<script lang="ts">
  import HistoryLimit from "./HistoryLimit.svelte";
  import ConnectionFields from "./ConnectionFields.svelte";

  type Props = {
    broker: string;
    filters: string;
    username: string;
    password: string;
    historyLimit: number;
    historyAgeMs: number | null;
    status: string;
    error: string;
    connecting: boolean;
    onconnect: () => void;
    onload: () => void;
  };

  let {
    broker = $bindable(),
    filters = $bindable(),
    username = $bindable(),
    password = $bindable(),
    historyLimit = $bindable(),
    historyAgeMs = $bindable(),
    status,
    error,
    connecting,
    onconnect,
    onload,
  }: Props = $props();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onconnect();
  }

  function changeHistoryLimit(value: number) {
    historyLimit = value;
  }

  function changeHistoryAge(value: number | null) {
    historyAgeMs = value;
  }
</script>

<main class="landing">
  <section class="connect panel">
    <header>
      <h1>MQTT Telemetry</h1>
      <span class="meta">JSON topic browser</span>
    </header>
    <form autocomplete="on" onsubmit={submit}>
      <ConnectionFields bind:broker bind:filters bind:username bind:password />
      <div class="actions">
        <button disabled={connecting} type="submit"
          >{connecting ? "Connecting…" : "Connect"}</button
        >
        <button type="button" onclick={onload}>Load dashboard…</button>
        <HistoryLimit
          value={historyLimit}
          onchange={changeHistoryLimit}
          ageMs={historyAgeMs}
          onagechange={changeHistoryAge}
        />
      </div>
    </form>
    <div aria-live="polite" class="feedback">
      <span>{status}</span>
      {#if error}<strong>{error}</strong>{/if}
    </div>
  </section>
</main>

<style>
  .landing {
    align-items: start;
    display: grid;
    min-height: 100svh;
    padding-top: max(12vh, var(--space));
  }

  .connect {
    margin-inline: auto;
    max-width: 36rem;
    width: 100%;
  }

  form {
    display: grid;
    gap: var(--space);
  }

  .actions,
  .feedback {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space);
  }

  .feedback {
    border-top: 1px solid var(--border);
    margin-top: var(--space);
    padding-top: var(--space-tight);
  }

  .feedback strong {
    color: var(--error);
    font-weight: 500;
  }
</style>
