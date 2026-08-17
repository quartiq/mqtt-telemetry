import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  connectionKey,
  isWebSocketBroker,
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
      selectedTopic: "",
      fieldPointer: "",
    });
  });

  it("round-trips full broker URLs, subscriptions, and browsing state", () => {
    const expected = {
      broker: "wss://broker.example/mqtt?token=public",
      filters: ["sensors/#", "alerts/+", " room/temperature "],
      historyLimit: 42,
      selectedTopic: "sensors/room/temperature",
      fieldPointer: "/environment/temperature",
    };
    const search = routeSearch(expected);
    expect(search).toBe(
      "?broker=wss://broker.example/mqtt?token=public&topic=sensors/%23&topic=alerts/%2B&topic=%20room/temperature%20&history=42&selected=sensors/room/temperature&field=/environment/temperature",
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

  it("does not treat a live history-limit change as a new connection", () => {
    const route = readRoute("?broker=wss://broker.example&topic=a/#");
    expect(connectionKey({ ...route, historyLimit: 12 })).toBe(
      connectionKey({ ...route, historyLimit: 34 }),
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

  it("accepts WebSockets and explains browser transport constraints", () => {
    expect(
      isWebSocketBroker("ws://localhost:9001/mqtt", "http:"),
    ).toBeUndefined();
    expect(
      isWebSocketBroker("wss://broker.example/mqtt", "https:"),
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
