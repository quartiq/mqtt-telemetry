import mqtt, {
  type IClientOptions,
  type IClientSubscribeOptions,
  type MqttClient,
  type Packet,
} from "mqtt";
import { randomId } from "./random-id";
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

export function clientOptions(auth?: Partial<SessionAuth>): IClientOptions {
  const username = auth?.username ?? "";
  const password = auth?.password ?? "";
  return {
    clean: true,
    clientId: `mqtttelemetry${randomId().replaceAll("-", "").slice(0, 10)}`,
    connectTimeout: 15_000,
    keepalive: 30,
    protocolVersion: 4,
    queueQoSZero: false,
    reconnectPeriod: 0,
    resubscribe: false,
    ...(username || password ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

export class MqttSession {
  private closing = false;
  private generation = 0;
  private offline = false;

  private constructor(
    private readonly client: MqttClient,
    private readonly callbacks: SessionCallbacks,
    private readonly filters: string[],
  ) {
    client.on("message", (topic, payload, packet) => {
      if (!this.closing) callbacks.message({ topic, payload, packet });
    });
    client.on("connect", () => {
      if (this.closing) return;
      this.offline = false;
      void this.connected(++this.generation);
    });
    client.on("reconnect", () => {
      if (!this.closing) callbacks.status({ state: "reconnecting" });
    });
    client.on("offline", () => this.noteOffline());
    client.on("close", () => this.noteOffline());
    client.on("error", (error: Error) => {
      if (!this.closing)
        callbacks.status({ state: "error", error: error.message });
    });
  }

  private noteOffline(): void {
    if (this.closing || this.offline) return;
    this.offline = true;
    this.generation += 1;
    this.callbacks.status({ state: "offline" });
  }

  private async subscribe(): Promise<string[]> {
    const grants = await this.client.subscribeAsync(this.filters, {
      qos: 0,
    } satisfies IClientSubscribeOptions);
    return grants.filter(({ qos }) => qos === 128).map(({ topic }) => topic);
  }

  private async connected(generation: number): Promise<void> {
    let rejected: string[];
    try {
      rejected = await this.subscribe();
    } catch (error) {
      if (
        generation === this.generation &&
        this.client.connected &&
        !this.closing
      ) {
        this.closing = true;
        this.client.end(true);
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
      !this.closing
    )
      this.callbacks.status({ state: "connected", rejected });
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
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        client.off("connect", connected);
        client.off("close", closed);
        client.off("error", failed);
      };
      const connected = () => {
        cleanup();
        resolve();
      };
      const closed = () => {
        cleanup();
        client.end(true);
        reject(new Error(`Could not connect to ${broker}`));
      };
      const failed = (error: Error) => {
        cleanup();
        client.end(true);
        reject(error);
      };
      client.once("connect", connected);
      client.once("close", closed);
      client.once("error", failed);
    });

    const session = new MqttSession(client, callbacks, filters);
    const generation = ++session.generation;
    let rejected: string[];
    try {
      rejected = await session.subscribe();
      if (generation !== session.generation || !client.connected)
        throw new Error("Connection closed while subscribing");
    } catch (error) {
      session.close();
      throw error;
    }
    client.options.reconnectPeriod = 1000;
    callbacks.status({ state: "connected", rejected });
    return session;
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.generation += 1;
    this.client.end(true);
  }
}
