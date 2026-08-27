<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    broker: string;
    filters: string;
    username: string;
    password: string;
  };

  let {
    broker = $bindable(),
    filters = $bindable(),
    username = $bindable(),
    password = $bindable(),
  }: Props = $props();
</script>

<div class="connection-fields">
  <label class="broker">
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
  <label class="username">
    Username
    <input autocomplete="username" bind:value={username} name="username" />
  </label>
  <label class="password">
    Password
    <input
      autocomplete="current-password"
      bind:value={password}
      name="password"
      type="password"
    />
  </label>
  <label class="subscriptions">
    Subscriptions <span class="hint">one MQTT filter per line</span>
    <textarea bind:value={filters} rows="3"></textarea>
  </label>
</div>

<style>
  .connection-fields {
    display: grid;
    gap: var(--space);
    grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  }

  label {
    display: grid;
    gap: var(--space-tight);
  }

  .subscriptions {
    grid-column: 1 / -1;
  }

  .hint {
    color: var(--muted);
    font-size: var(--text-small);
  }

  @media (max-width: 600px) {
    .connection-fields {
      grid-template-columns: 1fr;
    }

    .subscriptions {
      grid-column: auto;
    }
  }
</style>
