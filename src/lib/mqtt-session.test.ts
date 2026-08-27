import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("mqtt", () => ({ default: { connect: mocks.connect } }));

import { MqttSession, clientOptions, type SessionStatus } from "./mqtt-session";

type Grant = { topic: string; qos: 0 | 1 | 2 | 128 };
type Listener = (...args: unknown[]) => void;

function deferred() {
  let resolve!: (grants: Grant[]) => void;
  const promise = new Promise<Grant[]>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

class FakeClient {
  connected = false;
  options = { reconnectPeriod: 0 };
  listeners = new Map<string, Listener[]>();
  subscribeAsync = vi.fn().mockResolvedValue([
    { topic: "sensors/#", qos: 0 },
    { topic: "alerts/+", qos: 0 },
  ]);
  end = vi.fn();

  on(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      callback as Listener,
    ]);
    return this;
  }

  once(event: string, callback: (...args: never[]) => void): this {
    const once = (...args: unknown[]) => {
      this.off(event, once as (...args: never[]) => void);
      (callback as Listener)(...args);
    };
    return this.on(event, once as (...args: never[]) => void);
  }

  off(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter(
        (listener) => listener !== callback,
      ),
    );
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    if (event === "connect") this.connected = true;
    if (event === "offline" || event === "close") this.connected = false;
    for (const listener of [...(this.listeners.get(event) ?? [])])
      listener(...args);
  }
}

function connect(client: FakeClient, statuses: SessionStatus[] = []) {
  mocks.connect.mockReturnValueOnce(client as never);
  return MqttSession.connect(
    "ws://broker.example/mqtt",
    ["sensors/#", "alerts/+"],
    {
      status: (status) => statuses.push(status),
      message: vi.fn(),
    },
  );
}

async function establish(
  client: FakeClient,
  statuses: SessionStatus[] = [],
): Promise<MqttSession> {
  const opening = connect(client, statuses);
  client.emit("connect");
  return opening;
}

