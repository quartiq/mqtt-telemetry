import { describe, expect, it } from "vitest";
import {
  TelemetryStore,
  downsamplePlotPoints,
  fieldLabel,
  getJsonPath,
  jsonPointer,
  jsonTree,
  messagePayloadPreview,
  messageFrequency,
  parsePayload,
  plotSeries,
  resolveJsonPointer,
  selectedMessageValue,
  type TelemetryMessage,
} from "./model";

const encode = (value: string) => new TextEncoder().encode(value);

function message(
  id: number,
  receivedAt: number,
  value: string,
  retained = false,
): TelemetryMessage {
  return {
    id,
    receivedAt,
    retained,
    duplicate: false,
    qos: 0,
    bytes: value.length,
    unsafeIntegers: false,
    payload: parsePayload(encode(value)),
  };
}

describe("payloads and JSON fields", () => {
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

  it("round-trips object keys, array indexes, slashes, and tildes", () => {
    const root = { "a/b": [{ "0~x": 12 }] };
    const path = ["a/b", 0, "0~x"];
    const pointer = jsonPointer(path);
    expect(pointer).toBe("/a~1b/0/0~0x");
    expect(resolveJsonPointer(root, pointer)).toEqual(path);
    expect(getJsonPath(root, path)).toBe(12);
    expect(fieldLabel(path)).toBe('$["a/b"][0]["0~x"]');
  });

  it("builds a selectable, lexically ordered JSON tree", () => {
    const snapshot = jsonTree({ z: 1, a: [true] });
    expect(snapshot.nodes.get("$")?.children).toEqual(["/a", "/z"]);
    expect(snapshot.paths.get("/a/0")).toEqual(["a", 0]);
  });

  it("bounds JSON tree depth and node count", () => {
    const depth = jsonTree(
      { a: { b: { c: 1 } } },
      {
        maxDepth: 1,
        maxNodes: 100,
      },
    );
    expect(depth.nodes.has("/a/b")).toBe(false);
    expect(depth.nodes.get("/a")?.value).toContain("depth limit");

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

  it("adjusts the limit immediately and clears one topic", () => {
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
    store.clearHistory(a);
    expect(store.history(a)).toEqual([]);
    expect(store.history(b)).toHaveLength(1);
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
    expect(store.snapshot().nodes.get(store.nodeId("a") as string)?.value).toBe(
      "0 msgs",
    );
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

    store.clearHistory(leaf);
    const after = store.snapshot();
    expect(after.nodes).toBe(before.nodes);
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.topicCount).toBe(1);
    expect(after.nodes.get(leaf)?.value).toBe("0 msgs");
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
    expect(snapshot.nodes.get(a)?.value).toBe("2 msgs");
    expect(snapshot.nodes.get(a)?.title).toContain("1 direct; 2 total");
    expect(snapshot.nodes.get(store.nodeId("a/b") as string)?.value).toBe(
      "1 msg",
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
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ],
      retainedExcluded: 1,
    });
  });

  it("downsamples in time order while preserving bucket extrema", () => {
    const points = Array.from({ length: 100 }, (_, x) => ({
      x,
      y: x === 50 ? 1000 : x,
    }));
    const sampled = downsamplePlotPoints(points, 20);
    expect(sampled.length).toBeLessThanOrEqual(20);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled).toContainEqual({ x: 50, y: 1000 });
    expect(
      sampled.every(
        (point, index) => !index || sampled[index - 1].x <= point.x,
      ),
    ).toBe(true);
  });

  it("summarizes recent live-message frequency", () => {
    expect(messageFrequency([message(1, 0, "1"), message(2, 100, "2")])).toBe(
      "10 msg/s",
    );
    expect(messageFrequency([message(1, 0, "1"), message(2, 2000, "2")])).toBe(
      "every 2 s",
    );
  });
});
