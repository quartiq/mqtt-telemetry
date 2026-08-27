import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  connectionKey,
  isWebSocketBroker,
  parseHistoryAge,
  parseHistoryLimit,
  readRoute,
  routeSearch,
  uniqueFilters,
} from "./routes";

describe("route configuration", () => {
  it("defaults to a wildcard subscription and bounded history", () => {
    expect(readRoute("")).toEqual({
      broker: "",
      filters: ["#"],
      historyLimit: DEFAULT_HISTORY_LIMIT,
      historyAgeMs: null,
      selectedTopic: "",
      fieldPointer: null,
      plots: [],
    });
  });

  it("round-trips full broker URLs, subscriptions, and browsing state", () => {
    const expected = {
      broker: "wss://broker.example/mqtt?token=public",
      filters: ["sensors/#", "alerts/+", " room/temperature "],
      historyLimit: 42,
      historyAgeMs: 600_000,
      selectedTopic: "sensors/room/temperature",
      fieldPointer: "/environment/temperature",
      plots: [{ topic: "sensors/room/temperature", pointer: "/temperature" }],
    };
    const search = routeSearch(expected);
    expect(search).toBe(
      "?broker=wss://broker.example/mqtt?token=public&topic=sensors/%23&topic=alerts/%2B&topic=%20room/temperature%20&history=42&age=600&selected=sensors/room/temperature&field=/environment/temperature&plot=%5B%22sensors/room/temperature%22%2C%22/temperature%22%5D",
    );
    expect(readRoute(search)).toEqual(expected);
  });

  it("keeps fully escaped links compatible", () => {
    expect(
      readRoute(
        "?broker=wss%3A%2F%2Fbroker.example&topic=sensors%2F%23&selected=sensors%2Froom&field=%2Fvalue",
      ),
    ).toMatchObject({
      broker: "wss://broker.example",
      filters: ["sensors/#"],
      selectedTopic: "sensors/room",
      fieldPointer: "/value",
    });
  });

  it("distinguishes no selected field from the JSON root", () => {
    expect(readRoute("?selected=a").fieldPointer).toBeNull();
    expect(readRoute("?selected=a&field=").fieldPointer).toBe("");
    const route = { ...readRoute("?selected=a"), fieldPointer: "" };
    expect(routeSearch(route)).toContain("&field=");
    expect(readRoute(routeSearch(route)).fieldPointer).toBe("");
  });

  it("does not treat a live history-limit change as a new connection", () => {
    const route = readRoute("?broker=wss://broker.example&topic=a/#");
    expect(connectionKey({ ...route, historyLimit: 12 })).toBe(
      connectionKey({ ...route, historyLimit: 34 }),
    );
    expect(connectionKey({ ...route, historyAgeMs: 60_000 })).toBe(
      connectionKey({
        ...route,
        plots: [{ topic: "a", pointer: "/value" }],
      }),
    );
  });

  it("removes only exact duplicate and empty filters", () => {
    expect(uniqueFilters(["a/#", "a/#", "", " a/#"])).toEqual(["a/#", " a/#"]);
  });

  it("rejects malformed history limits", () => {
    for (const value of [
      null,
      "",
      "0",
      "-1",
      "1.5",
      "Infinity",
      "9007199254740992",
    ]) {
      expect(parseHistoryLimit(value)).toBe(DEFAULT_HISTORY_LIMIT);
    }
    expect(parseHistoryLimit("1")).toBe(1);
    expect(parseHistoryLimit("100000")).toBe(MAX_HISTORY_LIMIT);
  });

  it("parses an optional bounded age cutoff", () => {
    expect(parseHistoryAge(null)).toBeNull();
    expect(parseHistoryAge("0")).toBeNull();
    expect(parseHistoryAge("60")).toBe(60_000);
    expect(parseHistoryAge("999999999")).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it("ignores malformed and duplicate plot references", () => {
    const valid = encodeURIComponent(JSON.stringify(["a/b", "/v"]));
    const route = readRoute(
      `?plot=${valid}&plot=${valid}&plot=broken&plot=${encodeURIComponent(JSON.stringify([1, "/v"]))}`,
    );
    expect(route.plots).toEqual([{ topic: "a/b", pointer: "/v" }]);
  });

  it("accepts WebSockets and explains browser transport constraints", () => {
    expect(
      isWebSocketBroker("ws://localhost:9001/mqtt", "http:"),
    ).toBeUndefined();
    expect(
      isWebSocketBroker("wss://broker.example/mqtt", "https:"),
    ).toBeUndefined();
    expect(
      isWebSocketBroker("ws://192.168.1.10:9001/mqtt", "file:"),
    ).toBeUndefined();
    expect(isWebSocketBroker("mqtt://localhost:1883", "http:")).toContain(
      "WebSockets",
    );
    expect(isWebSocketBroker("ws://localhost:9001", "https:")).toContain(
      "HTTPS",
    );
    expect(
      isWebSocketBroker("wss://user:secret@broker.example", "https:"),
    ).toContain("credentials");
    expect(isWebSocketBroker("localhost", "http:")).toContain("complete");
  });
});