describe("MQTT session", () => {
  beforeEach(() => mocks.connect.mockReset());

  it("starts a clean, one-shot MQTT 3.1.1 browser connection", () => {
    const options = clientOptions({ username: "user", password: "secret" });
    expect(options).toMatchObject({
      clean: true,
      connectTimeout: 15_000,
      keepalive: 30,
      protocolVersion: 4,
      queueQoSZero: false,
      reconnectPeriod: 0,
      resubscribe: false,
      username: "user",
      password: "secret",
    });
    expect(options.clientId).toMatch(/^mqtttelemetry[a-f0-9]{10}$/);
    expect(options.clientId).toHaveLength(23);
    expect(clientOptions({ password: "secret" })).toMatchObject({
      username: "",
      password: "secret",
    });
  });

  it("enables reconnect only after the initial SUBACK", async () => {
    const client = new FakeClient();
    const initial = deferred();
    client.subscribeAsync.mockImplementationOnce(() => initial.promise);
    const statuses: SessionStatus[] = [];
    const opening = connect(client, statuses);

    expect(client.options.reconnectPeriod).toBe(0);
    client.emit("connect");
    await Promise.resolve();
    expect(statuses).toEqual([]);
    expect(client.options.reconnectPeriod).toBe(0);

    initial.resolve([
      { topic: "sensors/#", qos: 0 },
      { topic: "alerts/+", qos: 0 },
    ]);
    const session = await opening;

    expect(client.options.reconnectPeriod).toBe(1000);
    expect(statuses).toEqual([{ state: "connected", rejected: [] }]);
    session.close();
  });

  it("fails and closes an initial connection error without retrying", async () => {
    const client = new FakeClient();
    const opening = connect(client);

    client.emit("error", new Error("bad credentials"));

    await expect(opening).rejects.toThrow("bad credentials");
    expect(client.options.reconnectPeriod).toBe(0);
    expect(client.end).toHaveBeenCalledWith(true);
  });

  it("fails and closes an initial transport close without retrying", async () => {
    const client = new FakeClient();
    const opening = connect(client);

    client.emit("close");

    await expect(opening).rejects.toThrow(
      "Could not connect to ws://broker.example/mqtt",
    );
    expect(client.options.reconnectPeriod).toBe(0);
    expect(client.end).toHaveBeenCalledWith(true);
  });

  it("fails the initial attempt when subscribing fails", async () => {
    const client = new FakeClient();
    client.subscribeAsync.mockRejectedValueOnce(new Error("subscribe failed"));
    const opening = connect(client);

    client.emit("connect");

    await expect(opening).rejects.toThrow("subscribe failed");
    expect(client.options.reconnectPeriod).toBe(0);
    expect(client.end).toHaveBeenCalledWith(true);
  });

  it("forwards messages only while the established session is open", async () => {
    const client = new FakeClient();
    const messages: unknown[] = [];
    mocks.connect.mockReturnValueOnce(client as never);
    const opening = MqttSession.connect("ws://broker.example/mqtt", ["#"], {
      status: vi.fn(),
      message: (message) => messages.push(message),
    });
    client.emit("connect");
    const session = await opening;
    const packet = { cmd: "publish", qos: 0, retain: false };

    client.emit("message", "sensors/room", new Uint8Array([49]), packet);
    session.close();
    client.emit("message", "sensors/room", new Uint8Array([50]), packet);

    expect(messages).toEqual([
      {
        topic: "sensors/room",
        payload: new Uint8Array([49]),
        packet,
        segment: 1,
      },
    ]);
  });

  it("labels messages from different transports as separate segments", async () => {
    const client = new FakeClient();
    const messages: { segment: number }[] = [];
    mocks.connect.mockReturnValueOnce(client as never);
    const opening = MqttSession.connect("ws://broker.example/mqtt", ["#"], {
      status: vi.fn(),
      message: (message) => messages.push(message),
    });
    client.emit("connect");
    const session = await opening;
    const packet = { cmd: "publish", qos: 0, retain: false };

    client.emit("message", "sensors/room", new Uint8Array([49]), packet);
    client.emit("offline");
    client.emit("reconnect");
    client.emit("connect");
    await vi.waitFor(() =>
      expect(client.subscribeAsync).toHaveBeenCalledTimes(2),
    );
    client.emit("message", "sensors/room", new Uint8Array([50]), packet);

    expect(messages.map(({ segment }) => segment)).toEqual([1, 3]);
    session.close();
  });

  it("resubscribes after reconnect and reports ready only after SUBACK", async () => {
    const client = new FakeClient();
    const statuses: SessionStatus[] = [];
    const session = await establish(client, statuses);
    const next = deferred();
    client.subscribeAsync.mockImplementationOnce(() => next.promise);

    client.emit("offline");
    client.emit("close");
    client.emit("reconnect");
    client.emit("connect");
    await Promise.resolve();

    expect(statuses.slice(-2)).toEqual([
      { state: "offline" },
      { state: "reconnecting" },
    ]);
    expect(client.subscribeAsync).toHaveBeenCalledTimes(2);
    next.resolve([
      { topic: "sensors/#", qos: 0 },
      { topic: "alerts/+", qos: 0 },
    ]);
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected", rejected: [] }),
    );

    session.close();
  });

  it("closes an established session when resubscribing fails", async () => {
    const client = new FakeClient();
    const statuses: SessionStatus[] = [];
    await establish(client, statuses);
    client.subscribeAsync.mockRejectedValueOnce(new Error("subscribe failed"));

    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({
        state: "error",
        error: "subscribe failed",
      }),
    );
    expect(client.end).toHaveBeenCalledWith(true);

    client.emit("close");
    client.emit("connect");
    expect(client.subscribeAsync).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toEqual({
      state: "error",
      error: "subscribe failed",
    });
  });

  it("reports filters rejected by SUBACK", async () => {
    const client = new FakeClient();
    client.subscribeAsync.mockResolvedValueOnce([
      { topic: "sensors/#", qos: 0 },
      { topic: "alerts/+", qos: 128 },
    ]);
    const statuses: SessionStatus[] = [];

    const session = await establish(client, statuses);

    expect(statuses).toEqual([{ state: "connected", rejected: ["alerts/+"] }]);
    session.close();
  });

  it("ignores a stale SUBACK from an interrupted reconnect", async () => {
    const client = new FakeClient();
    const statuses: SessionStatus[] = [];
    const session = await establish(client, statuses);
    const stale = deferred();
    client.subscribeAsync
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([
        { topic: "sensors/#", qos: 0 },
        { topic: "alerts/+", qos: 0 },
      ]);

    client.emit("connect");
    await Promise.resolve();
    client.emit("close");
    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected", rejected: [] }),
    );
    const connectedCount = statuses.filter(
      ({ state }) => state === "connected",
    ).length;

    stale.resolve([
      { topic: "sensors/#", qos: 0 },
      { topic: "alerts/+", qos: 0 },
    ]);
    await Promise.resolve();
    expect(statuses.filter(({ state }) => state === "connected")).toHaveLength(
      connectedCount,
    );

    session.close();
  });

  it("reports established MQTT errors", async () => {
    const client = new FakeClient();
    const statuses: SessionStatus[] = [];
    const session = await establish(client, statuses);
    statuses.length = 0;

    client.emit("error", new Error("socket failed"));

    expect(statuses).toEqual([{ state: "error", error: "socket failed" }]);
    session.close();
  });
});
