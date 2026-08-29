<svelte:options runes={true} />

<script lang="ts">
  import TelemetryPlot from "./TelemetryPlot.svelte";
  import {
    plotTimeDomain,
    type DisplayTimeZone,
    type PlotPoint,
  } from "./lib/model";
  import type { PlotRef } from "./lib/routes";
  import { formatDuration } from "./lib/duration";

  export type DashboardPlot = PlotRef & {
    key: string;
    label: string;
    points: PlotPoint[];
    retainedExcluded: number;
  };

  type Props = {
    plots: DashboardPlot[];
    now: number;
    windowMs: number | null;
    timeZone: DisplayTimeZone;
    onfocus: (plot: PlotRef) => void;
    onmove: (plot: PlotRef, offset: -1 | 1) => void;
    onremove: (plot: PlotRef) => void;
    onshowall: () => void;
  };

  let {
    plots,
    now,
    windowMs,
    timeZone,
    onfocus,
    onmove,
    onremove,
    onshowall,
  }: Props = $props();
  let domain = $derived(plotTimeDomain(plots, now, windowMs));
  let windowLabel = $derived(
    windowMs === null ? undefined : `the last ${formatDuration(windowMs)}`,
  );
  let inspectTime = $state<number | undefined>();
</script>

<section class="plot-dashboard">
  {#if plots.length}
    <div class:two-columns={plots.length > 4} class="plot-grid">
      {#each plots as plot, index (plot.key)}
        <TelemetryPlot
          points={plot.points}
          topic={plot.topic}
          label={plot.label}
          retainedExcluded={plot.retainedExcluded}
          xMin={domain.min}
          xMax={domain.max}
          {timeZone}
          {inspectTime}
          oninspect={(time) => (inspectTime = time)}
          onfocus={() => onfocus(plot)}
          canMoveEarlier={index > 0}
          canMoveLater={index < plots.length - 1}
          onmoveearlier={() => onmove(plot, -1)}
          onmovelater={() => onmove(plot, 1)}
          onremove={() => onremove(plot)}
          {windowLabel}
          {onshowall}
        />
      {/each}
    </div>
  {:else}
    <p class="empty">Pin numeric fields to compare them here.</p>
  {/if}
</section>

<style>
  .plot-dashboard {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: grid;
    grid-column: 1 / -1;
    min-height: 0;
    overflow: hidden;
  }

  .plot-grid {
    display: grid;
    gap: var(--space);
    grid-auto-rows: minmax(16rem, 1fr);
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    overflow: auto;
    padding: var(--space);
  }

  .plot-grid.two-columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .empty {
    padding: var(--space);
  }

  @media (max-width: 800px) {
    .plot-dashboard {
      overflow: visible;
    }

    .plot-grid,
    .plot-grid.two-columns {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      overflow: visible;
    }
  }
</style>
