import { expect } from "@playwright/test";
import { test, packet } from "./fixtures.mjs";
test("binary previews release transport backing storage @diagnostic", async ({
  page,
  broker,
  cdp,
}) => {
  // Tiny binary previews must not retain the large transport frames they arrived in.
  await cdp.send("HeapProfiler.collectGarbage");
  const backingBefore = (await cdp.send("Runtime.getHeapUsage"))
    .backingStorageSize;
  for (let i = 0; i < 8; i++)
    broker.client.send(
      Buffer.concat([
        packet.generate({
          cmd: "publish",
          topic: "binary-preview",
          qos: 0,
          payload: Buffer.alloc(64, 255),
        }),
        packet.generate({
          cmd: "publish",
          topic: "oversize-preview",
          qos: 0,
          payload: Buffer.alloc(2 * 1024 * 1024, 120),
        }),
      ]),
    );
  broker.publish("preview-sentinel", 1);
  await expect(
    page.getByText("preview-sentinel", { exact: true }),
  ).toBeAttached();
  await cdp.send("HeapProfiler.collectGarbage");
  const backingAfter = (await cdp.send("Runtime.getHeapUsage"))
    .backingStorageSize;
  expect(
    backingAfter - backingBefore,
    "Binary previews retained transport frames",
  ).toBeLessThan(2 * 1024 * 1024);
});
