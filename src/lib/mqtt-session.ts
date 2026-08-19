import mqtt, {
  type IClientOptions,
  type IClientSubscribeOptions,
  type MqttClient,
  type Packet,
} from "mqtt";
import { isWebSocketBroker } from "./routes";

export type SessionStatus =
  | { state: "connected"; rejected: string[] }
  | { state: "reconnecting" | "offline" }
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

function isTransportTimeout(error: Error): boolean {
  const message = error.message.toLocaleLowerCase();
  return (
    message.includes("connack timeout") || message.includes("keepalive timeout")
  );
}

export function clientOptions(auth?: Partial<SessionAuth>): IClientOptions {
  const username = auth?.username ?? "";
  const password = auth?.password ?? "";
  return {
    clean: true,
    clientId: `mqtttelemetry${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
    connectTimeout: 15_000,
    keepalive: 30,
    protocolVersion: 4,
    queueQoSZero: false,
    reconnectPeriod: 1000,
    resubscribe: false,
    ...(username || password ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

export class MqttSession {
  private generation = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private state: "opening" | "receiving" | "offline" | "suspended" | "closed" =
    "opening";

  private constructor(
    private readonly client: MqttClient,
    private readonly callbacks: SessionCallbacks,
    filters: string[],
  ) {
    client.on("message", (topic, payload, packet) => {
      if (this.state === "receiving")
        callbacks.message({ topic, payload, packet });
    });
    client.on("connect", () => {
      if (this.state === "closed" || this.state === "suspended") return;
      this.state = "receiving";
      void this.connected(filters, ++this.generation);
    });
    client.on("reconnect", () => {
      if (this.state !== "closed" && this.state !== "suspended")
        callbacks.status({ state: "reconnecting" });
    });
    client.on("offline", () => this.noteOffline());
    client.on("close", () => this.noteOffline());
    client.on("error", (error: Error) => {
      if (this.state === "closed" || this.state === "suspended") return;
      if (isTransportTimeout(error)) {
        this.state = "opening";
        this.generation += 1;
        callbacks.status({ state: "reconnecting" });
      } else {
        callbacks.status({ state: "error", error: error.message });
      }
    });
  }

  private noteOffline(): void {
    if (
      this.state === "closed" ||
      this.state === "suspended" ||
      this.state === "offline"
    )
      return;
    this.state = "offline";
    this.generation += 1;
    this.callbacks.status({ state: "offline" });
  }

  private async connected(
    filters: string[],
    generation: number,
  ): Promise<void> {
    let rejected: string[];
    try {
      const grants = await this.client.subscribeAsync(filters, {
        qos: 0,
      } satisfies IClientSubscribeOptions);
      rejected = grants
        .filter(({ qos }) => qos === 128)
        .map(({ topic }) => topic);
    } catch (error) {
      if (
        generation === this.generation &&
        this.client.connected &&
        this.state === "receiving"
      ) {
        this.callbacks.status({
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (
      generation === this.generation &&
      this.client.connected &&
      this.state === "receiving"
    )
      this.callbacks.status({ state: "connected", rejected });
  }

  static open(
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

  recover(): void {
    if (this.state === "closed" || this.recoveryTimer) return;
    this.state = "opening";
    this.generation += 1;
    this.callbacks.status({ state: "reconnecting" });
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (this.state === "closed" || this.state === "suspended") return;
      this.client.reconnect();
    });
  }

  suspend(): void {
    if (this.state === "closed" || this.state === "suspended") return;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.generation += 1;
    this.state = "suspended";
    this.client.end(true);
  }

  close(): void {
    if (this.state === "closed") return;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.generation += 1;
    this.state = "closed";
    this.client.end(true);
  }
}
