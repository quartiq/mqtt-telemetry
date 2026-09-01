import {
  dashboardFromRoute,
  parseDashboard,
  routeFromDashboard,
  type Dashboard,
} from "./dashboard";
import { jsonPath, parseJsonPath } from "./json";
import type { AppRoute } from "./routes";

export type BrowserViewState = {
  app: "mqtt-telemetry";
  token: string;
  messageId: number | null;
  dashboard: Dashboard;
  selectedTopic: string;
  fieldPath: string | null;
};

export function browserViewState(
  route: AppRoute,
  token: string,
  messageId: number | null,
): BrowserViewState {
  return {
    app: "mqtt-telemetry",
    token,
    messageId,
    dashboard: dashboardFromRoute(route),
    selectedTopic: route.selectedTopic,
    fieldPath: route.fieldPath,
  };
}

export function routeFromViewState(state: unknown): AppRoute | undefined {
  if (!isViewState(state)) return undefined;
  try {
    const base = routeFromDashboard(parseDashboard(state.dashboard));
    const parsedField =
      typeof state.fieldPath === "string"
        ? parseJsonPath(state.fieldPath)
        : undefined;
    return {
      ...base,
      selectedTopic:
        typeof state.selectedTopic === "string"
          ? state.selectedTopic
          : base.selectedTopic,
      fieldPath:
        state.fieldPath === null
          ? null
          : parsedField
            ? jsonPath(parsedField)
            : base.fieldPath,
    };
  } catch {
    return undefined;
  }
}

export function messageIdFromViewState(
  state: unknown,
  token: string,
): number | null {
  return isViewState(state) &&
    state.token === token &&
    typeof state.messageId === "number"
    ? state.messageId
    : null;
}

function isViewState(
  state: unknown,
): state is Partial<BrowserViewState> &
  Pick<BrowserViewState, "app" | "dashboard"> {
  return (
    typeof state === "object" &&
    state !== null &&
    "app" in state &&
    state.app === "mqtt-telemetry" &&
    "dashboard" in state
  );
}
