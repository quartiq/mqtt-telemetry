<svelte:options runes={true} />

<script lang="ts">
  import {
    downsamplePlotPoints,
    formatPlotNumber,
    formatPlotTick,
    nearestPlotPoint,
    nicePlotScale,
    plotStatistics,
    timeTickValues,
    type PlotPoint,
  } from "./lib/model";

  type Props = {
    points: PlotPoint[];
    topic: string;
    label: string;
    retainedExcluded: number;
    xMin: number;
    xMax: number;
    inspectTime?: number;
    oninspect: (position?: number) => void;
    onfocus: () => void;
    onremove: () => void;
  };
  let {
    points,
    topic,
    label,
    retainedExcluded,
    xMin,
    xMax,
    inspectTime,
    oninspect,
    onfocus,
    onremove,
  }: Props = $props();

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
    if (!points.length) return undefined;
    const summary = plotStatistics(points)!;
    const yScale = nicePlotScale(summary.low, summary.high);
    return {
      xMin,
      xMax: Math.max(xMax, xMin + 0.001),
      summary,
      yMin: yScale.min,
      yMax: yScale.max,
      step: yScale.step,
      yTicks: yScale.ticks.map((value) => ({
        value,
        label: formatPlotTick(value, yScale.step),
      })),
    };
  });
  let xTicks = $derived.by(() =>
    plot
      ? (() => {
          const values = timeTickValues(plot.xMin, plot.xMax);
          const showMilliseconds = values.some((value) => value % 1_000 !== 0);
          const showDate =
            new Date(plot.xMin).toDateString() !==
            new Date(plot.xMax).toDateString();
          return values.map((value) => ({
            value,
            label: time(value, showMilliseconds, showDate),
          }));
        })()
      : [],
  );
  let lines = $derived.by(() => {
    if (!plot) return [];
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const segments: {
      segment: number;
      coordinates: { x: number; y: number }[];
    }[] = [];
    for (const point of displayPoints) {
      const x =
        left + ((point.x - plot.xMin) / (plot.xMax - plot.xMin)) * plotWidth;
      const y =
        top + ((plot.yMax - point.y) / (plot.yMax - plot.yMin)) * plotHeight;
      let current = segments.at(-1);
      if (!current || current.segment !== point.segment) {
        current = { segment: point.segment, coordinates: [] };
        segments.push(current);
      }
      current.coordinates.push({ x, y });
    }
    return segments.map(({ coordinates }) => ({
      points: coordinates
        .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(" "),
      singleton: coordinates.length === 1 ? coordinates[0] : undefined,
    }));
  });
  let gaps = $derived.by(() => {
    let count = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (points[index - 1].segment !== points[index].segment) count += 1;
    }
    return count;
  });
  let inspection = $derived(
    inspectTime === undefined
      ? undefined
      : nearestPlotPoint(points, inspectTime),
  );
  let inspectionMarker = $derived.by(() => {
    if (!plot || inspectTime === undefined || !inspection) return undefined;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    return {
      cursorX:
        left +
        ((inspectTime - plot.xMin) / (plot.xMax - plot.xMin)) * plotWidth,
      pointX:
        left +
        ((inspection.x - plot.xMin) / (plot.xMax - plot.xMin)) * plotWidth,
      pointY:
        top +
        ((plot.yMax - inspection.y) / (plot.yMax - plot.yMin)) * plotHeight,
    };
  });
  let statistics = $derived.by(() => {
    const items: string[] = [];
    if (plot) {
      const { latest, low, high, mean, standardDeviation } = plot.summary;
      if (inspection) {
        const showDate =
          new Date(plot.xMin).toDateString() !==
          new Date(plot.xMax).toDateString();
        items.push(`x ${time(inspection.x, true, showDate)}`);
        items.push(`y ${formatPlotNumber(inspection.y, plot.step)}`);
      } else {
        items.push(`latest ${formatPlotNumber(latest, plot.step)}`);
      }
      items.push(`μ ${formatPlotNumber(mean, plot.step)}`);
      items.push(
        `p–p ${formatPlotNumber(high - low, Math.min(plot.step, high - low || plot.step))}`,
      );
      items.push(
        `σ ${formatPlotNumber(standardDeviation, Math.min(plot.step, standardDeviation || plot.step))}`,
      );
      items.push(`n ${points.length.toLocaleString()}`);
      items.push(`low ${formatPlotNumber(low, plot.step)}`);
      items.push(`high ${formatPlotNumber(high, plot.step)}`);
    }
    if (retainedExcluded)
      items.push(`${retainedExcluded.toLocaleString()} retained excluded`);
    if (gaps)
      items.push(
        `${gaps.toLocaleString()} reconnect ${gaps === 1 ? "gap" : "gaps"}`,
      );
    return items;
  });

  function inspect(event: PointerEvent) {
    if (!plot || event.pointerType !== "mouse") return;
    const svg = event.currentTarget as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    if (
      position.x < left ||
      position.x > width - right ||
      position.y < top ||
      position.y > height - bottom
    ) {
      oninspect(undefined);
      return;
    }
    oninspect((position.x - left) / (width - left - right));
  }

  function time(
    value: number,
    showMilliseconds: boolean,
    showDate: boolean,
  ): string {
    return new Date(value).toLocaleString(undefined, {
      ...(showDate ? { month: "2-digit", day: "2-digit" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(showMilliseconds ? { fractionalSecondDigits: 3 } : {}),
    });
  }
</script>

<section class="panel plot-panel" aria-label={`Plot of ${label} on ${topic}`}>
  <header class="panel-header">
    <button class="plot-title" type="button" onclick={onfocus}>
      <strong>{label}</strong>
      <span>{topic}</span>
    </button>
    <button
      aria-label={`Remove plot of ${label} on ${topic}`}
      class="close"
      title="Remove plot"
      type="button"
      onclick={onremove}>×</button
    >
    <div
      class="panel-stats meta"
      title="Statistics use plotted live samples; σ is the population standard deviation."
    >
      {#each statistics as statistic}<span>{statistic}</span>{/each}
    </div>
  </header>
  {#if plot}
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`${label} on ${topic} over receipt time`}
      onpointermove={inspect}
      onpointerleave={() => oninspect(undefined)}
    >
      {#each plot.yTicks as tick}
        {@const y =
          top +
          ((plot.yMax - tick.value) / (plot.yMax - plot.yMin)) *
            (height - top - bottom)}
        <line class="grid" x1={left} x2={width - right} y1={y} y2={y} />
        <text class="y-label" x={left - 7} {y}>{tick.label}</text>
      {/each}
      {#each xTicks as tick, index}
        {@const x =
          left +
          ((tick.value - plot.xMin) / (plot.xMax - plot.xMin)) *
            (width - left - right)}
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
      {#each lines as line}
        <polyline class="series" fill="none" points={line.points} />
        {#if line.singleton}
          <circle
            class="series-point"
            cx={line.singleton.x}
            cy={line.singleton.y}
            r="2"
          />
        {/if}
      {/each}
      {#if inspectionMarker}
        <line
          class="inspection-time"
          x1={inspectionMarker.cursorX}
          x2={inspectionMarker.cursorX}
          y1={top}
          y2={height - bottom}
        />
        <circle
          class="inspection-point"
          cx={inspectionMarker.pointX}
          cy={inspectionMarker.pointY}
          r="3"
        />
      {/if}
    </svg>
  {:else}
    <p class="empty">
      Waiting for live numeric samples. The plot will resume when this field
      appears.
    </p>
  {/if}
</section>

<style>
  .plot-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
  }

  .plot-title {
    background: transparent;
    border: 0;
    color: inherit;
    display: grid;
    min-width: 0;
    padding: 0;
    text-align: left;
  }

  .plot-title strong,
  .plot-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plot-title span {
    color: var(--muted);
    font-size: var(--text-small);
    font-weight: 400;
  }

  .close {
    background: transparent;
    border: 0;
    color: var(--muted);
    font-size: 1.2rem;
    padding: 0 var(--space-tight);
  }

  svg {
    color: var(--muted);
    cursor: crosshair;
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
    stroke: var(--fg);
    stroke-linejoin: round;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  .series-point {
    fill: var(--fg);
  }

  .inspection-time {
    stroke: var(--fg);
    stroke-dasharray: 2 3;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .inspection-point {
    fill: var(--bg);
    stroke: var(--fg);
    stroke-width: 1.5;
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
      height: clamp(16rem, 46svh, 22rem);
    }
  }
</style>
