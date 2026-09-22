import { expect } from "@playwright/test";
import { test, seedDashboard } from "./fixtures.mjs";

test("subscription edits and Back update the broker without reconnecting", async ({
  page,
  broker,
}) => {
  await seedDashboard(page, broker);
  const transport = broker.client;
  const before = broker.requests.length;
  await page.locator(".connection-disclosure").click();
  await page.locator("[name=subscriptions]").fill("bad/#/path");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".header-error")).toContainText("line 1");
  expect(broker.requests.length).toBe(before);
  await page.locator("[name=subscriptions]").fill("#\nalerts/+\nextra/#");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() => broker.requests.at(-1))
    .toEqual({ cmd: "subscribe", filters: ["extra/#"] });
  await page.goBack();
  await expect
    .poll(() => broker.requests.at(-1))
    .toEqual({ cmd: "unsubscribe", filters: ["extra/#"] });
  expect(broker.client).toBe(transport);
  await expect(page.locator(".plot-panel")).toHaveCount(1);
});

test("reconnect exposes partial rejection and preserves data and plots", async ({
  page,
  broker,
}) => {
  await seedDashboard(page, broker);
  broker.subscriptionReply = "hold";
  broker.client.terminate();
  await expect(page.locator(".connection-state")).toContainText(
    "Restoring subscriptions",
  );
  await expect(page.locator(".connection-notice")).toContainText("interrupted");
  broker.subscriptionReply = "reject";
  broker.acknowledge();
  await expect(page.locator(".header-error")).toContainText("alerts/+");
  await expect(page.locator(".connection-state")).toContainText("Connected");
  await expect(page.locator(".connection-notice")).not.toContainText(
    "Subscriptions restored",
  );
  await expect(page.locator(".plot-panel")).toHaveCount(1);
  await expect(
    page.locator('.message-tree [data-tree-id="$.field0"]'),
  ).toBeVisible();
});
