import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_PLOT_WINDOW_MS,
  connectionKey,
  defaultRoute,
  isWebSocketBroker,
  launchUrl,
  readLaunchRoute,
  uniqueFilters,
} from "./routes";

describe("route configuration", () => {
  it("defaults to a wildcard subscription and bounded history", () => {
    expect(defaultRoute()).toEqual({
      broker: "",
      filters: ["#"],
      historyLimit: DEFAULT_HISTORY_LIMIT,
      historyAgeMs: null,
      plotWindowMs: DEFAULT_PLOT_WINDOW_MS,
      timeZone: "local",
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
    expect(connectionKey({ ...route, plotWindowMs: null })).toBe(
      connectionKey(route),
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

  it("reads a complete launch query with repeated subscriptions", () => {
    expect(
      readLaunchRoute({
        href: "https://telemetry.example/?broker=wss://broker.example/mqtt&sub=dt/%23&sub=$SYS/%23&history=250&age=1h",
        search:
          "?broker=wss://broker.example/mqtt&sub=dt/%23&sub=$SYS/%23&history=250&age=1h",
        hash: "",
        protocol: "https:",
      }),
    ).toMatchObject({
      present: true,
      route: {
        broker: "wss://broker.example/mqtt",
        filters: ["dt/#", "$SYS/#"],
        historyLimit: 250,
        historyAgeMs: 3_600_000,
        plots: [],
      },
    });
  });

  it("writes a readable canonical launch URL with only necessary escaping", () => {
    expect(
      launchUrl(
        {
          ...defaultRoute(),
          broker: "wss://broker.example/mqtt?token=a/b",
          filters: ["dt/+/#", "$SYS/#"],
          historyLimit: 250,
          historyAgeMs: 3_600_000,
        },
        { href: "https://telemetry.example/old?discard=1#old" } as Location,
      ),
    ).toBe(
      "https://telemetry.example/old?broker=wss://broker.example/mqtt?token=a/b&sub=dt/%2B/%23&sub=$SYS/%23&history=250&age=1h",
    );
  });

  it("rejects ambiguous wildcards and invalid launch limits", () => {
    const base = {
      protocol: "https:",
      hash: "",
      href: "https://telemetry.example/",
    };
    expect(
      readLaunchRoute({
        ...base,
        search: "?broker=wss://broker.example&sub=dt/+",
      }).error,
    ).toContain("%2B");
    expect(
      readLaunchRoute({
        ...base,
        href: "https://telemetry.example/?broker=wss://broker.example&sub=dt/#",
        search: "?broker=wss://broker.example&sub=dt/",
      }).error,
    ).toContain("%23");
    expect(
      readLaunchRoute({
        ...base,
        hash: "#&history=250",
        href: "https://telemetry.example/?broker=wss://broker.example&sub=dt/#&history=250",
        search: "?broker=wss://broker.example&sub=dt/",
      }).error,
    ).toContain("%23");
    expect(
      readLaunchRoute({
        ...base,
        search: "?broker=wss://broker.example&sub=dt/%23&history=0",
      }).error,
    ).toContain("history");
    expect(
      readLaunchRoute({
        ...base,
        search: "?broker=wss://broker.example&sub=dt/%23&age=1week",
      }).error,
    ).toContain("age");
  });

  it("does not turn an incomplete query into a wildcard connection", () => {
    expect(
      readLaunchRoute({
        href: "https://telemetry.example/?broker=wss://broker.example&history=1000",
        search: "?broker=wss://broker.example&history=1000",
        hash: "",
        protocol: "https:",
      }),
    ).toMatchObject({ present: true, error: expect.any(String) });
  });
});
