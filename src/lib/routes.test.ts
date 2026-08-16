import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
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
    expect(readRoute(routeSearch(expected))).toEqual(expected);
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
    expect(isWebSocketBroker("localhost", "http:")).toContain("complete");
  });
});
