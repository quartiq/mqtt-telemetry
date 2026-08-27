import { describe, expect, it } from "vitest";
import {
  dashboardFromRoute,
  dashboardJson,
  dashboardShareUrl,
  parseDashboard,
  parseDashboardJson,
  routeFromDashboard,
} from "./dashboard";
import type { AppRoute } from "./routes";

const route: AppRoute = {
  broker: "wss://broker.example/mqtt",
  filters: ["sensors/#"],
  historyLimit: 250,
  historyAgeMs: 60_000,
  timeZone: "utc",
  selectedTopic: "unshared/selection",
  fieldPath: "$.unshared",
  plots: [{ topic: "sensors/room", path: "$.temperature" }],
};

describe("dashboard files", () => {
  it("detaches history state from reactive route collections", () => {
    const reactiveLikeRoute = {
      ...route,
      filters: new Proxy([...route.filters], {}),
      plots: new Proxy(
        route.plots.map((plot) => new Proxy({ ...plot }, {})),
        {},
      ),
    };
    const dashboard = dashboardFromRoute(reactiveLikeRoute);
    expect(() => structuredClone(dashboard)).not.toThrow();
    expect(dashboard.subscriptions).toEqual(route.filters);
    expect(dashboard.plots).toEqual(route.plots);
  });

  it("round-trips only durable dashboard configuration", () => {
    const dashboard = parseDashboardJson(dashboardJson(route));
    expect(dashboard).toMatchObject({
      broker: route.broker,
      subscriptions: route.filters,
      retention: { messagesPerTopic: 250, maxAgeSeconds: 60 },
      display: { timeZone: "utc" },
      plots: route.plots,
    });
    expect(routeFromDashboard(dashboard)).toMatchObject({
      timeZone: "utc",
      selectedTopic: "sensors/room",
      fieldPath: "$.temperature",
    });
    expect(dashboardJson(route)).not.toContain("unshared");
  });

  it("normalizes readable and bracketed singular JSONPaths", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    dashboard.plots[0].path = "$['temperature']";
    expect(parseDashboard(dashboard).plots[0].path).toBe("$.temperature");
  });

  it("loads older version-one dashboards in browser-local time", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    delete dashboard.display;
    expect(parseDashboard(dashboard).display.timeZone).toBe("local");

    dashboard.display = { timeZone: "Mars/Olympus" };
    expect(() => parseDashboard(dashboard)).toThrow(/time zone/);
  });

  it("rejects credentials, wildcard paths, and duplicate canonical plots", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    dashboard.broker = "wss://user:secret@broker.example";
    expect(() => parseDashboard(dashboard)).toThrow(/credentials|broker/);

    dashboard.broker = route.broker;
    dashboard.plots[0].path = "$.values[*]";
    expect(() => parseDashboard(dashboard)).toThrow(/JSONPath/);

    dashboard.plots = [
      { topic: "a", path: "$.value" },
      { topic: "a", path: "$['value']" },
    ];
    expect(() => parseDashboard(dashboard)).toThrow(/duplicate/);
  });

  it("puts an explicit share payload in the fragment and removes query state", () => {
    const href = dashboardShareUrl(route, {
      href: "https://telemetry.example/app?old=state#section",
    } as Location);
    const url = new URL(href);
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#dashboard=/);
    expect(
      parseDashboardJson(decodeURIComponent(url.hash.split("=", 2)[1])),
    ).toMatchObject({
      broker: route.broker,
      plots: route.plots,
    });
  });
});
