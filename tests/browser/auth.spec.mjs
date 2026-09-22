import { expect } from "@playwright/test";
import { test, authenticate } from "./fixtures.mjs";

test("eventless autofill is submitted and restored on reload, outside the URL", async ({
  page,
  broker,
}) => {
  await page.locator(".connection-disclosure").click();
  await page.evaluate(() => {
    document.querySelector("[name=username]").value = "alice";
    document.querySelector("[name=password]").value = "secret";
  });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() => broker.connections.at(-1))
    .toEqual({ username: "alice", password: "secret" });
  const before = broker.connections.length;
  await page.reload();
  await expect.poll(() => broker.connections.length).toBe(before + 1);
  expect(broker.connections.at(-1)).toEqual({
    username: "alice",
    password: "secret",
  });
  expect(
    await page.evaluate(() => location.href + JSON.stringify(history.state)),
  ).not.toContain("secret");
});

test("pending credentials survive display edits, reload, and dashboard loading", async ({
  page,
  broker,
}) => {
  await authenticate(page);
  const before = broker.connections.length;
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.locator(".connection-editor")).toBeVisible();
  expect(broker.connections.length).toBe(before);
  // Display edits and dashboard loading must preserve the pending login.
  await page.getByLabel("Messages kept per topic").fill("2");
  await page.getByLabel("Messages kept per topic").press("Tab");
  await page.reload();
  await expect(page.locator(".connection-editor")).toBeVisible();
  expect(broker.connections.length).toBe(before);
  const dashboard = await page.evaluate(() => history.state.dashboard);
  await page.locator("input[type=file]").setInputFiles({
    name: "dashboard.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dashboard)),
  });
  await expect(page.locator(".connection-editor")).toBeVisible();
  await expect(
    page.getByText("Loaded dashboard.json", { exact: true }),
  ).toBeVisible();
  expect(broker.connections.length).toBe(before);
});

test("broker edits clear credentials; cancel preserves the applied login", async ({
  page,
  broker,
}) => {
  await authenticate(page);
  await page.locator(".connection-disclosure").click();
  const section = await page
    .locator("[name=password]")
    .getAttribute("autocomplete");
  await page
    .locator("[name=broker]")
    .fill(`ws://127.0.0.1:${broker.port}/other`);
  await expect(page.locator("[name=username]")).toHaveValue("");
  await expect(page.locator("[name=password]")).toHaveValue("");
  expect(
    await page.locator("[name=password]").getAttribute("autocomplete"),
  ).not.toBe(section);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".connection-disclosure").click();
  await expect(page.locator("[name=password]")).toHaveValue("reload-secret");
  // A DOM-only URI edit must not bypass clearing at submission.
  await page.evaluate(() => {
    document.querySelector("[name=broker]").value += "/silent";
  });
  const before = broker.connections.length;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".header-error")).toContainText("Broker changed");
  expect(broker.connections.length).toBe(before);
  await expect(page.locator("[name=password]")).toHaveValue("");
  // Normal Apply is enough to connect anonymously to the new URI.
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => broker.connections.length).toBe(before + 1);
  expect(broker.connections.at(-1)).toEqual({ username: "", password: "" });
  await page.goBack();
  await expect(page.locator(".connection-editor")).toBeVisible();
  expect(broker.connections.length).toBe(before + 1);
});

test("recovery uses applied credentials, not an unsubmitted draft", async ({
  page,
  broker,
}) => {
  await authenticate(page);
  await page.locator(".connection-disclosure").click();
  await page.locator("[name=username]").fill("unsubmitted");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const before = broker.connections.length;
  broker.client.terminate();
  await expect.poll(() => broker.connections.length).toBe(before + 1);
  expect(broker.connections.at(-1)).toEqual({
    username: "another-user",
    password: "reload-secret",
  });
});
