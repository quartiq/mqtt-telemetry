import { afterEach, expect, it, vi } from "vitest";
import { rememberAuth, restoreAuth } from "./session-auth";

afterEach(() => vi.unstubAllGlobals());

it("restores only the active broker and forgets credentials on switch or disconnect", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  const auth = { username: "user", password: "secret" };
  expect(rememberAuth("wss://one/mqtt", auth)).toBe(true);
  expect(restoreAuth("wss://one/mqtt")).toEqual(auth);
  expect(restoreAuth("wss://two/mqtt")).toBeUndefined();
  expect(restoreAuth("wss://one/mqtt")).toBeUndefined();
  rememberAuth("wss://one/mqtt", auth);
  rememberAuth();
  expect(restoreAuth("wss://one/mqtt")).toBeUndefined();
});

it("leaves connection use possible when storage is unavailable", () => {
  const denied = () => {
    throw new DOMException("Storage denied", "SecurityError");
  };
  vi.stubGlobal("sessionStorage", {
    getItem: denied,
    setItem: denied,
    removeItem: denied,
  });
  expect(restoreAuth("wss://one")).toBeUndefined();
  expect(
    rememberAuth("wss://one", { username: "user", password: "secret" }),
  ).toBe(false);
});
