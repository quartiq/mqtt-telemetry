import { describe, expect, it } from "vitest";
import {
  TelemetryStore,
  downsamplePlotPoints,
  displayDatesDiffer,
  fieldLabel,
  formatPlotNumber,
  formatPlotTick,
  formatTelemetryTime,
  getJsonPath,
  historyNeedsDate,
  jsonPath,
  jsonTree,
  messagePayloadPreview,
  messageFrequency,
  messageSpan,
  nearestPlotPoint,
  nicePlotScale,
  parsePayload,
  parseJsonPath,
  plotSeries,
  plotSeriesPath,
  plotStatistics,
  plotTimeDomain,
  telemetryPageTitle,
  timeTickValues,
  resolveJsonPath,
  selectedMessageValue,
  type TelemetryMessage,
} from "./model";

const encode = (value: string) => new TextEncoder().encode(value);

function message(
  id: number,
  receivedAt: number,
  value: string,
  retained = false,
  segment = 0,
): TelemetryMessage {
  return {
    id,
    receivedAt,
    segment,
    retained,
    duplicate: false,
    qos: 0,
    bytes: value.length,
    unsafeIntegers: false,
    payload: parsePayload(encode(value)),
  };
}

describe("payloads and JSON fields", () => {
  it("formats every telemetry clock in 24-hour time", () => {
    const value = Date.UTC(2026, 7, 27, 13, 4, 5, 6);
    const formatted = formatTelemetryTime(value, {
      timeZone: "utc",
      date: true,
      milliseconds: true,
    });
    expect(formatted).toBe("2026-08-27 13:04:05.006");
    expect(
      displayDatesDiffer(
        Date.UTC(2026, 7, 27, 23),
        Date.UTC(2026, 7, 28, 0),
        "utc",
      ),
    ).toBe(true);
  });

  it("shows dates for old single-day history and histories crossing a date", () => {
    const now = Date.UTC(2026, 7, 28, 12);
    expect(
      historyNeedsDate(
        [message(1, Date.UTC(2026, 7, 27, 18), "1")],
        now,
        "utc",
      ),
    ).toBe(true);
    expect(
      historyNeedsDate(
        [message(1, Date.UTC(2026, 7, 28, 10), "1")],
        now,
        "utc",
      ),
    ).toBe(false);
    expect(
      historyNeedsDate(
        [
          message(1, Date.UTC(2026, 7, 27, 23), "1"),
          message(2, Date.UTC(2026, 7, 28, 0), "2"),
        ],
        now,
        "utc",
      ),
    ).toBe(true);
  });

  it("distinguishes JSON, text, empty, and binary payloads", () => {
    expect(parsePayload(encode('{"value":1}')).kind).toBe("json");
    expect(parsePayload(encode("online"))).toEqual({
      kind: "text",
      value: "online",
    });
    expect(parsePayload(new Uint8Array()).kind).toBe("text");
    expect(parsePayload(new Uint8Array([0xff])).kind).toBe("binary");
  });

  it("marks parsed JSON integers whose exact value cannot be represented", () => {
    const store = new TelemetryStore(1);
    const added = store.add("a", encode('{"counter":9007199254740993}'), {
      receivedAt: 1,
      retained: false,
      duplicate: true,
      qos: 0,
    });
    expect(added?.message.unsafeIntegers).toBe(true);
    expect(added?.message.duplicate).toBe(true);
  });

  it("round-trips compact singular JSONPaths and unusual member names", () => {
    const root = { "a/b": [{ "0~x": 12 }] };
    const path = ["a/b", 0, "0~x"];
    const encoded = jsonPath(path);
    expect(encoded).toBe("$['a/b'][0]['0~x']");
    expect(resolveJsonPath(root, encoded)).toEqual(path);
    expect(jsonPath(["temperature"])).toBe("$.temperature");
    expect(parseJsonPath("$['temperature']")).toEqual(["temperature"]);
    expect(parseJsonPath('$["field.with.dots"]')).toEqual(["field.with.dots"]);
    expect(getJsonPath(root, path)).toBe(12);
    expect(fieldLabel(path)).toBe('$["a/b"][0]["0~x"]');
  });

  it("keeps the tab title short and puts the selected field first", () => {
    expect(telemetryPageTitle("building/room", ["air", "temperature"])).toBe(
      "temperature — room — MQTT Telemetry",
    );
    expect(telemetryPageTitle("building/room")).toBe("room — MQTT Telemetry");
    expect(telemetryPageTitle("", undefined)).toBe("MQTT Telemetry");
  });

  it("builds a selectable, lexically ordered JSON tree", () => {
    const snapshot = jsonTree({ z: 1, a: [true] });
    expect(snapshot.nodes.get("$")?.children).toEqual(["$.a", "$.z"]);
    expect(snapshot.paths.get("$.a[0]")).toEqual(["a", 0]);
  });

  it("bounds JSON tree depth and node count", () => {
    const depth = jsonTree(
      { a: { b: { c: 1 } } },
      {
        maxDepth: 1,
        maxNodes: 100,
      },
    );
    expect(depth.nodes.has("$.a.b")).toBe(false);
    expect(depth.nodes.get("$.a")?.value).toContain("depth limit");

    const count = jsonTree(
      { a: 1, b: 2, c: 3 },
      {
        maxDepth: 64,
        maxNodes: 3,
      },
    );
    expect(count.nodes.size).toBe(3);
    expect([...count.nodes.values()].some((node) => node.label === "…")).toBe(
      true,
    );
  });

  it("summarizes structured history values and truncates long scalars", () => {
    expect(selectedMessageValue(message(1, 1, '{"a":1,"b":2}'), [])).toBe(
      '{"a":1,"b":2}',
    );
    expect(messagePayloadPreview(message(1, 1, "[]"))).toBe("[]");
    expect(messagePayloadPreview(message(1, 1, "{}"))).toBe("{}");
    const value = selectedMessageValue(
      message(2, 2, JSON.stringify("x".repeat(1000))),
      [],
    );
    expect(value).toHaveLength(256);
    expect(value.endsWith("…")).toBe(true);
  });
});

