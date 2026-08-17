export const DEFAULT_HISTORY_LIMIT = 1000;
export const MAX_HISTORY_LIMIT = 10_000;
export const DEFAULT_FILTER = "#";

export type AppRoute = {
  broker: string;
  filters: string[];
  historyLimit: number;
  selectedTopic: string;
  fieldPointer: string | null;
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

export function readRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const fieldPointer = params.has("field") ? (params.get("field") ?? "") : null;
  return {
    broker: params.get("broker")?.trim() ?? "",
    filters: uniqueFilters(params.getAll("topic")),
    historyLimit: parseHistoryLimit(params.get("history")),
    selectedTopic: params.get("selected") ?? "",
    fieldPointer:
      fieldPointer === null || !fieldPointer || fieldPointer.startsWith("/")
        ? fieldPointer
        : null,
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
  if (route.selectedTopic) params.push(["selected", route.selectedTopic]);
  if (route.fieldPointer !== null) params.push(["field", route.fieldPointer]);
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
