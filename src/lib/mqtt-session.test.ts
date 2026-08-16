import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("mqtt", () => ({ default: { connect: mocks.connect } }));

import { MqttSession, clientOptions, type SessionStatus } from "./mqtt-session";

type Listener = { callback: (...args: unknown[]) => void; once: boolean };

class FakeClient {
  options = clientOptions();
  listeners = new Map<string, Listener[]>();
  subscribeAsync = vi.fn().mockResolvedValue([]);
  end = vi.fn();

  on(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { callback: callback as (...args: unknown[]) => void, once: false },
    ]);
    return this;
  }

  once(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(event, [
      ...(this.listeners.get(event) ?? []),
      { callback: callback as (...args: unknown[]) => void, once: true },
    ]);
    return this;
  }

  off(event: string, callback: (...args: never[]) => void): this {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter(
        (listener) => listener.callback !== callback,
      ),
    );
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = [...(this.listeners.get(event) ?? [])];
    this.listeners.set(
      event,
      listeners.filter((listener) => !listener.once),
    );
    listeners.forEach((listener) => listener.callback(...args));
  }
}

describe("MQTT session", () => {
  it("uses a clean, non-queueing MQTT 3.1.1 browser session", () => {
    const options = clientOptions({ username: "user", password: "secret" });
    expect(options).toMatchObject({
      clean: true,
      protocolVersion: 4,
      queueQoSZero: false,
      reconnectPeriod: 0,
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
    const client = new FakeClient();
    mocks.connect.mockReturnValueOnce(client as never);
    const statuses: SessionStatus[] = [];
    const messages: unknown[] = [];
    const pending = MqttSession.connect(
      "ws://broker.example/mqtt",
      ["sensors/#", "alerts/+"],
      {
        status: (status) => statuses.push(status),
        message: (message) => messages.push(message),
      },
    );

    client.emit("connect");
    const session = await pending;
    expect(client.subscribeAsync).toHaveBeenCalledWith(
      ["sensors/#", "alerts/+"],
      { qos: 0 },
    );
    expect(client.options.reconnectPeriod).toBe(1000);
    expect(statuses).toEqual([{ state: "connected" }]);

    const packet = { cmd: "publish", qos: 0, retain: false };
    client.emit("message", "sensors/room", new Uint8Array([49]), packet);
    client.emit("reconnect");
    client.emit("offline");
    expect(messages).toEqual([
      { topic: "sensors/room", payload: new Uint8Array([49]), packet },
    ]);
    expect(statuses.slice(1)).toEqual([
      { state: "reconnecting" },
      { state: "offline" },
    ]);

    session.close();
    client.emit("close");
    expect(client.end).toHaveBeenCalledWith(true);
    expect(statuses.at(-1)).toEqual({ state: "offline" });
  });
});