describe("topic history", () => {
  it("bounds each topic independently", () => {
    const store = new TelemetryStore(2);
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    store.add("a", encode("2"), { receivedAt: 2, retained: false, qos: 1 });
    const before = store.history(store.nodeId("a") as string);
    store.add("a", encode("3"), { receivedAt: 3, retained: false, qos: 2 });
    expect(store.history(store.nodeId("a") as string)).not.toBe(before);
    store.add("b", encode("4"), { receivedAt: 4, retained: false, qos: 0 });
    expect(
      store.history(store.nodeId("a") as string).map((entry) => entry.id),
    ).toEqual([2, 3]);
    expect(store.history(store.nodeId("b") as string)).toHaveLength(1);
  });

  it("reuses history snapshots until that topic changes", () => {
    const store = new TelemetryStore(10);
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    const a = store.nodeId("a") as string;
    const first = store.history(a);

    expect(store.history(a)).toBe(first);
    store.add("b", encode("2"), { receivedAt: 2, retained: false, qos: 0 });
    expect(store.history(a)).toBe(first);

    store.add("a", encode("3"), { receivedAt: 3, retained: false, qos: 0 });
    const updated = store.history(a);
    expect(updated).not.toBe(first);
    expect(updated.map(({ id }) => id)).toEqual([1, 3]);
  });

  it("refreshes only dirty topic views when taking a snapshot", () => {
    const store = new TelemetryStore(10);
    store.add("a/b", encode("1"), {
      receivedAt: 1,
      retained: false,
      qos: 0,
    });
    const a = store.nodeId("a") as string;
    const leaf = store.nodeId("a/b") as string;
    const initial = store.snapshot();
    const initialA = initial.nodes.get(a);
    const initialLeaf = initial.nodes.get(leaf);

    store.add("other", encode("2"), {
      receivedAt: 2,
      retained: false,
      qos: 0,
    });
    const unrelated = store.snapshot();
    expect(unrelated.nodes.get(a)).toBe(initialA);
    expect(unrelated.nodes.get(leaf)).toBe(initialLeaf);

    store.add("a/b", encode("3"), {
      receivedAt: 3,
      retained: false,
      qos: 0,
    });
    store.add("a/b", encode("4"), {
      receivedAt: 4,
      retained: false,
      qos: 0,
    });
    const updated = store.snapshot();
    expect(updated.nodes.get(a)).not.toBe(initialA);
    expect(updated.nodes.get(leaf)).not.toBe(initialLeaf);
    expect(updated.nodes.get(a)?.suffix).toBe("(3)");
    expect(updated.nodes.get(leaf)?.suffix).toBe("(3)");
  });

  it("adjusts the limit immediately", () => {
    const store = new TelemetryStore(3);
    for (let receivedAt = 1; receivedAt <= 3; receivedAt += 1) {
      store.add("a", encode(String(receivedAt)), {
        receivedAt,
        retained: false,
        qos: 0,
      });
    }
    store.add("b", encode("1"), { receivedAt: 1, retained: false, qos: 0 });

    const a = store.nodeId("a") as string;
    const b = store.nodeId("b") as string;
    store.setHistoryLimit(2);
    expect(store.history(a).map((entry) => entry.id)).toEqual([2, 3]);
    expect(store.history(b)).toHaveLength(1);
  });

  it("expires messages across topics by receipt time", () => {
    const store = new TelemetryStore(10);
    store.add("a", encode("1"), { receivedAt: 1000, retained: false, qos: 0 });
    store.add("b", encode("2"), { receivedAt: 2000, retained: false, qos: 0 });
    store.add("a", encode("3"), { receivedAt: 3000, retained: false, qos: 0 });

    expect(store.expireBefore(2500)).toBe(2);
    expect(
      store.history(store.nodeId("a") as string).map(({ id }) => id),
    ).toEqual([3]);
    expect(store.history(store.nodeId("b") as string)).toEqual([]);
    expect(store.subtreeMessageCount(store.nodeId("a") as string)).toBe(1);
  });

  it("keeps one retained snapshot outside live count and age limits", () => {
    const store = new TelemetryStore(1);
    store.add("a", encode("retained"), {
      receivedAt: 1000,
      retained: true,
      qos: 0,
    });
    store.add("a", encode("live 1"), {
      receivedAt: 2000,
      retained: false,
      qos: 0,
    });
    store.add("a", encode("live 2"), {
      receivedAt: 3000,
      retained: false,
      qos: 0,
    });
    const id = store.nodeId("a") as string;

    expect(
      store.history(id).map(({ retained, receivedAt }) => ({
        retained,
        receivedAt,
      })),
    ).toEqual([
      { retained: true, receivedAt: 1000 },
      { retained: false, receivedAt: 3000 },
    ]);
    expect(store.expireBefore(4000)).toBe(1);
    expect(store.history(id)).toHaveLength(1);
    expect(store.history(id)[0].retained).toBe(true);
    store.clearHistory(id);
    expect(store.history(id)).toEqual([]);
  });

  it("replaces a topic's previous retained snapshot", () => {
    const store = new TelemetryStore(1);
    store.add("a", encode("old"), {
      receivedAt: 1000,
      retained: true,
      qos: 0,
    });
    store.add("a", encode("new"), {
      receivedAt: 2000,
      retained: true,
      qos: 0,
    });
    const history = store.history(store.nodeId("a") as string);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ receivedAt: 2000, retained: true });
  });

  it("still bounds retained snapshots by the hard global budget", () => {
    const store = new TelemetryStore(1, {
      maxHistoryBytes: Number.MAX_SAFE_INTEGER,
      maxHistoryMessages: 1,
    });
    store.add("a", encode("1"), { receivedAt: 1, retained: true, qos: 0 });
    store.add("b", encode("live"), {
      receivedAt: 2,
      retained: false,
      qos: 0,
    });

    expect(store.history(store.nodeId("a") as string)).toHaveLength(1);
    expect(store.history(store.nodeId("b") as string)).toEqual([]);

    store.add("b", encode("2"), { receivedAt: 3, retained: true, qos: 0 });

    expect(store.history(store.nodeId("a") as string)).toEqual([]);
    expect(store.history(store.nodeId("b") as string)).toHaveLength(1);
    expect(store.snapshot().evictedMessages).toBe(2);
  });

  it("clears one topic without clearing descendants", () => {
    const store = new TelemetryStore(10);
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    store.add("a/b", encode("2"), {
      receivedAt: 2,
      retained: false,
      qos: 0,
    });
    const a = store.nodeId("a") as string;
    const child = store.nodeId("a/b") as string;

    store.clearHistory(a);

    expect(store.history(a)).toEqual([]);
    expect(store.history(child)).toHaveLength(1);
    expect(store.subtreeMessageCount(a)).toBe(1);
  });

  it("clears a selected topic subtree without clearing its siblings", () => {
    const store = new TelemetryStore(10);
    for (const topic of ["a", "a/b", "a/c/d", "other"]) {
      store.add(topic, encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    }
    expect(store.subtreeMessageCount(store.nodeId("a") as string)).toBe(3);
    store.clearSubtree(store.nodeId("a") as string);
    for (const topic of ["a", "a/b", "a/c/d"])
      expect(store.history(store.nodeId(topic) as string)).toEqual([]);
    expect(store.history(store.nodeId("other") as string)).toHaveLength(1);
    expect(store.subtreeMessageCount(store.nodeId("a") as string)).toBe(0);
    expect(
      store.snapshot().nodes.get(store.nodeId("a") as string)?.suffix,
    ).toBe("(0)");
  });

  it("evicts the globally oldest history within the shared byte budget", () => {
    const store = new TelemetryStore(10, {
      maxHistoryBytes: 512,
      maxHistoryMessages: 10,
    });
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    store.add("b", encode("2"), { receivedAt: 2, retained: false, qos: 0 });
    store.add("a", encode("3"), { receivedAt: 3, retained: false, qos: 0 });

    expect(
      store.history(store.nodeId("a") as string).map(({ id }) => id),
    ).toEqual([3]);
    expect(
      store.history(store.nodeId("b") as string).map(({ id }) => id),
    ).toEqual([2]);
    expect(store.snapshot().evictedMessages).toBe(1);
  });

  it("bounds the total message count after per-topic rolling", () => {
    const store = new TelemetryStore(1, {
      maxHistoryBytes: Number.MAX_SAFE_INTEGER,
      maxHistoryMessages: 2,
    });
    for (let receivedAt = 1; receivedAt <= 20; receivedAt += 1) {
      store.add("rolling", encode(String(receivedAt)), {
        receivedAt,
        retained: false,
        qos: 0,
      });
    }
    store.add("a", encode("21"), {
      receivedAt: 21,
      retained: false,
      qos: 0,
    });
    store.add("b", encode("22"), {
      receivedAt: 22,
      retained: false,
      qos: 0,
    });

    expect(store.history(store.nodeId("rolling") as string)).toEqual([]);
    expect(store.history(store.nodeId("a") as string)).toHaveLength(1);
    expect(store.history(store.nodeId("b") as string)).toHaveLength(1);
    expect(store.snapshot().evictedMessages).toBe(1);
  });

  it("restores synthetic branches and preserves published-topic counts", () => {
    const store = new TelemetryStore(10);
    store.add("a/b", encode("1"), {
      receivedAt: 1,
      retained: false,
      qos: 0,
    });
    const branch = store.nodeId("a");
    const leaf = store.nodeId("a/b") as string;
    const before = store.snapshot();
    expect(branch).toBeDefined();
    expect(store.topic(branch as string)).toBe("a");
    expect(before.topicCount).toBe(1);

    store.clearSubtree(leaf);
    const after = store.snapshot();
    expect(after.nodes).toBe(before.nodes);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.topicCount).toBe(1);
    expect(after.nodes.get(leaf)?.suffix).toBe("(0)");
  });

  it("represents topics that are also branches and preserves empty levels", () => {
    const store = new TelemetryStore(10);
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    store.add("a/b", encode("2"), { receivedAt: 2, retained: false, qos: 0 });
    store.add("/a//b", encode("3"), { receivedAt: 3, retained: false, qos: 0 });
    const snapshot = store.snapshot();
    const a = store.nodeId("a") as string;
    expect(store.history(a)).toHaveLength(1);
    expect(snapshot.nodes.get(a)?.children).toHaveLength(1);
    expect(snapshot.nodes.get(a)?.suffix).toBe("(2)");
    expect(snapshot.nodes.get(a)?.title).toContain("1 direct; 2 total");
    expect(snapshot.nodes.get(store.nodeId("a/b") as string)?.suffix).toBe(
      "(1)",
    );
    expect(snapshot.roots.map((id) => snapshot.nodes.get(id)?.label)).toEqual([
      "(empty)",
      "a",
    ]);
  });

  it("bounds discovered topics and omits oversized payload contents", () => {
    const store = new TelemetryStore(10, {
      maxTopicNodes: 2,
      maxPayloadBytes: 3,
    });
    store.add("a/b", encode("1234"), {
      receivedAt: 1,
      retained: false,
      qos: 0,
    });
    expect(
      store.add("c", encode("1"), {
        receivedAt: 2,
        retained: false,
        qos: 0,
      }),
    ).toBeUndefined();
    const snapshot = store.snapshot();
    expect(snapshot.omittedPayloads).toBe(1);
    expect(snapshot.droppedMessages).toBe(1);
    expect(store.history(store.nodeId("a/b") as string)[0].payload.kind).toBe(
      "omitted",
    );
  });
});

