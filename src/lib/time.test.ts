import { afterEach, expect, it, vi } from "vitest";
import { createTelemetryClock } from "./time";

afterEach(() => vi.restoreAllMocks());

it("includes suspended wall time and continues advancing after resume", () => {
  const wall = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  vi.spyOn(performance, "now").mockReturnValue(100);
  const now = createTelemetryClock();
  expect(now()).toBe(1_000_000);
  wall.mockReturnValue(1_000_000 + 8 * 60 * 60 * 1000);
  const resumed = now();
  expect(resumed).toBe(Date.now());
  wall.mockReturnValue(resumed + 1000);
  expect(now()).toBe(resumed + 1000);
});

it("clamps backwards corrections and recovers when wall time catches up", () => {
  const wall = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const elapsed = vi.spyOn(performance, "now").mockReturnValue(100);
  const now = createTelemetryClock();
  const before = now();
  wall.mockReturnValue(900_000);
  elapsed.mockReturnValue(200);
  expect(now()).toBe(before);
  wall.mockReturnValue(before);
  elapsed.mockReturnValue(100_100);
  expect(now()).toBe(before);
  wall.mockReturnValue(before + 1000);
  elapsed.mockReturnValue(101_100);
  expect(now()).toBe(before + 1000);
});
