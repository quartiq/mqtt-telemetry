<svelte:options runes={true} />

<script lang="ts">
  import TreeView from "./TreeView.svelte";
  import {
    formatPayload,
    type JsonSnapshot,
    type TelemetryMessage,
  } from "./lib/model";

  type Props = {
    message?: TelemetryMessage;
    snapshot?: JsonSnapshot;
    selected: string;
    expanded: Set<string>;
    onselect: (id: string) => void;
    ontoggle: (id: string, open: boolean) => void;
  };

  let { message, snapshot, selected, expanded, onselect, ontoggle }: Props =
    $props();

  function timestamp(value: number): string {
    return new Date(value).toLocaleString();
  }
</script>

<section class="panel message-panel">
  <header>
    <h2>Message</h2>
    {#if message}
      <span class="meta">
        {timestamp(message.receivedAt)} · {message.retained
          ? "retained · "
          : ""}{message.duplicate ? "possible duplicate · " : ""}QoS
        {message.qos} · {message.bytes.toLocaleString()} bytes
        {message.unsafeIntegers ? " · unsafe integer precision" : ""}
      </span>
    {/if}
  </header>
  {#if message?.payload.kind === "json" && snapshot}
    <div class="message-tree">
      <TreeView
        roots={snapshot.roots}
        nodes={snapshot.nodes}
        {selected}
        {expanded}
        label="JSON fields"
        {onselect}
        {ontoggle}
      />
    </div>
  {:else if message}
    <pre>{formatPayload(message.payload)}</pre>
  {:else}
    <p class="empty">Select a topic with messages.</p>
  {/if}
</section>

<style>
  .message-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .message-tree {
    min-height: 0;
    overflow: auto;
  }

  pre {
    min-height: 0;
    overflow: auto;
  }

  @media (max-width: 800px) {
    .message-panel {
      min-height: 12rem;
    }
  }
</style>
