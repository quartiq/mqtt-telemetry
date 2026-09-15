import type { SessionAuth } from "./mqtt-session";

const key = "mqtt-telemetry.connection";

// One tab-local connection, deliberately separate from routes and dashboards.
export function restoreAuth(broker: string): SessionAuth | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      value?.broker === broker &&
      typeof value.username === "string" &&
      typeof value.password === "string"
    )
      return { username: value.username, password: value.password };
    sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable, including for saved-file use.
  }
  return undefined;
}

export function rememberAuth(broker?: string, auth?: SessionAuth): boolean {
  try {
    if (broker && auth && (auth.username || auth.password))
      sessionStorage.setItem(key, JSON.stringify({ broker, ...auth }));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
