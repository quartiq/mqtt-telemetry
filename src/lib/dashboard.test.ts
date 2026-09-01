import { describe, expect, it } from "vitest";
import {
  dashboardFromRoute,
  dashboardJson,
  dashboardShareUrl,
  parseDashboard,
  parseDashboardJson,
  readInlineDashboard,
  resolveStartupRoute,
  routeFromDashboard,
} from "./dashboard";
import { defaultRoute, type AppRoute } from "./routes";

const route: AppRoute = {
  broker: "wss://broker.example/mqtt",
  filters: ["sensors/#"],
  historyLimit: 250,
  historyAgeMs: 60_000,
  plotWindowMs: 600_000,
  timeZone: "utc",
  selectedTopic: "unshared/selection",
  fieldPath: "$.unshared",
  plots: [
    { topic: "sensors/room", path: "$.temperature" },
    { topic: "sensors/outside", path: "$.humidity" },
  ],
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
      display: { timeZone: "utc", plotWindowSeconds: 600 },
      plots: route.plots,
    });
    expect(routeFromDashboard(dashboard)).toMatchObject({
      broker: route.broker,
      filters: route.filters,
      historyLimit: route.historyLimit,
      historyAgeMs: route.historyAgeMs,
      timeZone: "utc",
      plotWindowMs: 600_000,
      selectedTopic: "sensors/room",
      fieldPath: "$.temperature",
      plots: route.plots,
    });
    expect(dashboardJson(route)).not.toContain("unshared");
  });

  it("normalizes readable and bracketed singular JSONPaths", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    dashboard.plots[0].path = "$['temperature']";
    expect(parseDashboard(dashboard).plots[0].path).toBe("$.temperature");
  });

  it("loads older version-one dashboards with local time and the default plot window", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    delete dashboard.display;
    expect(parseDashboard(dashboard).display).toEqual({
      timeZone: "local",
      plotWindowSeconds: null,
    });

    dashboard.display = { timeZone: "Mars/Olympus" };
    expect(() => parseDashboard(dashboard)).toThrow(/time zone/);
  });

  it("accepts all-history dashboards and rejects invalid plot windows", () => {
    const dashboard = JSON.parse(dashboardJson(route));
    dashboard.display.plotWindowSeconds = null;
    expect(
      routeFromDashboard(parseDashboard(dashboard)).plotWindowMs,
    ).toBeNull();

    dashboard.display.plotWindowSeconds = 0;
    expect(() => parseDashboard(dashboard)).toThrow(/plot window/);
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

  it("resolves dashboard, matching tab state, launch, and default startup", () => {
    const launchRoute: AppRoute = {
      ...defaultRoute(),
      broker: "wss://launch.example",
      filters: ["launch/#"],
    };
    const storedRoute: AppRoute = {
      ...defaultRoute(),
      broker: "wss://stored.example",
      filters: ["stored/#"],
    };
    const inline = readInlineDashboard(
      new URL(
        dashboardShareUrl(route, {
          href: "https://telemetry.example/",
        } as Location),
      ).hash,
    );
    const launch = { kind: "valid", route: launchRoute } as const;

    expect(resolveStartupRoute(inline, launch, storedRoute).route.broker).toBe(
      route.broker,
    );
    expect(
      resolveStartupRoute(
        { kind: "invalid", error: "Broken dashboard" },
        launch,
        storedRoute,
      ),
    ).toEqual({ route: defaultRoute(), error: "Broken dashboard" });
    expect(
      resolveStartupRoute({ kind: "absent" }, launch, storedRoute).route.broker,
    ).toBe(launchRoute.broker);
    const matchingStored = {
      ...launchRoute,
      timeZone: "utc" as const,
      plots: [{ topic: "launch/value", path: "$.temperature" }],
    };
    expect(
      resolveStartupRoute({ kind: "absent" }, launch, matchingStored).route,
    ).toEqual(matchingStored);
    expect(
      resolveStartupRoute({ kind: "absent" }, { kind: "absent" }, storedRoute)
        .route.broker,
    ).toBe(storedRoute.broker);
    expect(
      resolveStartupRoute({ kind: "absent" }, { kind: "absent" }).route,
    ).toEqual(defaultRoute());
  });
});
