import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Keep browser profiles and retained failure traces inside the checkout.
process.env.TMPDIR = resolve(".codex/browser-tmp");
mkdirSync(process.env.TMPDIR, { recursive: true });

export default defineConfig({
  testDir: "tests/browser",
  outputDir: ".codex/test-results",
  fullyParallel: true,
  workers: 8,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    channel: "chromium",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.CHROME_BIN },
  },
  projects: [{ name: "http" }, { name: "file" }],
});
