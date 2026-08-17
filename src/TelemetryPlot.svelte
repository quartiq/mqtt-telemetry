<svelte:options runes={true} />

<script lang="ts">
  import { downsamplePlotPoints, type PlotPoint } from "./lib/model";

  type Props = { points: PlotPoint[]; label: string };
  let { points, label }: Props = $props();

  const width = 640;
  const height = 220;
  const left = 58;
  const right = 12;
  const top = 14;
  const bottom = 30;
  let displayPoints = $derived(
    downsamplePlotPoints(points, width - left - right),
  );
  let bounds = $derived.by(() => {
    if (points.length < 2) return undefined;
    const xMin = points[0].x;
    const xMax = points.at(-1)?.x ?? xMin;
    let yMin = points[0].y;
    let yMax = yMin;
    for (const point of points) {
      yMin = Math.min(yMin, point.y);
      yMax = Math.max(yMax, point.y);
    }
    if (yMin === yMax) {
      const padding = Math.abs(yMin) * 0.05 || 1;
      yMin -= padding;
      yMax += padding;
    }
    return { xMin, xMax: Math.max(xMax, xMin + 0.001), yMin, yMax };
  });
  let line = $derived.by(() => {
    if (!bounds) return "";
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    return displayPoints
      .map((point) => {
        const x =
          left +
          ((point.x - bounds.xMin) / (bounds.xMax - bounds.xMin)) * plotWidth;
        const y =
          top +
          ((bounds.yMax - point.y) / (bounds.yMax - bounds.yMin)) * plotHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  });

  function time(value: number): string {
    return new Date(value).toLocaleTimeString();
  }

  function number(value: number): string {
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: 6,
    }).format(value);
  }
</script>

<section class="panel plot-panel" aria-label={`Plot of ${label}`}>
  <header>
    <h2>Plot</h2>
    <span class="meta">{label}</span>
  </header>
  {#if bounds}
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`${label} over receipt time`}
    >
      <line class="axis" x1={left} x2={left} y1={top} y2={height - bottom} />
      <line
        class="axis"
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
      />
      <line
        class="grid"
        x1={left}
        x2={width - right}
        y1={(top + height - bottom) / 2}
        y2={(top + height - bottom) / 2}
      />
      <polyline class="series" fill="none" points={line} />
      <text class="y-label" x={left - 6} y={top + 4}>{number(bounds.yMax)}</text
      >
      <text class="y-label" x={left - 6} y={height - bottom}
        >{number(bounds.yMin)}</text
      >
      <text class="x-label" x={left} y={height - 8}>{time(bounds.xMin)}</text>
      <text class="x-label end" x={width - right} y={height - 8}
        >{time(bounds.xMax)}</text
      >
    </svg>
  {:else}
    <p class="empty">
      Select a numeric JSON field with at least two live samples.
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
  .grid {
    stroke: var(--border);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .grid {
    stroke-dasharray: 3 4;
  }

  .series {
    stroke: var(--plot);
    stroke-linejoin: round;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  text {
    fill: currentColor;
    font:
      12px ui-monospace,
      "SFMono-Regular",
      "Cascadia Mono",
      monospace;
  }

  .x-label.end {
    text-anchor: end;
  }

  .y-label {
    text-anchor: end;
  }

  @media (max-width: 800px) {
    .plot-panel {
      min-height: 12rem;
    }
  }
</style>
