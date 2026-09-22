import {
  MqttSession,
  type IncomingMessage,
  type SessionAuth,
  type SessionStatus,
} from "./mqtt-session";
import { rememberAuth } from "./session-auth";

export type ConnectionTarget = { broker: string; filters: string[] };

// Owns the applied target, credentials, and the lifetime of asynchronous MQTT work.
// Form drafts and browser history remain outside the transport controller.
export class Connection {
  session = $state.raw<MqttSession>();
  state = $state<"idle" | "connecting" | SessionStatus["state"]>("idle");
  error = $state("");
  notice = $state("");
  auth = $state.raw<SessionAuth>({ username: "", password: "" });
  needsCredentials = $state(false);
  busy = $derived(
    this.state === "connecting" ||
      this.state === "restoring" ||
      this.state === "updating",
  );
  private target: ConnectionTarget = { broker: "", filters: [] };
  private lifetime = new AbortController();
  private interrupted = false;

  constructor(
    private readonly callbacks: {
      message: (message: IncomingMessage) => void;
      starting: () => void;
      subscribed: (accepted: string[]) => void;
      ready: () => void;
      failed: () => void;
    },
  ) {}

  async apply(
    target: ConnectionTarget,
    options: {
      auth?: SessionAuth;
      credentialsRequired?: boolean;
    } = {},
  ): Promise<void> {
    const brokerChanged = target.broker !== this.target.broker;
    const auth =
      options.auth ??
      (brokerChanged ? { username: "", password: "" } : this.auth);
    const authChanged =
      auth.username !== this.auth.username ||
      auth.password !== this.auth.password;
    const filtersChanged =
      JSON.stringify(target.filters) !== JSON.stringify(this.target.filters);
    if (brokerChanged) {
      this.close();
      if (this.target.broker) rememberAuth();
      this.interrupted = false;
    }
    this.target = { broker: target.broker, filters: [...target.filters] };
    this.auth = auth;
    // Only an explicit form submission can release a pending login. Changing
    // subscriptions or loading a dashboard for this broker cannot authorize it.
    this.needsCredentials =
      !options.auth &&
      (brokerChanged
        ? Boolean(options.credentialsRequired)
        : this.needsCredentials);
    if (!target.broker || this.needsCredentials) {
      this.close();
      this.state = "idle";
      this.error = this.notice = "";
      return;
    }
    if (
      brokerChanged ||
      authChanged ||
      !this.session ||
      this.state === "failed"
    ) {
      await this.reconnect();
    } else if (filtersChanged) {
      const session = this.session;
      try {
        await session.setFilters(this.target.filters);
      } catch (error) {
        if (this.session !== session) return;
        this.state = "failed";
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  async reconnect(): Promise<void> {
    if (!this.target.broker || this.needsCredentials) return;
    const interrupted = this.interrupted || Boolean(this.session);
    this.close();
    this.lifetime = new AbortController();
    const { signal } = this.lifetime;
    const { broker, filters } = this.target;
    const auth = this.auth;
    this.state = "connecting";
    this.error = this.notice = "";
    this.interrupted = interrupted;
    this.callbacks.starting();
    try {
      const session = await MqttSession.connect(
        broker,
        filters,
        {
          message: (message) => {
            if (!signal.aborted) this.callbacks.message(message);
          },
          status: (status) => {
            if (!signal.aborted) this.statusChanged(status);
          },
        },
        { auth, signal },
      );
      if (signal.aborted) {
        session.close();
        return;
      }
      this.session = session;
      if (!rememberAuth(broker, auth) && (auth.username || auth.password))
        this.notice =
          "Credentials will not survive reload: browser storage unavailable.";
      this.callbacks.ready();
    } catch (error) {
      if (signal.aborted) return;
      this.state = "failed";
      this.error = error instanceof Error ? error.message : String(error);
      this.callbacks.failed();
    }
  }

  async refresh(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await session.resubscribe();
    } catch (error) {
      if (this.session !== session) return;
      this.state = "failed";
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  close(): void {
    this.lifetime.abort();
    this.session?.close();
    this.session = undefined;
  }

  private statusChanged(next: SessionStatus): void {
    this.state = next.state;
    switch (next.state) {
      case "connected":
        this.callbacks.subscribed(
          this.target.filters.filter(
            (filter) => !next.rejected.includes(filter),
          ),
        );
        this.error = next.rejected.length
          ? `Subscription rejected: ${next.rejected.join(", ")}`
          : "";
        this.notice = this.interrupted
          ? `${next.rejected.length ? "Reconnected" : "Subscriptions restored"} · messages during the interruption may be missing.`
          : "";
        this.interrupted = false;
        break;
      case "offline":
        this.interrupted = true;
        this.notice =
          "Connection interrupted · messages may be missed while reconnecting.";
        break;
      case "failed":
        this.notice = "";
        this.error = next.error;
        break;
      case "error":
        this.error = next.error;
        break;
    }
  }
}
