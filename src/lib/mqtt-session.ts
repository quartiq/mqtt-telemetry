import mqtt, {
  type IClientOptions,
  type IClientSubscribeOptions,
  type MqttClient,
  type Packet,
} from "mqtt";
import { isWebSocketBroker } from "./routes";

export type SessionStatus =
  | { state: "connected" | "reconnecting" | "offline" | "closed" }
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
    protocolVersion: 4,
    queueQoSZero: false,
    reconnectPeriod: 0,
    resubscribe: true,
    ...(username || password ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

export class MqttSession {
  private closing = false;

  private constructor(
    private readonly client: MqttClient,
    private readonly callbacks: SessionCallbacks,
  ) {
    client.on("message", (topic, payload, packet) => {
      callbacks.message({ topic, payload, packet });
    });
    client.on("connect", () => callbacks.status({ state: "connected" }));
    client.on("reconnect", () => callbacks.status({ state: "reconnecting" }));
    client.on("offline", () => callbacks.status({ state: "offline" }));
    client.on("close", () => {
      if (!this.closing) callbacks.status({ state: "closed" });
    });
    client.on("error", (error: Error) => {
      callbacks.status({ state: "error", error: error.message });
    });
  }

  static async connect(
    broker: string,
    filters: string[],
    callbacks: SessionCallbacks,
    auth?: Partial<SessionAuth>,
  ): Promise<MqttSession> {
    const brokerError = isWebSocketBroker(broker);
    if (brokerError) throw new Error(brokerError);

    const client = mqtt.connect(broker, clientOptions(auth));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        client.off("connect", onConnect);
        client.off("close", onClose);
        client.off("error", onError);
        action();
      };
      const fail = (error: Error) => {
        finish(() => {
          client.end(true);
          reject(error);
        });
      };
      const onConnect = () => {
        finish(() => {
          client.options.reconnectPeriod = 1000;
          const session = new MqttSession(client, callbacks);
          void client
            .subscribeAsync(filters, {
              qos: 0,
            } satisfies IClientSubscribeOptions)
            .then(() => {
              callbacks.status({ state: "connected" });
              resolve(session);
            })
            .catch((error: unknown) => {
              session.close();
              reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
      };
      const onClose = () => fail(new Error(`Could not connect to ${broker}.`));
      const onError = (error: Error) => fail(error);
      client.once("connect", onConnect);
      client.once("close", onClose);
      client.once("error", onError);
    });
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.client.end(true);
  }
}