describe("plot extraction", () => {
  it("reuses cached series until that topic's history changes", () => {
    const store = new TelemetryStore(10);
    store.add("a", encode('{"v":1}'), {
      receivedAt: 1,
      retained: false,
      qos: 0,
    });
    const a = store.nodeId("a") as string;
    const first = store.plotSeries(a, "$.v");

    expect(store.plotSeries(a, "$.v")).toBe(first);
    store.add("b", encode('{"v":2}'), {
      receivedAt: 2,
      retained: false,
      qos: 0,
    });
    expect(store.plotSeries(a, "$.v")).toBe(first);

    store.add("a", encode('{"v":3}'), {
      receivedAt: 3,
      retained: false,
      qos: 0,
    });
    const updated = store.plotSeries(a, "$.v");
    expect(updated).not.toBe(first);
    expect(updated.points.map(({ y }) => y)).toEqual([1, 3]);
  });

  it("bounds cached plot series to the dashboard capacity", () => {
    const store = new TelemetryStore(10);
    const payload = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`v${index}`, index]),
    );
    store.add("a", encode(JSON.stringify(payload)), {
      receivedAt: 1,
      retained: false,
      qos: 0,
    });
    const a = store.nodeId("a") as string;
    const first = store.plotSeries(a, "$.v0");
    for (let index = 1; index < 9; index += 1)
      store.plotSeries(a, `$.v${index}`);

    expect(store.plotSeries(a, "$.v0")).not.toBe(first);
  });

  it("formats axis values at the tick resolution", () => {
    expect(formatPlotNumber(1.000000002, 1e-9)).toBe("1.000000002");
    expect(formatPlotNumber(103_403.8, 0.03)).toBe("103403.8");
    expect(formatPlotNumber(103_403.95, 0.03)).toBe("103403.95");
    expect(formatPlotNumber(0.16, 0.03)).toBe("0.16");
  });

  it("places three readable ticks at their exact numeric values", () => {
    const scale = nicePlotScale(0.383, 0.4);
    expect(scale).toEqual({
      min: 0.38,
      max: 0.4,
      step: 0.01,
      ticks: [0.38, 0.39, 0.4],
    });
    expect(
      scale.ticks.map((value) => formatPlotTick(value, scale.step)),
    ).toEqual([".38", ".39", ".40"]);

    const offset = nicePlotScale(103_403.8, 103_403.95);
    expect(
      offset.ticks.map((value) => formatPlotTick(value, offset.step)),
    ).toEqual(["103403.8", "103403.9", "103404.0"]);

    const precise = nicePlotScale(1 + 1e-9, 1 + 2e-9);
    expect(
      precise.ticks.map((value) => formatPlotTick(value, precise.step)),
    ).toEqual(["1.0000000010", "1.0000000015", "1.0000000020"]);
  });

  it("anchors time ticks to real interval boundaries", () => {
    const ticks = timeTickValues(1_700_000_000_123, 1_700_000_004_123);
    expect(ticks).toEqual([
      1_700_000_001_000, 1_700_000_002_000, 1_700_000_003_000,
      1_700_000_004_000,
    ]);
    expect(ticks.every((value) => value % 1_000 === 0)).toBe(true);
  });

  it("uses finite numeric live values and skips retained or missing entries", () => {
    const history = [
      message(1, 1, '{"v":1}'),
      message(2, 2, '{"v":2}', true),
      message(3, 3, '{"other":3}'),
      message(4, 4, '{"v":"4"}'),
      message(5, 5, '{"v":5}'),
    ];
    expect(plotSeries(history, ["v"])).toEqual({
      points: [
        { x: 1, y: 1, segment: 0 },
        { x: 5, y: 5, segment: 0 },
      ],
      retainedExcluded: 1,
    });
  });

  it("preserves reconnect boundaries in plot points", () => {
    const history = [
      message(1, 1, '{"v":1}', false, 1),
      message(2, 2, '{"v":2}', false, 3),
    ];
    expect(
      plotSeries(history, ["v"]).points.map(({ segment }) => segment),
    ).toEqual([1, 3]);
  });

  it("resolves a pinned path independently in each payload", () => {
    const history = [message(1, 1, "[1]"), message(2, 2, '{"0":2}')];
    expect(plotSeriesPath(history, "$[0]").points.map(({ y }) => y)).toEqual([
      1,
    ]);
    expect(plotSeriesPath(history, "$['0']").points.map(({ y }) => y)).toEqual([
      2,
    ]);
  });

  it("computes stable population statistics", () => {
    const points = [
      { x: 1, y: 100_000.1, segment: 0 },
      { x: 2, y: 100_000.4, segment: 0 },
    ];
    expect(plotStatistics(points)).toMatchObject({
      latest: 100_000.4,
      low: 100_000.1,
      high: 100_000.4,
      mean: 100_000.25,
    });
    expect(plotStatistics(points)?.standardDeviation).toBeCloseTo(0.15, 10);
  });

  it("finds the nearest full-resolution plot sample", () => {
    const points = [
      { x: 10, y: 1, segment: 0 },
      { x: 20, y: 2, segment: 0 },
      { x: 40, y: 4, segment: 1 },
    ];
    expect(nearestPlotPoint(points, 4)).toBe(points[0]);
    expect(nearestPlotPoint(points, 16)).toBe(points[1]);
    expect(nearestPlotPoint(points, 30)).toBe(points[1]);
    expect(nearestPlotPoint(points, 100)).toBe(points[2]);
    expect(nearestPlotPoint([], 10)).toBeUndefined();
  });

  it("keeps every plot on a shared domain ending at now", () => {
    const series = [
      { points: [{ x: 7000, y: 1, segment: 0 }], retainedExcluded: 0 },
      { points: [{ x: 8000, y: 2, segment: 0 }], retainedExcluded: 0 },
    ];
    expect(plotTimeDomain(series, 10_000, null)).toEqual({
      min: 7000,
      max: 10_000,
    });
    expect(plotTimeDomain(series, 10_000, 2000)).toEqual({
      min: 8000,
      max: 10_000,
    });
    expect(plotTimeDomain([], 10_000, null)).toEqual({
      min: -50_000,
      max: 10_000,
    });
  });

  it("downsamples in time order while preserving bucket extrema", () => {
    const points = Array.from({ length: 100 }, (_, x) => ({
      x,
      y: x === 50 ? 1000 : x,
      segment: 0,
    }));
    const sampled = downsamplePlotPoints(points, 20);
    expect(sampled.length).toBeLessThanOrEqual(20);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled).toContainEqual({ x: 50, y: 1000, segment: 0 });
    expect(
      sampled.every(
        (point, index) => !index || sampled[index - 1].x <= point.x,
      ),
    ).toBe(true);
  });

  it("summarizes recent live-message frequency", () => {
    expect(messageFrequency([message(1, 0, "1"), message(2, 0.5, "2")])).toBe(
      "burst (<1 ms apart)",
    );
    expect(messageFrequency([message(1, 0, "1"), message(2, 100, "2")])).toBe(
      "10 msg/s",
    );
    expect(messageFrequency([message(1, 0, "1"), message(2, 2000, "2")])).toBe(
      "every 2 s",
    );
    expect(
      messageFrequency([
        message(1, 0, "1", false, 1),
        message(2, 10_000, "2", false, 3),
        message(3, 11_000, "3", false, 3),
      ]),
    ).toBe("every 1 s");
    expect(
      messageFrequency([
        message(1, 0, "1", false, 1),
        message(2, 1_000, "2", false, 1),
        message(3, 10_000, "3", true, 3),
      ]),
    ).toBe("");
  });

  it("summarizes the live history span", () => {
    expect(messageSpan([message(1, 0, "1"), message(2, 0.5, "2")])).toBe(
      "<1 ms span",
    );
    expect(messageSpan([message(1, 0, "1"), message(2, 100, "2")])).toBe(
      "100 ms span",
    );
    expect(messageSpan([message(1, 0, "1"), message(2, 62_000, "2")])).toBe(
      "1m 2s span",
    );
  });
});
