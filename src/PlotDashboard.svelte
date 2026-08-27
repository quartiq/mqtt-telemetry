<svelte:options runes={true} />

<script lang="ts">
  import TelemetryPlot from "./TelemetryPlot.svelte";
  import { plotTimeDomain, type PlotPoint } from "./lib/model";
  import type { PlotRef } from "./lib/routes";

  export type DashboardPlot = PlotRef & {
    key: string;
    label: string;
    points: PlotPoint[];
    retainedExcluded: number;
  };

  type Props = {
    plots: DashboardPlot[];
    now: number;
    ageMs: number | null;
    onfocus: (plot: PlotRef) => void;
    onremove: (plot: PlotRef) => void;
    onremoveall: () => void;
  };

  let { plots, now, ageMs, onfocus, onremove, onremoveall }: Props = $props();
  let domain = $derived(plotTimeDomain(plots, now, ageMs));
</script>

<section class="plot-dashboard">
  <header>
    <div>
      <h2>Plots</h2>
      <span class="meta">
        {plots.length.toLocaleString()} pinned · shared receipt-time axis
      </span>
    </div>
    <button disabled={!plots.length} type="button" onclick={onremoveall}
      >Remove all</button
    >
  </header>
  {#if plots.length}
    <div class:single={plots.length === 1} class="plot-grid">
      {#each plots as plot (plot.key)}
        <TelemetryPlot
          points={plot.points}
          topic={plot.topic}
          label={plot.label}
          retainedExcluded={plot.retainedExcluded}
          xMin={domain.min}
          xMax={domain.max}
          onfocus={() => onfocus(plot)}
          onremove={() => onremove(plot)}
        />
      {/each}
    </div>
  {:else}
    <p class="empty">
      Pin numeric fields from Current value to compare them here.
    </p>
  {/if}
</section>

<style>
  .plot-dashboard {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: grid;
    grid-column: 1 / -1;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .plot-dashboard > header {
    align-items: center;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    padding: var(--space-tight) var(--space);
  }

  .plot-dashboard > header > div {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space);
    min-width: 0;
  }

  .plot-grid {
    display: grid;
    gap: var(--space);
    grid-auto-rows: minmax(16rem, 1fr);
    grid-template-columns: repeat(2, minmax(0, 1fr));
    min-height: 0;
    overflow: auto;
    padding: var(--space);
  }

  .plot-grid.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .empty {
    padding: var(--space);
  }

  @media (max-width: 800px) {
    .plot-dashboard {
      overflow: visible;
    }

    .plot-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      overflow: visible;
    }
  }
</style>
