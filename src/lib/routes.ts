export const DEFAULT_HISTORY_LIMIT = 1000;
export const MAX_HISTORY_LIMIT = 10_000;
export const MAX_HISTORY_AGE_SECONDS = 365 * 24 * 60 * 60;
export const MAX_PLOTS = 8;
export const DEFAULT_FILTER = "#";

export type PlotRef = { topic: string; path: string };

export type AppRoute = {
  broker: string;
  filters: string[];
  historyLimit: number;
  historyAgeMs: number | null;
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
