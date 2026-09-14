import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_PLOT_WINDOW_MS,
  defaultRoute,
  isWebSocketBroker,
  launchUrl,
  readLaunchRoute,
  subscriptionLines,
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

  it("validates subscription lines without changing meaningful spaces or empty levels", () => {
    expect(subscriptionLines("\r\n#\r\n#\r\n")).toEqual(["#"]);
    expect(subscriptionLines("\n")).toEqual([]);
    expect(subscriptionLines(" a/+/ ")).toEqual([" a/+/ "]);
    expect(subscriptionLines("a//+\n$SYS/#\na/温度\na/😀")).toEqual([
      "a//+",
      "$SYS/#",
      "a/温度",
      "a/😀",
    ]);
    expect(() => subscriptionLines("#\n\na/#/b")).toThrow(/line 3/);
    expect(() => subscriptionLines("a+")).toThrow(/complete topic level/);
    expect(() => subscriptionLines("a\0")).toThrow(/UTF-8/);
    expect(() => subscriptionLines("a\uD800")).toThrow(/UTF-8/);
    expect(() => subscriptionLines("温".repeat(21846))).toThrow(/65,535/);
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&sub=valid&sub=a%23",
      ),
    ).toMatchObject({
      kind: "invalid",
      error: expect.stringContaining("URL subscription 2"),
    });
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
        "https://telemetry.example/?broker=wss://broker.example/mqtt&sub=dt/%23&sub=dt/%23&sub=$SYS/%23&history=250&age=1h&window=all",
      ),
    ).toMatchObject({
      kind: "valid",
      route: {
        broker: "wss://broker.example/mqtt",
        filters: ["dt/#", "$SYS/#"],
        historyLimit: 250,
        historyAgeMs: 3_600_000,
        plotWindowMs: null,
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
          plotWindowMs: 600_000,
        },
        new URL("https://telemetry.example/old?discard=1#old"),
      ),
    ).toBe(
      "https://telemetry.example/old?broker=wss://broker.example/mqtt?token=a/b&sub=dt/%2B/%23&sub=$SYS/%23&sub=room%20one/%23&history=250&age=1h&window=10m",
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
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&sub=dt/%23&window=recent",
      ),
    ).toMatchObject({
      kind: "invalid",
      error: expect.stringContaining("window"),
    });
  });

  it("round-trips an empty subscription list without a wildcard fallback", () => {
    expect(
      launch(
        "https://telemetry.example/?broker=wss://broker.example&history=1000",
      ),
    ).toMatchObject({ kind: "valid", route: { filters: [] } });
    const empty = {
      ...defaultRoute(),
      broker: "wss://broker.example",
      filters: [],
    };
    expect(
      launch(launchUrl(empty, new URL("https://telemetry.example/"))),
    ).toMatchObject({ kind: "valid", route: { filters: [] } });
    expect(
      launch("https://telemetry.example/?broker=wss://broker.example&sub="),
    ).toMatchObject({ kind: "invalid" });
  });
});
