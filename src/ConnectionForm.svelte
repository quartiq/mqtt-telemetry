<svelte:options runes={true} />

<script lang="ts">
  import HistoryLimit from "./HistoryLimit.svelte";

  type Props = {
    broker: string;
    filters: string;
    username: string;
    password: string;
    historyLimit: number;
    status: string;
    error: string;
    onconnect: () => void;
  };

  let {
    broker = $bindable(),
    filters = $bindable(),
    username = $bindable(),
    password = $bindable(),
    historyLimit = $bindable(),
    status,
    error,
    onconnect,
  }: Props = $props();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onconnect();
  }

  function changeHistoryLimit(value: number) {
    historyLimit = value;
  }
</script>

<main class="landing">
  <section class="connect panel">
    <header>
      <h1>MQTT Telemetry</h1>
      <span class="meta">JSON topic browser</span>
    </header>
    <form onsubmit={submit}>
      <label>
        Broker
        <input
          autocomplete="url"
          bind:value={broker}
          placeholder="ws://localhost:9001"
          required
          type="url"
        />
      </label>
      <label>
        Subscriptions <span class="hint">one MQTT filter per line</span>
        <textarea bind:value={filters} rows="4"></textarea>
      </label>
      <div class="credentials">
        <label>
          Username
          <input autocomplete="username" bind:value={username} />
        </label>
        <label>
          Password
          <input
            autocomplete="current-password"
            bind:value={password}
            type="password"
          />
        </label>
      </div>
      <div class="actions">
        <button type="submit">Connect</button>
        <HistoryLimit value={historyLimit} onchange={changeHistoryLimit} />
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

  form,
  label {
    display: grid;
    gap: var(--space-tight);
  }

  form {
    gap: var(--space);
  }

  .credentials {
    display: grid;
    gap: var(--space);
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .hint {
    color: var(--muted);
    font-size: var(--text-small);
  }

  @media (max-width: 600px) {
    .credentials {
      grid-template-columns: 1fr;
    }
  }
</style>
