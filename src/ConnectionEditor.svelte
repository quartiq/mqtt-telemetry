<svelte:options runes={true} />

<script lang="ts">
  import { untrack } from "svelte";
  import type { Connection, ConnectionTarget } from "./lib/connection.svelte";
  import type { SessionAuth } from "./lib/mqtt-session";
  import {
    isWebSocketBroker,
    subscriptionLines,
    uniqueFilters,
  } from "./lib/routes";

  type Props = {
    target: ConnectionTarget;
    connection: Connection;
    onapply: (target: ConnectionTarget, auth: SessionAuth) => void;
    oncancel: () => void;
  };

  let { target, connection, onapply, oncancel }: Props = $props();
  // A fresh editor starts from applied settings; live status changes must not
  // replace a draft or a password manager's DOM-only autofill.
  let broker = $state(untrack(() => target.broker));
  let credentialBroker = $state(untrack(() => target.broker));
  let filters = $state(untrack(() => target.filters.join("\n")));
  let username = $state(untrack(() => connection.auth.username));
  let password = $state(untrack(() => connection.auth.password));
  let error = $state("");
  let transportMatches = $derived(
    broker.trim() === target.broker &&
      username === connection.auth.username &&
      password === connection.auth.password,
  );
  let draftMatches = $derived(
    transportMatches &&
      JSON.stringify(uniqueFilters(filters.split(/\r?\n/))) ===
        JSON.stringify(target.filters),
  );
  let canRefresh = $derived(
    Boolean(connection.session) &&
      connection.state === "connected" &&
      target.filters.length > 0 &&
      draftMatches,
  );

  $effect(() => {
    if (broker.trim() !== credentialBroker) {
      credentialBroker = broker.trim();
      username = password = "";
    }
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const submittedBroker = String(data.get("broker") ?? "").trim();
    // Autofill can bypass bindings. An unobserved URI change must still clear
    // credentials before another ordinary Connect/Apply submission.
    if (submittedBroker !== credentialBroker) {
      broker = credentialBroker = submittedBroker;
      username = password = "";
      for (const name of ["username", "password"])
        (form.elements.namedItem(name) as HTMLInputElement).value = "";
      error =
        "Broker changed. Enter credentials for this broker, then connect.";
      return;
    }
    broker = submittedBroker;
    filters = String(data.get("subscriptions") ?? "");
    username = String(data.get("username") ?? "");
    password = String(data.get("password") ?? "");
    error = isWebSocketBroker(broker) ?? "";
    if (error) return;
    let subscriptions: string[];
    try {
      subscriptions = subscriptionLines(filters);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      return;
    }
    if (connection.session && connection.state !== "failed" && draftMatches) {
      oncancel();
      return;
    }
    onapply({ broker, filters: subscriptions }, { username, password });
  }

  // A browser hint, not a guarantee that password managers isolate brokers.
  const credentialSection = $derived(
    `section-broker${Array.from(new TextEncoder().encode(broker.trim()), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as const,
  );
</script>

<form autocomplete="on" class="connection-editor" onsubmit={submit}>
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
    {#key credentialSection}
      <label class="username">
        Username
        <input
          autocomplete={`${credentialSection} username`}
          bind:value={username}
          name="username"
        />
      </label>
      <label class="password">
        Password
        <input
          autocomplete={`${credentialSection} current-password`}
          bind:value={password}
          name="password"
          type="password"
        />
      </label>
    {/key}
    <label class="subscriptions">
      Subscriptions <span class="hint"
        >one MQTT filter per line; empty means no subscriptions</span
      >
      <textarea bind:value={filters} name="subscriptions" rows="3"></textarea>
    </label>
  </div>
  {#if error}<strong class="header-error" role="alert">{error}</strong>{/if}
  {#if target.broker && broker.trim() !== target.broker}
    <p class="meta">Changing broker clears this tab's history and plots.</p>
  {:else if target.broker && !transportMatches}
    <p class="meta">
      Changing credentials reconnects and keeps history and plots.
    </p>
  {/if}
  <div class="connection-editor-actions">
    <button disabled={connection.busy} type="submit"
      >{connection.session ? "Apply" : "Connect"}</button
    >
    {#if connection.session}
      <button
        disabled={connection.busy || !draftMatches}
        type="button"
        title="Reconnect using the applied settings"
        onclick={() => {
          oncancel();
          void connection.reconnect();
        }}>Reconnect</button
      >
      <button
        disabled={!canRefresh}
        title="Request retained values again and retry rejected filters"
        type="button"
        onclick={() => {
          oncancel();
          void connection.refresh();
        }}>Refresh subscriptions</button
      >
    {/if}
    {#if target.broker}<button type="button" onclick={oncancel}>Cancel</button
      >{/if}
  </div>
</form>

<style>
  .connection-editor {
    border-top: 1px solid var(--border);
    display: grid;
    gap: var(--space);
    grid-column: 1 / -1;
    padding-top: var(--space);
  }

  .connection-editor-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-tight);
  }

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
