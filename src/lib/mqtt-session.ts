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
  | { state: "reconnecting" | "offline" | "restoring" | "updating" }
  | { state: "error" | "failed"; error: string };

export type IncomingMessage = {
  topic: string;
  payload: Uint8Array;
  packet: Packet;
  segment: number;
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
  private readonly grants = new Map<string, boolean>();
  private synchronizing?: Promise<void>;
  private synchronizingGeneration = 0;
  private refresh = false;

  private constructor(
    private readonly client: MqttClient,
    private readonly callbacks: SessionCallbacks,
    private desiredFilters: string[],
  ) {
    client.on("message", (topic, payload, packet) => {
      if (!this.closing)
        callbacks.message({ topic, payload, packet, segment: this.generation });
    });
    client.on("connect", () => {
      if (this.closing) return;
      this.offline = false;
      this.generation += 1;
      this.grants.clear();
      void this.synchronize("restoring");
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

  private subscribe(filters = this.desiredFilters): Promise<string[]> {
    // subscribeAsync rejects partial SUBACKs and loses the grant list.
    return subscriptionAck(
      new Promise((resolve, reject) => {
        this.client.subscribe(
          filters,
          { qos: 0 } satisfies IClientSubscribeOptions,
          (error, _grants, packet) => {
            if (packet?.granted.length === filters.length) {
              resolve(
                filters.filter((_, index) => packet.granted[index] === 128),
              );
            } else {
              reject(
                error ?? new Error("Incomplete subscription acknowledgment"),
              );
            }
          },
        );
      }),
    );
  }

  private current(generation: number): boolean {
    return (
      generation === this.generation && this.client.connected && !this.closing
    );
  }

  private synchronize(state: "restoring" | "updating"): Promise<void> {
    if (this.synchronizing && this.synchronizingGeneration === this.generation)
      return this.synchronizing;
    const generation = this.generation;
    this.callbacks.status({ state });
    const pending = this.reconcile(generation)
      .catch((error) => {
        if (!this.current(generation)) return;
        this.close();
        this.callbacks.status({
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.synchronizing === pending) this.synchronizing = undefined;
      });
    this.synchronizing = pending;
    this.synchronizingGeneration = generation;
    return pending;
  }

  private async reconcile(generation: number): Promise<void> {
    while (this.current(generation)) {
      const additions = this.desiredFilters.filter(
        (filter) => this.refresh || !this.grants.has(filter),
      );
      this.refresh = false;
      if (additions.length) {
        const rejected = await this.subscribe(additions);
        if (!this.current(generation)) return;
        for (const filter of additions)
          this.grants.set(filter, !rejected.includes(filter));
      }
      // Finish additions from newer edits before removing overlapping filters.
      if (this.desiredFilters.some((filter) => !this.grants.has(filter)))
        continue;
      // Add first so replacing an overlapping filter does not create a gap.
      const removals = [...this.grants.keys()].filter(
        (filter) => !this.desiredFilters.includes(filter),
      );
      if (removals.length) {
        await subscriptionAck(this.client.unsubscribeAsync(removals));
        if (!this.current(generation)) return;
        for (const filter of removals) this.grants.delete(filter);
      }
      // A newer edit may have arrived while an acknowledgment was pending.
      if (
        !this.refresh &&
        [...this.grants.keys()].every((filter) =>
          this.desiredFilters.includes(filter),
        ) &&
        this.desiredFilters.every((filter) => this.grants.has(filter))
      ) {
        this.callbacks.status({
          state: "connected",
          rejected: this.desiredFilters.filter(
            (filter) => !this.grants.get(filter),
          ),
        });
        return;
      }
    }
  }

  async setFilters(filters: string[]): Promise<void> {
    if (this.closing) throw new Error("Reconnect to update subscriptions.");
    this.desiredFilters = [...filters];
    if (this.client.connected) await this.synchronize("updating");
  }

  async resubscribe(): Promise<void> {
    if (this.closing || !this.client.connected)
      throw new Error("Cannot resubscribe while disconnected.");
    this.refresh = true;
    await this.synchronize("restoring");
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
    for (const filter of filters)
      session.grants.set(filter, !rejected.includes(filter));
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

// A responsive transport can still leave SUBACK or UNSUBACK unanswered.
async function subscriptionAck<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Subscription acknowledgment timed out")),
          15_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
