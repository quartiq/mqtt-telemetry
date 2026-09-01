import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const candidates = [
  process.env.CHROME_BIN,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
].filter(Boolean);
const profileRoot = resolve(".codex");
mkdirSync(profileRoot, { recursive: true });
const profile = mkdtempSync(resolve(profileRoot, "browser-smoke-"));
const page = pathToFileURL(resolve("dist/index.html")).href;

try {
  let result;
  let browser;
  for (const candidate of candidates) {
    const attempt = spawnSync(
      candidate,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-logging=stderr",
        `--user-data-dir=${profile}`,
        "--virtual-time-budget=2000",
        "--dump-dom",
        page,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (attempt.error?.code === "ENOENT") continue;
    result = attempt;
    browser = candidate;
    break;
  }

  if (!result || !browser) {
    throw new Error(
      "No Chrome or Chromium executable found. Set CHROME_BIN to run the browser smoke test.",
    );
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${browser} exited with status ${result.status}.\n${result.stderr}`,
    );
  }
  if (
    !result.stdout.includes("Connect to MQTT") ||
    !result.stdout.includes('name="broker"')
  ) {
    throw new Error(
      "The local-file build did not render the application shell.",
    );
  }
  if (!/(?:local build|build [a-f0-9]{8})/.test(result.stdout)) {
    throw new Error("The local-file build did not expose its build identity.");
  }
  const consoleErrors = result.stderr
    .split(/\r?\n/)
    .filter((line) => /CONSOLE.*(?:Uncaught|Error|DataCloneError)/i.test(line));
  if (consoleErrors.length) {
    throw new Error(`Browser console error:\n${consoleErrors.join("\n")}`);
  }

  console.log(`Rendered ${page} with ${browser}`);
} finally {
  rmSync(profile, { recursive: true, force: true });
}
