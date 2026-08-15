import { describe, expect, it } from "vitest";
import {
  TelemetryStore,
  fieldLabel,
  getJsonPath,
  jsonPointer,
  jsonTree,
  parsePayload,
  plotPoints,
  resolveJsonPointer,
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
    qos: 0,
    bytes: value.length,
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
});

describe("topic history", () => {
  it("bounds each topic independently", () => {
    const store = new TelemetryStore(2);
    store.add("a", encode("1"), { receivedAt: 1, retained: false, qos: 0 });
    store.add("a", encode("2"), { receivedAt: 2, retained: false, qos: 1 });
    store.add("a", encode("3"), { receivedAt: 3, retained: false, qos: 2 });
    store.add("b", encode("4"), { receivedAt: 4, retained: false, qos: 0 });
    expect(
      store.history(store.nodeId("a") as string).map((entry) => entry.id),
    ).toEqual([2, 3]);
    expect(store.history(store.nodeId("b") as string)).toHaveLength(1);
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
    expect(snapshot.roots.map((id) => snapshot.nodes.get(id)?.label)).toEqual([
      "(empty)",
      "a",
    ]);
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
    expect(plotPoints(history, ["v"])).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 5 },
    ]);
  });
});
