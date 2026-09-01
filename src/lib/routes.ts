import type { DisplayTimeZone } from "./model";

export const DEFAULT_HISTORY_LIMIT = 1000;
export const DEFAULT_PLOT_WINDOW_MS: number | null = null;
export const MAX_HISTORY_LIMIT = 10_000;
export const MAX_HISTORY_AGE_SECONDS = 365 * 24 * 60 * 60;
export const MAX_PLOTS = 8;
export const DEFAULT_FILTER = "#";

export type PlotRef = { topic: string; path: string };

export type LaunchRoute =
  | { kind: "absent" }
  | { kind: "valid"; route: AppRoute }
  | { kind: "invalid"; error: string };

export type AppRoute = {
  broker: string;
  filters: string[];
  historyLimit: number;
  historyAgeMs: number | null;
  plotWindowMs: number | null;
  timeZone: DisplayTimeZone;
  selectedTopic: string;
  fieldPath: string | null;
  plots: PlotRef[];
};

export function defaultRoute(): AppRoute {
  return {
    broker: "",
    filters: [DEFAULT_FILTER],
    historyLimit: DEFAULT_HISTORY_LIMIT,
    historyAgeMs: null,
    plotWindowMs: DEFAULT_PLOT_WINDOW_MS,
    timeZone: "local",
    selectedTopic: "",
    fieldPath: null,
    plots: [],
  };
}

export function uniqueFilters(filters: Iterable<string>): string[] {
  const unique = [...new Set([...filters].filter((filter) => filter !== ""))];
  return unique.length ? unique : [DEFAULT_FILTER];
}

export function isWebSocketBroker(
  value: string,
  pageProtocol = globalThis.location?.protocol ?? "http:",
): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a complete ws:// or wss:// broker URL.";
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return "Browsers can connect to MQTT only over ws:// or wss:// WebSockets.";
  }
  if (url.username || url.password) {
    return "Do not put credentials in the broker URL. Use the username and password fields.";
  }
  if (pageProtocol === "https:" && url.protocol === "ws:") {
    return "An HTTPS page cannot connect to a ws:// broker. Use wss:// or open the app over HTTP.";
  }
  return undefined;
}

export function connectionKey(route: AppRoute): string {
  return JSON.stringify([route.broker, uniqueFilters(route.filters)]);
}

export function readLaunchRoute(
  location: Pick<Location, "href" | "search" | "hash" | "protocol">,
): LaunchRoute {
  const parameters = new URLSearchParams(location.search);
  const names = ["broker", "sub", "history", "age", "window"];
  const present = names.some((name) => parameters.has(name));
  if (!present) return { kind: "absent" };

  if (location.hash || location.href.endsWith("#"))
    return launchError(
      "Encode MQTT # wildcards in subscription parameters as %23.",
    );
  if (/[?&]sub=[^&]*\+/.test(location.search))
    return launchError(
      "Encode MQTT + wildcards in subscription parameters as %2B.",
    );
  for (const name of ["broker", "history", "age", "window"])
    if (parameters.getAll(name).length > 1)
      return launchError(`URL parameter ${name} may appear only once.`);

  const broker = parameters.get("broker") ?? "";
  const filters = parameters.getAll("sub");
  if (!broker || !filters.length || filters.some((filter) => !filter))
    return launchError(
      "A launch URL needs one broker and at least one non-empty sub parameter.",
    );
  const brokerError = isWebSocketBroker(broker, location.protocol);
  if (brokerError) return launchError(brokerError);

  const historyValue = parameters.get("history");
  const historyLimit =
    historyValue === null ? DEFAULT_HISTORY_LIMIT : Number(historyValue);
  if (
    historyValue !== null &&
    (!/^\d+$/.test(historyValue) ||
      !Number.isSafeInteger(historyLimit) ||
      historyLimit < 1 ||
      historyLimit > MAX_HISTORY_LIMIT)
  )
    return launchError(
      `URL history must be an integer from 1 to ${MAX_HISTORY_LIMIT}.`,
    );

  const ageValue = parameters.get("age");
  const historyAgeMs = ageValue === null ? null : parseAge(ageValue);
  if (ageValue !== null && historyAgeMs === undefined)
    return launchError(
      "URL age must be a positive duration such as 10m, 1h, or 7d.",
    );

  const windowValue = parameters.get("window");
  const plotWindowMs =
    windowValue === null || windowValue === "all"
      ? null
      : parseAge(windowValue);
  if (plotWindowMs === undefined)
    return launchError(
      "URL window must be all or a positive duration such as 10m, 1h, or 7d.",
    );

  return {
    kind: "valid",
    route: {
      ...defaultRoute(),
      broker,
      filters: uniqueFilters(filters),
      historyLimit,
      historyAgeMs: historyAgeMs ?? null,
      plotWindowMs,
    },
  };
}

export function launchUrl(
  route: AppRoute,
  location: Pick<Location, "href">,
): string {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  if (!route.broker) return url.href;

  const parameters = new URLSearchParams();
  parameters.set("broker", route.broker);
  for (const filter of uniqueFilters(route.filters))
    parameters.append("sub", filter);
  parameters.set("history", String(route.historyLimit));
  if (route.historyAgeMs !== null)
    parameters.set("age", formatAge(route.historyAgeMs));
  if (route.plotWindowMs !== null)
    parameters.set("window", formatAge(route.plotWindowMs));
  url.search = readableSearch(parameters);
  return url.href;
}

function launchError(error: string): LaunchRoute {
  return { kind: "invalid", error };
}

function parseAge(value: string): number | undefined {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  if (!match) return undefined;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as "s" | "m" | "h" | "d"
  ];
  const milliseconds = Number(match[1]) * unit;
  return Number.isSafeInteger(milliseconds) &&
    milliseconds <= MAX_HISTORY_AGE_SECONDS * 1000
    ? milliseconds
    : undefined;
}

function formatAge(milliseconds: number): string {
  for (const [suffix, unit] of [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ] as const)
    if (milliseconds % unit === 0) return `${milliseconds / unit}${suffix}`;
  return `${milliseconds / 1000}s`;
}

function readableSearch(parameters: URLSearchParams): string {
  return parameters
    .toString()
    .replaceAll("+", "%20")
    .replace(/%(?:3A|2F|24|3F|3D|5B|5D)/g, decodeURIComponent);
}
