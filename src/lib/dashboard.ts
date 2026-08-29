import { jsonPath, parseJsonPath, type DisplayTimeZone } from "./model";
import {
  DEFAULT_PLOT_WINDOW_MS,
  MAX_HISTORY_AGE_SECONDS,
  MAX_HISTORY_LIMIT,
  MAX_PLOTS,
  type AppRoute,
  type PlotRef,
} from "./routes";

export const DASHBOARD_FORMAT = "mqtt-telemetry-dashboard";
export const DASHBOARD_VERSION = 1;
export const DASHBOARD_FRAGMENT = "dashboard";

export type Dashboard = {
  format: typeof DASHBOARD_FORMAT;
  version: typeof DASHBOARD_VERSION;
  broker: string;
  subscriptions: string[];
  retention: {
    messagesPerTopic: number;
    maxAgeSeconds: number | null;
  };
  display: {
    timeZone: DisplayTimeZone;
    plotWindowSeconds: number | null;
  };
  plots: PlotRef[];
};

export function dashboardFromRoute(route: AppRoute): Dashboard {
  return {
    format: DASHBOARD_FORMAT,
    version: DASHBOARD_VERSION,
    broker: route.broker,
    subscriptions: [...route.filters],
    retention: {
      messagesPerTopic: route.historyLimit,
      maxAgeSeconds:
        route.historyAgeMs === null ? null : route.historyAgeMs / 1000,
    },
    display: {
      timeZone: route.timeZone,
      plotWindowSeconds:
        route.plotWindowMs === null ? null : route.plotWindowMs / 1000,
    },
    plots: route.plots.map(({ topic, path }) => ({ topic, path })),
  };
}

export function routeFromDashboard(dashboard: Dashboard): AppRoute {
  const focus = dashboard.plots[0];
  return {
    broker: dashboard.broker,
    filters: dashboard.subscriptions,
    historyLimit: dashboard.retention.messagesPerTopic,
    historyAgeMs:
      dashboard.retention.maxAgeSeconds === null
        ? null
        : dashboard.retention.maxAgeSeconds * 1000,
    timeZone: dashboard.display.timeZone,
    plotWindowMs:
      dashboard.display.plotWindowSeconds === null
        ? null
        : dashboard.display.plotWindowSeconds * 1000,
    selectedTopic: focus?.topic ?? "",
    fieldPath: focus?.path ?? null,
    plots: dashboard.plots,
  };
}

export function parseDashboardJson(json: string): Dashboard {
  if (json.length > 1024 * 1024)
    throw new Error("Dashboard JSON is too large.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Dashboard file is not valid JSON.");
  }
  return parseDashboard(value);
}

export function parseDashboard(value: unknown): Dashboard {
  if (!isRecord(value)) throw new Error("Dashboard must be a JSON object.");
  if (value.format !== DASHBOARD_FORMAT || value.version !== DASHBOARD_VERSION)
    throw new Error("Unsupported MQTT Telemetry dashboard format or version.");
  if (typeof value.broker !== "string" || !webSocketUrl(value.broker))
    throw new Error(
      "Dashboard broker must be a ws:// or wss:// URL without credentials.",
    );
  if (
    !Array.isArray(value.subscriptions) ||
    !value.subscriptions.length ||
    value.subscriptions.some(
      (filter) => typeof filter !== "string" || !filter.length,
    )
  )
    throw new Error("Dashboard subscriptions must be non-empty strings.");
  const subscriptions = value.subscriptions as string[];
  if (!isRecord(value.retention))
    throw new Error("Dashboard retention settings are missing.");
  const messages = value.retention.messagesPerTopic;
  if (!integerBetween(messages, 1, MAX_HISTORY_LIMIT))
    throw new Error(
      `Messages per topic must be between 1 and ${MAX_HISTORY_LIMIT}.`,
    );
  const age = value.retention.maxAgeSeconds;
  if (age !== null && !integerBetween(age, 1, MAX_HISTORY_AGE_SECONDS))
    throw new Error("Dashboard history age is invalid.");
  const display = value.display;
  if (display !== undefined && !isRecord(display))
    throw new Error("Dashboard display settings are invalid.");
  const timeZone =
    display === undefined
      ? "local"
      : display.timeZone === "local" || display.timeZone === "utc"
        ? display.timeZone
        : undefined;
  if (!timeZone) throw new Error("Dashboard display time zone is invalid.");
  const plotWindowSeconds =
    display?.plotWindowSeconds === undefined
      ? DEFAULT_PLOT_WINDOW_MS / 1000
      : display.plotWindowSeconds;
  if (
    plotWindowSeconds !== null &&
    !integerBetween(plotWindowSeconds, 1, MAX_HISTORY_AGE_SECONDS)
  )
    throw new Error("Dashboard plot window is invalid.");
  if (!Array.isArray(value.plots) || value.plots.length > MAX_PLOTS)
    throw new Error(`A dashboard can contain at most ${MAX_PLOTS} plots.`);

  const plots: PlotRef[] = [];
  const keys = new Set<string>();
  for (const item of value.plots) {
    if (
      !isRecord(item) ||
      typeof item.topic !== "string" ||
      !item.topic ||
      typeof item.path !== "string"
    )
      throw new Error("Each plot needs a topic and a singular JSONPath.");
    const parsedPath = parseJsonPath(item.path);
    if (!parsedPath)
      throw new Error("Each plot needs a topic and a singular JSONPath.");
    const plot = { topic: item.topic, path: jsonPath(parsedPath) };
    const key = JSON.stringify([plot.topic, plot.path]);
    if (keys.has(key)) throw new Error("Dashboard contains a duplicate plot.");
    keys.add(key);
    plots.push(plot);
  }

  return {
    format: DASHBOARD_FORMAT,
    version: DASHBOARD_VERSION,
    broker: value.broker,
    subscriptions: [...new Set(subscriptions)],
    retention: {
      messagesPerTopic: messages,
      maxAgeSeconds: age,
    },
    display: { timeZone, plotWindowSeconds },
    plots,
  };
}

export function dashboardJson(route: AppRoute, pretty = true): string {
  return JSON.stringify(dashboardFromRoute(route), null, pretty ? 2 : 0);
}

export function dashboardShareUrl(route: AppRoute, location: Location): string {
  const url = new URL(location.href);
  url.search = "";
  url.hash = `${DASHBOARD_FRAGMENT}=${encodeURIComponent(dashboardJson(route, false))}`;
  return url.href;
}

function webSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function integerBetween(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
