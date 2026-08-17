import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("mqtt", () => ({ default: { connect: mocks.connect } }));

import { MqttSession, clientOptions, type SessionStatus } from "./mqtt-session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

class FakeClient {
  connected = false;
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  subscribeAsync = vi.fn().mockResolvedValue([]);
  end = vi.fn();

  on(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      callback as (...args: unknown[]) => void,
    ]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    if (event === "connect") this.connected = true;
    if (event === "offline" || event === "close") this.connected = false;
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

function open(client: FakeClient, statuses: SessionStatus[] = []) {
  mocks.connect.mockReturnValueOnce(client as never);
  return MqttSession.open(
    "ws://broker.example/mqtt",
    ["sensors/#", "alerts/+"],
    {
      status: (status) => statuses.push(status),
      message: vi.fn(),
    },
  );
}

describe("MQTT session", () => {
  beforeEach(() => mocks.connect.mockReset());

  it("uses a clean, reconnecting MQTT 3.1.1 browser session", () => {
    const options = clientOptions({ username: "user", password: "secret" });
    expect(options).toMatchObject({
      clean: true,
      connectTimeout: 5000,
      keepalive: 15,
      protocolVersion: 4,
      queueQoSZero: false,
      reconnectPeriod: 1000,
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

  it("subscribes after every connect and reports ready only after SUBACK", async () => {
    const client = new FakeClient();
    const first = deferred();
    const second = deferred();
    client.subscribeAsync
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const statuses: SessionStatus[] = [];
    const session = open(client, statuses);

    client.emit("connect");
    await Promise.resolve();
    expect(statuses).toEqual([]);
    first.resolve();
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected" }),
    );

    client.emit("offline");
    client.emit("reconnect");
    client.emit("connect");
    await Promise.resolve();
    expect(client.subscribeAsync).toHaveBeenCalledTimes(2);
    expect(client.subscribeAsync).toHaveBeenNthCalledWith(
      2,
      ["sensors/#", "alerts/+"],
      { qos: 0 },
    );
    expect(statuses.at(-1)).toEqual({ state: "reconnecting" });
    second.resolve();
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected" }),
    );

    session.close();
    client.emit("close");
    expect(client.end).toHaveBeenCalledWith(true);
    expect(statuses.at(-1)).toEqual({ state: "connected" });
  });

  it("forwards published messages", () => {
    const client = new FakeClient();
    const messages: unknown[] = [];
    mocks.connect.mockReturnValueOnce(client as never);
    MqttSession.open("ws://broker.example/mqtt", ["#"], {
      status: vi.fn(),
      message: (message) => messages.push(message),
    });
    const packet = { cmd: "publish", qos: 0, retain: false };

    client.emit("message", "sensors/room", new Uint8Array([49]), packet);

    expect(messages).toEqual([
      { topic: "sensors/room", payload: new Uint8Array([49]), packet },
    ]);
  });

  it("reports live subscription failures and retries on the next connect", async () => {
    const client = new FakeClient();
    client.subscribeAsync
      .mockRejectedValueOnce(new Error("subscribe failed"))
      .mockResolvedValueOnce([]);
    const statuses: SessionStatus[] = [];
    open(client, statuses);

    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({
        state: "error",
        error: "subscribe failed",
      }),
    );

    client.emit("close");
    client.emit("reconnect");
    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected" }),
    );
    expect(client.subscribeAsync).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale SUBACK from an interrupted connection", async () => {
    const client = new FakeClient();
    const stale = deferred();
    client.subscribeAsync
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([]);
    const statuses: SessionStatus[] = [];
    open(client, statuses);

    client.emit("connect");
    await Promise.resolve();
    client.emit("close");
    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected" }),
    );
    const connectedCount = statuses.filter(
      ({ state }) => state === "connected",
    ).length;

    stale.resolve();
    await Promise.resolve();
    expect(statuses.filter(({ state }) => state === "connected")).toHaveLength(
      connectedCount,
    );
  });

  it("keeps retrying after an initial transport failure", () => {
    const client = new FakeClient();
    const statuses: SessionStatus[] = [];
    const session = open(client, statuses);

    client.emit("offline");
    client.emit("close");
    client.emit("reconnect");
    expect(client.end).not.toHaveBeenCalled();
    expect(statuses).toEqual([{ state: "offline" }, { state: "reconnecting" }]);

    session.close();
  });
});
