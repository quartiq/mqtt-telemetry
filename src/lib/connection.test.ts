import { afterEach, describe, expect, it, vi } from "vitest";
import { MqttSession, type SessionCallbacks } from "./mqtt-session";
import { Connection } from "./connection.svelte";
import { rememberAuth } from "./session-auth";

vi.mock("./mqtt-session", () => ({ MqttSession: { connect: vi.fn() } }));
vi.mock("./session-auth", () => ({ rememberAuth: vi.fn(() => true) }));

afterEach(() => vi.clearAllMocks());

function fixture() {
  const callbacks = {
    message: vi.fn(),
    starting: vi.fn(),
    subscribed: vi.fn(),
    ready: vi.fn(),
    failed: vi.fn(),
  };
  const connection = new Connection(callbacks);
  const session = { close: vi.fn(), setFilters: vi.fn(), resubscribe: vi.fn() };
  vi.mocked(MqttSession.connect).mockImplementation(
    async (_broker, _filters, handlers) => {
      handlers.status({ state: "connected", rejected: [] });
      return session as unknown as MqttSession;
    },
  );
  return { connection, callbacks, session };
}

const first = { broker: "ws://one/mqtt", filters: ["a/#"] };
const auth = { username: "alice", password: "secret" };

describe("applied connection", () => {
  it("keeps previously stored credentials when initial connection fails", async () => {
    const { connection } = fixture();
    vi.mocked(MqttSession.connect).mockRejectedValueOnce(
      new Error("Unavailable"),
    );
    await connection.apply(first, { auth });
    expect(connection.state).toBe("failed");
    expect(rememberAuth).not.toHaveBeenCalled();
  });
  it("updates subscriptions in place but replaces the transport for credentials or broker changes", async () => {
    const { connection, session } = fixture();
    await connection.apply(first, { auth });
    await connection.apply({ ...first, filters: ["b/#"] });
    expect(session.setFilters).toHaveBeenCalledWith(["b/#"]);
    expect(MqttSession.connect).toHaveBeenCalledTimes(1);
    await connection.apply(first, { auth: { ...auth, password: "changed" } });
    expect(MqttSession.connect).toHaveBeenCalledTimes(2);
    await connection.apply({ ...first, broker: "ws://two/mqtt" });
    expect(connection.auth).toEqual({ username: "", password: "" });
    expect(MqttSession.connect).toHaveBeenLastCalledWith(
      "ws://two/mqtt",
      first.filters,
      expect.anything(),
      expect.objectContaining({ auth: { username: "", password: "" } }),
    );
  });

  it("waits for credentials when revisiting a protected broker", async () => {
    const { connection } = fixture();
    await connection.apply(first, { credentialsRequired: true });
    expect(connection.needsCredentials).toBe(true);
    expect(MqttSession.connect).not.toHaveBeenCalled();
    await connection.apply({ ...first, filters: ["b/#"] });
    await connection.reconnect();
    expect(connection.needsCredentials).toBe(true);
    expect(MqttSession.connect).not.toHaveBeenCalled();
    await connection.apply(first, { auth });
    expect(connection.needsCredentials).toBe(false);
    expect(connection.state).toBe("connected");
  });

  it("ignores late callbacks and completion from a superseded connection", async () => {
    const { connection, callbacks, session } = fixture();
    let handlers!: SessionCallbacks;
    let signal!: AbortSignal;
    let finish!: (session: MqttSession) => void;
    vi.mocked(MqttSession.connect).mockImplementationOnce(
      (_broker, _filters, cb, options) => {
        handlers = cb;
        signal = options!.signal!;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const opening = connection.apply(first, { auth });
    await connection.apply({ ...first, broker: "ws://two/mqtt" });
    expect(signal.aborted).toBe(true);
    handlers.status({ state: "failed", error: "obsolete" });
    const obsolete = { close: vi.fn() };
    finish(obsolete as unknown as MqttSession);
    await opening;
    expect(obsolete.close).toHaveBeenCalledOnce();
    expect(connection.session).toBe(session);
    expect(connection.error).toBe("");
    expect(callbacks.ready).toHaveBeenCalledOnce();
  });
});
