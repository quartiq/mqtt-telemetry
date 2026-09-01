import { getJsonPath, parseJsonPath, type JsonPath } from "./json";
import type { TelemetryMessage } from "./telemetry";

export type PlotPoint = { x: number; y: number; segment: number };
export type PlotSeries = { points: PlotPoint[]; retainedExcluded: number };
export type PlotTimeDomain = { min: number; max: number };
export type PlotScale = {
  min: number;
  max: number;
  step: number;
  ticks: [number, number, number];
};
export type PlotStatistics = {
  latest: number;
  low: number;
  high: number;
  mean: number;
  standardDeviation: number;
};

export function plotSeries(
  history: readonly TelemetryMessage[],
  path: JsonPath,
): PlotSeries {
  return plotSeriesAtPath(history, path);
}

export function plotSeriesPath(
  history: readonly TelemetryMessage[],
  singularPath: string,
): PlotSeries {
  const path = parseJsonPath(singularPath);
  return path ? plotSeriesAtPath(history, path) : emptyPlotSeries();
}

function plotSeriesAtPath(
  history: readonly TelemetryMessage[],
  path: JsonPath,
): PlotSeries {
  const points: PlotPoint[] = [];
  let retainedExcluded = 0;
  for (const message of history) {
    if (message.payload.kind !== "json") continue;
    const value = getJsonPath(message.payload.value, path);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (message.retained) retainedExcluded += 1;
    else
      points.push({
        x: message.receivedAt,
        y: value,
        segment: message.segment,
      });
  }
  return { points, retainedExcluded };
}

function emptyPlotSeries(): PlotSeries {
  return { points: [], retainedExcluded: 0 };
}

export function plotStatistics(
  points: readonly PlotPoint[],
): PlotStatistics | undefined {
  if (!points.length) return undefined;
  let mean = 0;
  let sumSquaredDifference = 0;
  let low = points[0].y;
  let high = low;
  for (const [index, point] of points.entries()) {
    low = Math.min(low, point.y);
    high = Math.max(high, point.y);
    const difference = point.y - mean;
    mean += difference / (index + 1);
    sumSquaredDifference += difference * (point.y - mean);
  }
  return {
    latest: points.at(-1)!.y,
    low,
    high,
    mean,
    standardDeviation: Math.sqrt(sumSquaredDifference / points.length),
  };
}

export function nearestPlotPoint(
  points: readonly PlotPoint[],
  time: number,
): PlotPoint | undefined {
  if (!points.length) return undefined;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x < time) low = middle + 1;
    else high = middle;
  }
  if (!low) return points[0];
  const before = points[low - 1];
  const after = points[low];
  return time - before.x <= after.x - time ? before : after;
}

export function plotPointInsertionIndex(
  points: readonly PlotPoint[],
  time: number,
  afterEqual = false,
): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].x < time || (afterEqual && points[middle].x === time))
      low = middle + 1;
    else high = middle;
  }
  return low;
}

export function plotTimeDomain(
  series: Iterable<PlotSeries>,
  now: number,
  windowMs: number | null,
): PlotTimeDomain {
  if (windowMs !== null) return { min: now - windowMs, max: now };
  let earliest = Number.POSITIVE_INFINITY;
  for (const plot of series)
    if (plot.points.length) earliest = Math.min(earliest, plot.points[0].x);
  return {
    min: Number.isFinite(earliest)
      ? Math.min(earliest, now - 1000)
      : now - 60_000,
    max: now,
  };
}

export function formatPlotNumber(value: number, resolution: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";

  const absolute = Math.abs(value);
  const safeResolution =
    Number.isFinite(resolution) && resolution > 0 ? resolution : absolute;
  const exponent = Math.floor(Math.log10(absolute));
  const resolutionExponent = Math.floor(Math.log10(safeResolution));
  const significantDigits = Math.max(
    1,
    Math.min(12, exponent - resolutionExponent + 2),
  );

  if (exponent <= -4 || exponent >= 7) {
    return value
      .toExponential(significantDigits - 1)
      .replace("e+", "e")
      .replace("e-", "e−")
      .replace("-", "−");
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.max(0, Math.min(12, -resolutionExponent + 1)),
    useGrouping: false,
  })
    .format(value)
    .replace("-", "−");
}

export function formatPlotTick(value: number, step: number): string {
  const stepExponent = Math.floor(Math.log10(Math.abs(step)));
  const valueExponent =
    value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
  if (valueExponent <= -4 || valueExponent >= 7)
    return formatPlotNumber(value, step);

  return value
    .toFixed(Math.max(0, Math.min(12, -stepExponent)))
    .replace("-", "−")
    .replace(/^([−]?)0\./, "$1.");
}

export function nicePlotScale(dataMin: number, dataMax: number): PlotScale {
  if (dataMin === dataMax) {
    const padding = Math.abs(dataMin) * 0.05 || 1;
    dataMin -= padding;
    dataMax += padding;
  }

  let step = niceStep((dataMax - dataMin) / 2);
  let first = alignedFloor(dataMin, step);
  let last = first + 2 * step;
  const tolerance = () =>
    Math.max(Math.abs(last) * Number.EPSILON * 4, step * 1e-9);
  if (last + tolerance() < dataMax) {
    step = niceStep(step * (1 + 1e-10));
    first = alignedFloor(dataMin, step);
    last = first + 2 * step;
  }

  return { min: first, max: last, step, ticks: [first, first + step, last] };
}

const TIME_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000,
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
  7_200_000, 21_600_000, 43_200_000, 86_400_000,
];

export function timeTickValues(min: number, max: number): number[] {
  const target = (max - min) / 4;
  const step =
    TIME_STEPS.find((candidate) => candidate >= target) ?? niceStep(target);
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max; value += step) ticks.push(value);
  return ticks;
}

function niceStep(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

function alignedFloor(value: number, step: number): number {
  const quotient = value / step;
  const tolerance = Math.abs(quotient) * Number.EPSILON * 4;
  return Math.floor(quotient + tolerance) * step;
}

export function downsamplePlotPoints(
  points: PlotPoint[],
  limit: number,
): PlotPoint[] {
  if (points.length <= limit || limit < 4) return points;
  const buckets = Math.max(1, Math.floor((limit - 2) / 2));
  const sampled: PlotPoint[] = [points[0]];
  const interior = points.length - 2;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = 1 + Math.floor((bucket * interior) / buckets);
    const end = 1 + Math.floor(((bucket + 1) * interior) / buckets);
    if (start >= end) continue;
    let low = points[start];
    let high = low;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      if (point.y < low.y) low = point;
      if (point.y > high.y) high = point;
    }
    if (low.x <= high.x) sampled.push(low, ...(high === low ? [] : [high]));
    else sampled.push(high, low);
  }
  sampled.push(points.at(-1) as PlotPoint);
  return sampled;
}
