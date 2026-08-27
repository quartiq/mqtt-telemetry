export const DEFAULT_HISTORY_LIMIT = 1000;
export const MAX_HISTORY_LIMIT = 10_000;
export const MAX_HISTORY_AGE_SECONDS = 365 * 24 * 60 * 60;
export const MAX_PLOTS = 8;
export const DEFAULT_FILTER = "#";

export type PlotRef = { topic: string; pointer: string };

export type AppRoute = {
  broker: string;
  filters: string[];
  historyLimit: number;
  historyAgeMs: number | null;
  selectedTopic: string;
  fieldPointer: string | null;
  plots: PlotRef[];
};

export function uniqueFilters(filters: Iterable<string>): string[] {
  const unique = [...new Set([...filters].filter((filter) => filter !== ""))];
  return unique.length ? unique : [DEFAULT_FILTER];
}

export function parseHistoryLimit(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return DEFAULT_HISTORY_LIMIT;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(parsed, MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT;
}

export function parseHistoryAge(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds)
    ? Math.min(seconds, MAX_HISTORY_AGE_SECONDS) * 1000
    : null;
}

function validPointer(pointer: unknown): pointer is string {
  return typeof pointer === "string" && (!pointer || pointer.startsWith("/"));
}

function parsePlots(params: URLSearchParams): PlotRef[] {
  const plots: PlotRef[] = [];
  const keys = new Set<string>();
  for (const value of params.getAll("plot")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        typeof parsed[0] !== "string" ||
        !validPointer(parsed[1])
      )
        continue;
      const plot = { topic: parsed[0], pointer: parsed[1] };
      const key = JSON.stringify([plot.topic, plot.pointer]);
      if (!keys.has(key)) {
        plots.push(plot);
        keys.add(key);
      }
    } catch {
      // Ignore malformed optional view state.
    }
    if (plots.length === MAX_PLOTS) break;
  }
  return plots;
}

export function readRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const fieldPointer = params.has("field") ? (params.get("field") ?? "") : null;
  return {
    broker: params.get("broker")?.trim() ?? "",
    filters: uniqueFilters(params.getAll("topic")),
    historyLimit: parseHistoryLimit(params.get("history")),
    historyAgeMs: parseHistoryAge(params.get("age")),
    selectedTopic: params.get("selected") ?? "",
    fieldPointer:
      fieldPointer === null || !fieldPointer || fieldPointer.startsWith("/")
        ? fieldPointer
        : null,
    plots: parsePlots(params),
  };
}

export function routeSearch(route: AppRoute): string {
  const params: [string, string][] = [];
  if (route.broker) params.push(["broker", route.broker]);
  for (const filter of uniqueFilters(route.filters))
    params.push(["topic", filter]);
  if (route.historyLimit !== DEFAULT_HISTORY_LIMIT) {
    params.push(["history", String(route.historyLimit)]);
  }
  if (route.historyAgeMs !== null)
    params.push(["age", String(Math.round(route.historyAgeMs / 1000))]);
  if (route.selectedTopic) params.push(["selected", route.selectedTopic]);
  if (route.fieldPointer !== null) params.push(["field", route.fieldPointer]);
  for (const plot of route.plots.slice(0, MAX_PLOTS))
    params.push(["plot", JSON.stringify([plot.topic, plot.pointer])]);
  return `?${params
    .map(([key, value]) => `${key}=${readableQueryValue(value)}`)
    .join("&")}`;
}

function readableQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replaceAll("%2F", "/")
    .replaceAll("%3A", ":")
    .replaceAll("%3F", "?")
    .replaceAll("%3D", "=")
    .replaceAll("%40", "@");
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
