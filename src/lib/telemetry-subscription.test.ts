import { afterEach, expect, it, vi } from "vitest";
import { TelemetryStore, type TopicSnapshot } from "./telemetry";

afterEach(() => vi.useRealTimers());

it("batches arrivals while preserving every message and previous snapshots", () => {
  vi.useFakeTimers();
  const store = new TelemetryStore(10);
  const snapshots: TopicSnapshot[] = [];
  const unsubscribe = store.subscribe((value) =>
    snapshots.push(value.snapshot()),
  );
  for (let i = 0; i < 3; i++)
    store.add("a", new TextEncoder().encode(String(i)), {
      receivedAt: i,
      retained: false,
    });
  expect(store.history(store.nodeId("a")!)).toHaveLength(3);
  expect(snapshots).toHaveLength(1);
  vi.advanceTimersByTime(100);
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0].nodes.size).toBe(0);
  expect(snapshots[1].bufferedMessages).toBe(3);
  const id = store.nodeId("a")!;
  store.clearHistory(id);
  expect(snapshots.at(-1)!.bufferedMessages).toBe(0);
  expect(snapshots[1].nodes.get(id)!.value).toBe("2");
  expect(snapshots.at(-1)!.nodes.get(id)!.value).toBeUndefined();
  unsubscribe();
});

it("publishes explicit edits immediately and releases pending work on unsubscribe", () => {
  vi.useFakeTimers();
  const store = new TelemetryStore(10);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.add("a", new Uint8Array([49]), { receivedAt: 0, retained: false });
  store.clearAllHistory();
  expect(listener).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(100);
  expect(listener).toHaveBeenCalledTimes(2);
  store.add("a", new Uint8Array([50]), { receivedAt: 1, retained: false });
  unsubscribe();
  vi.runAllTimers();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
