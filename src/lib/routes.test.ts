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

const launch = (href: string) => readLaunchRoute(new URL(href));

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
      launch(
        "https://telemetry.example/?broker=wss://broker.example/mqtt&sub=dt/%23&sub=$SYS/%23&history=250&age=1h",
      ),
    ).toMatchObject({
      kind: "valid",
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
          filters: ["dt/+/#", "$SYS/#", "room one/#"],
          historyLimit: 250,
          historyAgeMs: 3_600_000,
        },
        new URL("https://telemetry.example/old?discard=1#old"),
      ),
    ).toBe(
      "https://telemetry.example/old?broker=wss://broker.example/mqtt?token=a/b&sub=dt/%2B/%23&sub=$SYS/%23&sub=room%20one/%23&history=250&age=1h",
    );
  });

  it("rejects ambiguous wildcards and invalid launch limits", () => {
    expect(
      launch("https://telemetry.example/?broker=wss://broker.example&sub=dt/+"),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("%2B") });
    for (const suffix of ["#", "#&history=250"])
      expect(
        launch(
          `https://telemetry.example/?broker=wss://broker.example&sub=dt/${suffix}`,
        ),
      ).toMatchObject({
        kind: "invalid",
        error: expect.stringContaining("%23"),
      });
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&sub=dt/%23&history=0",
      ),
    ).toMatchObject({
      kind: "invalid",
      error: expect.stringContaining("history"),
    });
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&sub=dt/%23&age=1week",
      ),
    ).toMatchObject({ kind: "invalid", error: expect.stringContaining("age") });
  });

  it("does not turn an incomplete query into a wildcard connection", () => {
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&history=1000",
      ),
    ).toMatchObject({ kind: "invalid", error: expect.any(String) });
  });
});
