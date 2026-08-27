import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  connectionKey,
  defaultRoute,
  isWebSocketBroker,
  uniqueFilters,
} from "./routes";

describe("route configuration", () => {
  it("defaults to a wildcard subscription and bounded history", () => {
    expect(defaultRoute()).toEqual({
      broker: "",
      filters: ["#"],
      historyLimit: DEFAULT_HISTORY_LIMIT,
      historyAgeMs: null,
      selectedTopic: "",
      fieldPath: null,
      plots: [],
    });
  });

  it("keeps view and retention changes on the same connection", () => {
    const route = {
      ...defaultRoute(),
      broker: "wss://broker.example",
      filters: ["a/#"],
    };
    expect(connectionKey({ ...route, historyLimit: 12 })).toBe(
      connectionKey({ ...route, historyLimit: 34 }),
    );
    expect(connectionKey({ ...route, historyAgeMs: 60_000 })).toBe(
      connectionKey({
        ...route,
        plots: [{ topic: "a", path: "$.value" }],
      }),
    );
  });

  it("removes only exact duplicate and empty filters", () => {
    expect(uniqueFilters(["a/#", "a/#", "", " a/#"])).toEqual(["a/#", " a/#"]);
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
