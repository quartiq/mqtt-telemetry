<svelte:options runes={true} />

<script lang="ts">
  import {
    downsamplePlotPoints,
    formatPlotNumber,
    type PlotPoint,
  } from "./lib/model";

  type Props = {
    points: PlotPoint[];
    label?: string;
    retainedExcluded: number;
  };
  let { points, label, retainedExcluded }: Props = $props();

  const width = 640;
  const height = 220;
  const left = 82;
  const right = 16;
  const top = 10;
  const bottom = 32;
  let displayPoints = $derived(
    downsamplePlotPoints(points, width - left - right),
  );
  let plot = $derived.by(() => {
    if (points.length < 2) return undefined;
    const xMin = points[0].x;
    const xMax = points.at(-1)?.x ?? xMin;
    let yMin = points[0].y;
    let yMax = yMin;
    for (const point of points) {
      yMin = Math.min(yMin, point.y);
      yMax = Math.max(yMax, point.y);
    }
    const dataMin = yMin;
    const dataMax = yMax;
    if (yMin === yMax) {
      const padding = Math.abs(yMin) * 0.05 || 1;
      yMin -= padding;
      yMax += padding;
    }
    const step = (yMax - yMin) / 5;
    return {
      xMin,
      xMax: Math.max(xMax, xMin + 0.001),
      dataMin,
      dataMax,
      yMin,
      yMax,
      step,
      yTicks: Array.from({ length: 6 }, (_, index) => {
        const ratio = index / 5;
        const value = yMin + ratio * (yMax - yMin);
        return { label: formatPlotNumber(value, step), ratio };
      }),
    };
  });
  let xTicks = $derived.by(() =>
    plot
      ? Array.from({ length: 5 }, (_, index) => {
          const ratio = index / 4;
          return {
            label: time(
              plot.xMin + ratio * (plot.xMax - plot.xMin),
              plot.xMax - plot.xMin,
            ),
            ratio,
          };
        })
      : [],
  );
  let line = $derived.by(() => {
    if (!plot) return "";
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    return displayPoints
      .map((point) => {
        const x =
          left + ((point.x - plot.xMin) / (plot.xMax - plot.xMin)) * plotWidth;
        const y =
          top + ((plot.yMax - point.y) / (plot.yMax - plot.yMin)) * plotHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  });
  let statistics = $derived.by(() => {
    const items: string[] = [];
    if (label) items.push(`field ${label}`);
    if (plot) {
      const latest = points.at(-1)!.y;
      const latestLabel = formatPlotNumber(latest, plot.step);
      items.push(`latest ${latestLabel}`);
      items.push(
        `range ${formatPlotNumber(plot.dataMax - plot.dataMin, plot.step)}`,
      );
    }
    items.push(
      `${points.length.toLocaleString()} ${points.length === 1 ? "live sample" : "live samples"}`,
    );
    if (retainedExcluded)
      items.push(`${retainedExcluded.toLocaleString()} retained excluded`);
    return items;
  });

  function time(value: number, span: number): string {
    return new Date(value).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(span < 10_000 ? { fractionalSecondDigits: 3 } : {}),
    });
  }
</script>

<section
  class="panel plot-panel"
  aria-label={label ? `Plot of ${label}` : "Plot"}
>
  <header class="panel-header">
    <h2>Plot</h2>
    <div class="panel-stats meta">
      {#each statistics as statistic}<span>{statistic}</span>{/each}
    </div>
  </header>
  {#if plot}
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`${label} over receipt time`}
    >
      {#each plot.yTicks as tick}
        {@const y = top + (1 - tick.ratio) * (height - top - bottom)}
        <line class="grid" x1={left} x2={width - right} y1={y} y2={y} />
        <text class="y-label" x={left - 7} {y}>{tick.label}</text>
      {/each}
      {#each xTicks as tick, index}
        {@const x = left + tick.ratio * (width - left - right)}
        <line
          class="tick"
          x1={x}
          x2={x}
          y1={height - bottom}
          y2={height - bottom + 5}
        />
        <text
          class="x-label"
          text-anchor={index === 0
            ? "start"
            : index === xTicks.length - 1
              ? "end"
              : "middle"}
          {x}
          y={height - 8}>{tick.label}</text
        >
      {/each}
      <line class="axis" x1={left} x2={left} y1={top} y2={height - bottom} />
      <line
        class="axis"
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
      />
      <polyline class="series" fill="none" points={line} />
    </svg>
  {:else}
    <p class="empty">
      {label
        ? "This field needs at least two live numeric samples."
        : "Select a numeric JSON field to plot it."}
    </p>
  {/if}
</section>

<style>
  .plot-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  svg {
    color: var(--muted);
    display: block;
    height: 100%;
    min-height: 0;
    width: 100%;
  }

  .axis,
  .tick,
  .grid {
    stroke: var(--border);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .grid {
    opacity: 0.7;
  }

  .series {
    stroke: var(--plot);
    stroke-linejoin: round;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  text {
    fill: currentColor;
    font-family: inherit;
    font-size: 12px;
  }

  .y-label {
    dominant-baseline: middle;
    text-anchor: end;
  }

  @media (max-width: 800px) {
    .plot-panel {
      min-height: 12rem;
    }
  }
</style>
