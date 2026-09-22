import { expect } from "@playwright/test";
import { test, seedDashboard } from "./fixtures.mjs";

test("selection survives pruning and schema changes; Back restores an empty selection", async ({
  page,
  broker,
}) => {
  broker.publish("sample", { value: 1 });
  await page.getByText("sample", { exact: true }).click();
  await page.goBack();
  await expect(page.locator(".message-tree")).toHaveCount(0);
  await page.getByText("sample", { exact: true }).click();
  await page.locator('.message-tree [data-tree-id="$.value"]').click();
  await page.getByLabel("Messages kept per topic").fill("2");
  await page.getByLabel("Messages kept per topic").press("Tab");
  await page.locator(".history-disclosure").click();
  broker.publish("sample", { other: 2 });
  broker.publish("sample", { other: 3 });
  await expect(
    page.locator(".history-panel .message-row td:nth-child(2)"),
  ).toHaveText(["—", "—"]);
  // Focus recovery is a DOM contract, independent of which field stays selected.
  await page.locator('.message-tree [data-tree-id="$.other"]').click();
  broker.publish("sample", { value: 4 });
  await expect(page.locator('.message-tree [data-tree-id="$"]')).toBeFocused();
});

test("dashboard loading and Back share retention and subscription transitions", async ({
  page,
  broker,
}) => {
  await seedDashboard(page, broker);
  broker.publish("sample", { field0: 100 });
  await page.locator(".history-disclosure").click();
  await expect(page.locator(".history-panel .message-row")).toHaveCount(2);
  await page.locator(".history-panel .message-row").last().click();
  const transport = broker.client;
  const dashboard = await page.evaluate(() => history.state.dashboard);
  dashboard.subscriptions = ["#", "extra/#"];
  dashboard.retention.messagesPerTopic = 2;
  dashboard.plots = [{ topic: "sample", path: "$.field0" }];
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not JSON"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Dashboard file is not valid JSON.",
  );
  await expect(page.getByLabel("Messages kept per topic")).toHaveValue("1000");
  await page.locator("input[type=file]").setInputFiles({
    name: "dashboard.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dashboard)),
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Messages kept per topic")).toHaveValue("2");
  await expect
    .poll(() => broker.requests.at(-1))
    .toEqual({ cmd: "unsubscribe", filters: ["alerts/+"] });
  await expect(
    page.locator('.message-tree [data-tree-id="$.field0"] > .value'),
  ).toHaveText("100");
  broker.publish("sample", { field0: 101 });
  await expect(
    page.locator('.message-tree [data-tree-id="$.field0"] > .value'),
  ).toHaveText("101");
  await expect(page.locator(".history-panel .message-row")).toHaveCount(2);
  await page.goBack();
  await expect(page.getByLabel("Messages kept per topic")).toHaveValue("1000");
  await expect
    .poll(() => broker.requests.at(-1))
    .toEqual({ cmd: "unsubscribe", filters: ["extra/#"] });
  expect(broker.client).toBe(transport);
  await expect(page.locator(".plot-panel")).toHaveCount(1);
});
