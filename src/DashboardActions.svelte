<svelte:options runes={true} />

<script lang="ts">
  import {
    dashboardJson,
    dashboardShareUrl,
    parseDashboardJson,
    type Dashboard,
  } from "./lib/dashboard";
  import type { AppRoute } from "./lib/routes";

  let {
    route,
    onload,
  }: {
    route: AppRoute;
    onload: (dashboard: Dashboard) => void;
  } = $props();
  let fileInput: HTMLInputElement;
  let notice = $state("");
  let error = $state("");

  async function load(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    error = notice = "";
    if (file.size > 1024 * 1024) {
      error = "Dashboard file is too large.";
      return;
    }
    try {
      onload(parseDashboardJson(await file.text()));
      notice = `Loaded ${file.name}`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function save() {
    error = "";
    const blob = new Blob([dashboardJson(route)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mqtt-telemetry-dashboard.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
    notice = "Dashboard saved";
  }

  async function copyLink() {
    error = notice = "";
    const url = dashboardShareUrl(route, location);
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          // The fallback also works for local files and restricted clipboards.
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        try {
          textarea.select();
          if (!document.execCommand("copy")) throw new Error();
        } finally {
          textarea.remove();
        }
      }
      notice = "Share link copied";
    } catch {
      notice = "Clipboard unavailable; save the dashboard JSON instead.";
    }
  }
</script>

<div class="dashboard-actions" aria-label="Dashboard">
  <input
    accept="application/json,.json"
    bind:this={fileInput}
    type="file"
    hidden
    onchange={load}
  />
  <button disabled={!route.broker} type="button" onclick={save}>Save</button>
  <button type="button" onclick={() => fileInput.click()}>Load…</button>
  <button
    disabled={!route.broker}
    title="Copy a self-contained link for the complete dashboard"
    type="button"
    onclick={copyLink}>Copy dashboard</button
  >
  {#if error}<strong class="header-error" role="alert">{error}</strong>{/if}
  {#if notice}<span class="meta" role="status">{notice}</span>{/if}
</div>

<style>
  .dashboard-actions {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-tight);
  }
</style>
