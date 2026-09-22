import { expect } from "@playwright/test";
import { test, seedDashboard, dimensions } from "./fixtures.mjs";

test("the standalone artifact renders compact empty panes", async ({
  page,
  baseURL,
}) => {
  await page.goto(baseURL);
  await expect(page.locator("h1")).toContainText("Connect to MQTT");
  await expect(page.locator(".build-id")).toHaveText(
    /local build|build [a-f0-9]{8}/,
  );
  await page.locator(".history-disclosure").click();
  const panes = await dimensions(page);
  expect(panes.value.height).toBeLessThan(150);
  expect(panes.history.height).toBeLessThan(180);
  await page.goto(`${baseURL}?broker=invalid`);
  await expect(page.locator(".header-error")).toContainText("broker URL");
});

test("mobile panes fit; offscreen rows remain accessible and keyboard reachable", async ({
  page,
  broker,
  cdp,
}) => {
  await cdp.send("Accessibility.enable");
  await seedDashboard(page, broker, 0);
  for (let i = 0; i < 60; i++) broker.publish(`topic-${i}`, i);
  await expect(page.getByText("topic-59", { exact: true })).toBeAttached();
  for (const [width, height] of [
    [320, 568],
    [760, 360],
    [801, 600],
  ]) {
    await page.setViewportSize({ width, height });
    const panes = await dimensions(page);
    expect(panes.overflow, `page overflow at ${width}px`).toBe(false);
    if (width <= 800)
      expect(panes.topics.height).toBeLessThanOrEqual(height * 0.45 + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".topic-tree [role=treeitem]").first().focus();
  const extent = await page
    .locator(".topic-tree")
    .evaluate((el) => el.scrollHeight);
  await page.keyboard.press("End");
  const last = page.locator(".topic-tree [role=treeitem]").last();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  expect(
    await page.locator(".topic-tree").evaluate((el) => el.scrollHeight),
  ).toBe(extent);
  // AX queries catch role loss hidden by otherwise correct DOM/layout.
  const count = await page.getByRole("treeitem").count();
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: '.topic-tree [data-tree-id="[\\"topic-0\\"]"]',
  });
  const partial = await cdp.send("Accessibility.getPartialAXTree", {
    nodeId,
    fetchRelatives: false,
  });
  expect(
    partial.nodes.some(
      (node) =>
        !node.ignored &&
        node.role?.value === "treeitem" &&
        node.name?.value.includes("topic-0"),
    ),
  ).toBe(true);
  await expect
    .poll(async () => {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      return nodes.filter((node) => node.role?.value === "treeitem").length;
    })
    .toBe(count);
});

test("touch pinning obeys the plot limit and keyboard removal still works", async ({
  page,
  broker,
}) => {
  await seedDashboard(page, broker, 0);
  for (let i = 0; i < 10; i++)
    await page
      .locator(`.message-tree [data-tree-id="$.field${i}"] .plot-toggle`)
      .tap();
  await expect(page.locator(".plot-panel")).toHaveCount(10);
  await expect(
    page.locator('.message-tree [data-tree-id="$.field10"] .plot-toggle'),
  ).toBeDisabled();
  await page.locator('.message-tree [data-tree-id="$.field0"]').focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".plot-panel")).toHaveCount(9);
  await expect(
    page.locator('.message-tree [data-tree-id="$.field10"] .plot-toggle'),
  ).toBeEnabled();
});

test("plot rendering distinguishes narrow values and breaks missing-field runs", async ({
  page,
  broker,
}) => {
  broker.publish("sample", 1e12);
  await page.locator(".topic-tree .plot-toggle").click();
  broker.publish("sample", 1e12 + 0.001);
  await expect(page.locator(".y-offset")).toContainText("1000000000000 + tick");
  const labels = await page.locator(".y-label").allTextContents();
  expect(new Set(labels).size).toBe(labels.length);
  await expect
    .poll(() =>
      page
        .locator(".y-label")
        .evaluateAll((labels) => labels.every((el) => el.getBBox().x >= 0)),
    )
    .toBe(true);
  await page.getByText("sample", { exact: true }).first().click();
  await page
    .getByRole("button", {
      name: "Clear history for the selected topic",
      exact: true,
    })
    .click();
  broker.publish("sample", 1);
  broker.publish("sample", { missing: true });
  broker.publish("sample", 2);
  await expect(page.locator(".plot-panel svg circle")).toHaveCount(2);
  broker.publish("sample", 500, true);
  await expect(page.locator(".plot-panel")).toContainText(
    "1 retained excluded",
  );
  await expect(page.locator(".plot-panel svg circle")).toHaveCount(2);
});
