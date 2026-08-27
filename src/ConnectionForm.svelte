<svelte:options runes={true} />

<script lang="ts">
  import HistoryLimit from "./HistoryLimit.svelte";

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
      <label>
        Broker
        <input
          autocomplete="url"
          bind:value={broker}
          name="broker"
          placeholder="wss://mqtt.example.com:443/path/to/socket"
          required
          title="Use MQTT over WebSocket. LAN brokers may require browser Local Network Access permission; TLS certificates must be browser-trusted."
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
          <input
            autocomplete="username"
            bind:value={username}
            name="username"
          />
        </label>
        <label>
          Password
          <input
            autocomplete="current-password"
            bind:value={password}
            name="password"
            type="password"
          />
        </label>
      </div>
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
