import { expect } from "@playwright/test";
import { test, seedDashboard, dimensions } from "./fixtures.mjs";

for (const hasTouch of [false, true]) {
  test.describe(hasTouch ? "touch controls" : "mouse controls", () => {
    test.use({ hasTouch });
    test("tree controls stay centered and marks survive forced colors", async ({
      page,
      broker,
    }) => {
      broker.publish("sample", 1);
      broker.publish("sample/child", 2);
      const row = page.getByText("sample", { exact: true }).locator("..");
      await expect(row.locator(".caret")).toBeVisible();
      for (const filter of ["", "sample"]) {
        await page.getByLabel("Search topic paths").fill(filter);
        const centers = await row.evaluate((node) =>
          [".caret-mark", ".activity-dot", ".pin-mark"].map((selector) => {
            const rect = node.querySelector(selector).getBoundingClientRect();
            return rect.y + rect.height / 2;
          }),
        );
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(
          0.5,
        );
      }
      await page.emulateMedia({ forcedColors: "active" });
      await page.addStyleTag({
        content: ".activity-dot { opacity: 1 !important; }",
      });
      for (const selector of [".caret-mark", ".activity-dot"]) {
        const mark = row.locator(selector);
        const clip = await mark.boundingBox();
        const painted = await page.screenshot({ clip });
        await mark.evaluate((node) => (node.style.visibility = "hidden"));
        expect(await page.screenshot({ clip })).not.toEqual(painted);
      }
    });
  });
}

test("long field values preserve complete labels", async ({ page, broker }) => {
  broker.publish("sample", { field0: "x".repeat(1000) });
  await page.getByText("sample", { exact: true }).click();
  const row = page.locator('.message-tree [data-tree-id="$.field0"]');
  await expect(row.locator(".label")).toHaveText("field0");
  await expect(row.locator(".activity-slot")).toHaveCount(0);
  for (const width of [320, 1200]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await row
        .locator(".label")
        .evaluate((node) => node.clientWidth === node.scrollWidth),
    ).toBe(true);
    expect(
      await row
        .locator(".value")
        .evaluate((node) => node.clientWidth < node.scrollWidth),
    ).toBe(true);
  }
});

test("receipt times, plot windows, and expiration catch up after suspend", async ({
  page,
  broker,
}) => {
  await page.getByLabel("Displayed time zone").selectOption("utc");
  await page.getByLabel("Plot time window").selectOption("60000");
  await page.getByLabel("Age limit for older history").selectOption("60000");
  await seedDashboard(page, broker);
  broker.publish("sample", { field0: 1 });
  await page.locator(".history-disclosure").click();
  await expect(page.locator(".history-panel .message-row")).toHaveCount(2);

  // Model a sleeping elapsed-time clock: only wall time advances eight hours.
  const resumedTime = await page.evaluate(() => {
    const resumed =
      Math.ceil((Date.now() + 8 * 60 * 60 * 1000) / 60_000) * 60_000;
    Date.now = () => resumed;
    return new Date(resumed).toISOString().slice(11, 19);
  });
  broker.publish("sample", { field0: 2 });
  await expect(page.locator(".history-panel .message-row")).toHaveCount(1);
  await expect(
    page.locator(".history-panel .message-row td").first(),
  ).toContainText(resumedTime);
  await expect(page.locator(".plot-panel svg circle")).toHaveCount(1);
  await expect(page.locator(".plot-panel .x-label").last()).toContainText(
    resumedTime,
  );
});

test("quiet history adds the date after midnight without plots or expiration", async ({
  page,
  broker,
}) => {
  await page.getByLabel("Displayed time zone").selectOption("utc");
  const before = await page.evaluate(() => {
    const time = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_399_000;
    Date.now = () => time;
    return time;
  });
  await seedDashboard(page, broker, 0);
  await page.locator(".history-disclosure").click();
  const timestamp = page.locator(".history-panel .message-row td").first();
  const date = new Date(before).toISOString().slice(0, 10);
  await expect(timestamp).toContainText("23:59:59");
  await expect(timestamp).not.toContainText(date);
  await page.evaluate((time) => {
    Date.now = () => time;
  }, before + 2000);
  await expect(timestamp).toContainText(date);
});

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
  await page
    .locator('.message-tree [data-tree-id="$.field1"] .plot-toggle')
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".plot-panel")).toHaveCount(8);
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
