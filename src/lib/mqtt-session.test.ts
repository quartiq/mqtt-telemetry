import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("mqtt", () => ({ default: { connect: mocks.connect } }));

import { MqttSession, clientOptions, type SessionStatus } from "./mqtt-session";

class FakeClient {
  options = clientOptions();
  reconnecting = false;
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  subscribeAsync = vi.fn().mockResolvedValue([]);
  end = vi.fn();
  reconnect = vi.fn();

  on(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      callback as (...args: unknown[]) => void,
    ]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

describe("MQTT session", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a clean, non-queueing MQTT 3.1.1 browser session", () => {
    const options = clientOptions({ username: "user", password: "secret" });
    expect(options).toMatchObject({
      clean: true,
      connectTimeout: 5000,
      keepalive: 15,
      protocolVersion: 4,
      queueQoSZero: false,
      reconnectPeriod: 1000,
      resubscribe: true,
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

  it("subscribes filters together and reports messages and reconnect state", async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal("removeEventListener", removeEventListener);
    const client = new FakeClient();
    mocks.connect.mockReturnValueOnce(client as never);
    const statuses: SessionStatus[] = [];
    const messages: unknown[] = [];
    const session = MqttSession.connect(
      "ws://broker.example/mqtt",
      ["sensors/#", "alerts/+"],
      {
        status: (status) => statuses.push(status),
        message: (message) => messages.push(message),
      },
    );

    client.emit("offline");
    client.emit("close");
    client.emit("reconnect");
    expect(client.end).not.toHaveBeenCalled();
    expect(statuses).toEqual([
      { state: "offline" },
      { state: "reconnecting" },
      { state: "reconnecting" },
    ]);

    client.emit("connect");
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({ state: "connected" }),
    );
    expect(client.subscribeAsync).toHaveBeenCalledWith(
      ["sensors/#", "alerts/+"],
      { qos: 0 },
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );

    const packet = { cmd: "publish", qos: 0, retain: false };
    client.emit("message", "sensors/room", new Uint8Array([49]), packet);
    client.emit("reconnect");
    client.emit("offline");
    expect(messages).toEqual([
      { topic: "sensors/room", payload: new Uint8Array([49]), packet },
    ]);
    expect(statuses.slice(-2)).toEqual([
      { state: "reconnecting" },
      { state: "offline" },
    ]);

    client.reconnecting = true;
    const online = addEventListener.mock.calls[0][1] as () => void;
    online();
    expect(client.reconnect).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toEqual({ state: "reconnecting" });

    session.close();
    client.emit("close");
    expect(client.end).toHaveBeenCalledWith(true);
    expect(removeEventListener).toHaveBeenCalledWith("online", online);
    expect(statuses.at(-1)).toEqual({ state: "reconnecting" });
  });
});
