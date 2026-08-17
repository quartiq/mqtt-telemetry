import mqtt, {
  type IClientOptions,
  type IClientSubscribeOptions,
  type MqttClient,
  type Packet,
} from "mqtt";
import { isWebSocketBroker } from "./routes";

export type SessionStatus =
  | { state: "connected" | "reconnecting" | "offline" }
  | { state: "error"; error: string };

export type IncomingMessage = {
  topic: string;
  payload: Uint8Array;
  packet: Packet;
};

export type SessionCallbacks = {
  message: (message: IncomingMessage) => void;
  status: (status: SessionStatus) => void;
};

export type SessionAuth = { username: string; password: string };

export function clientOptions(auth?: Partial<SessionAuth>): IClientOptions {
  const username = auth?.username ?? "";
  const password = auth?.password ?? "";
  return {
    clean: true,
    clientId: `mqtttelemetry${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
    connectTimeout: 5000,
    keepalive: 15,
    protocolVersion: 4,
    queueQoSZero: false,
    reconnectPeriod: 1000,
    resubscribe: true,
    ...(username || password ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

export class MqttSession {
  private closing = false;
  private subscribed = false;
  private readonly online = () => {
    if (this.closing || !this.client.reconnecting) return;
    this.callbacks.status({ state: "reconnecting" });
    this.client.reconnect();
  };

  private constructor(
    private readonly client: MqttClient,
    private readonly callbacks: SessionCallbacks,
    filters: string[],
  ) {
    client.on("message", (topic, payload, packet) => {
      callbacks.message({ topic, payload, packet });
    });
    client.on("connect", () => void this.connected(filters));
    client.on("reconnect", () => {
      if (!this.closing) callbacks.status({ state: "reconnecting" });
    });
    client.on("offline", () => {
      if (!this.closing) callbacks.status({ state: "offline" });
    });
    client.on("close", () => {
      if (!this.closing) callbacks.status({ state: "reconnecting" });
    });
    client.on("error", (error: Error) => {
      if (!this.closing)
        callbacks.status({ state: "error", error: error.message });
    });
    globalThis.addEventListener?.("online", this.online);
  }

  private async connected(filters: string[]): Promise<void> {
    if (!this.subscribed) {
      try {
        await this.client.subscribeAsync(filters, {
          qos: 0,
        } satisfies IClientSubscribeOptions);
        this.subscribed = true;
      } catch (error) {
        if (!this.closing) {
          this.callbacks.status({
            state: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }
    if (!this.closing) this.callbacks.status({ state: "connected" });
  }

  static connect(
    broker: string,
    filters: string[],
    callbacks: SessionCallbacks,
    auth?: Partial<SessionAuth>,
  ): MqttSession {
    const brokerError = isWebSocketBroker(broker);
    if (brokerError) throw new Error(brokerError);

    const client = mqtt.connect(broker, clientOptions(auth));
    return new MqttSession(client, callbacks, filters);
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    globalThis.removeEventListener?.("online", this.online);
    this.client.end(true);
  }
}
