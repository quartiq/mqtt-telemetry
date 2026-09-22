import { expect } from "@playwright/test";
import { test, seedDashboard, authenticate } from "./fixtures.mjs";

test("admission and storage limits leave reset usable without disconnecting", async ({
  page,
  broker,
}) => {
  broker.publish(Array(10001).fill("a").join("/"), 1);
  await expect(page.locator(".topic-warning")).toContainText("Topics omitted");
  await page
    .locator(
      'button[title="Clear collected messages and topics; keep subscriptions and plots"]',
    )
    .click();
  await expect(page.locator(".topic-warning")).toHaveCount(0);
  await seedDashboard(page, broker);
  const transport = broker.client;
  for (let i = 0; i < 19; i++)
    broker.publish(`load/${i}`, { value: "x".repeat(900000) });
  await expect(page.locator(".app-header")).toContainText("Collection stopped");
  await page
    .locator(
      'button[title="Clear collected messages and topics; keep subscriptions and plots"]',
    )
    .click();
  await expect(page.locator(".topic-tree [role=treeitem]")).toHaveCount(0);
  await expect(page.locator(".plot-panel")).toHaveCount(1);
  expect(broker.client).toBe(transport);
});

test("empty subscriptions survive reload without anonymous fallback", async ({
  page,
  broker,
}) => {
  await authenticate(page);
  await page.locator(".connection-disclosure").click();
  await page.locator("[name=subscriptions]").fill("");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".subscription-label")).toHaveText(
    "No subscriptions",
  );
  const requests = broker.requests.length;
  const connections = broker.connections.length;
  await page.reload();
  await expect.poll(() => broker.connections.length).toBe(connections + 1);
  await expect(page.locator(".connection-state")).toContainText("Connected");
  expect(broker.requests.length).toBe(requests);
  expect(broker.connections.at(-1)).toEqual({
    username: "another-user",
    password: "reload-secret",
  });
});
