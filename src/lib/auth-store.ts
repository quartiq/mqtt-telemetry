export type MqttAuth = { username: string; password: string };

function key(broker: string): string {
  return `mqtt-telemetry:auth:${broker}`;
}

export function loadAuth(broker: string): MqttAuth {
  if (!broker) return { username: "", password: "" };
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key(broker)) ?? "null",
    ) as Partial<MqttAuth>;
    return {
      username: typeof value?.username === "string" ? value.username : "",
      password: typeof value?.password === "string" ? value.password : "",
    };
  } catch {
    return { username: "", password: "" };
  }
}

export function saveAuth(broker: string, auth: MqttAuth): void {
  if (!broker) return;
  if (!auth.username && !auth.password) {
    sessionStorage.removeItem(key(broker));
  } else {
    sessionStorage.setItem(key(broker), JSON.stringify(auth));
  }
}
