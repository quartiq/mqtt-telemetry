import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Use MQTT.js's own transport and packet dependencies for the local fixture.
const requireMqtt = createRequire(import.meta.resolve("mqtt"));
const { WebSocketServer } = requireMqtt("ws");
const packet = requireMqtt("mqtt-packet");
const html = readFileSync("dist/index.html");
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(html);
});
const broker = new WebSocketServer({ server });
let client;
let subscriptions = 0;
broker.on("connection", (socket) => {
  const parser = packet.parser();
  socket.on("error", () => {});
  socket.on("message", (bytes) => parser.parse(bytes));
  parser.on("packet", (message) => {
    if (message.cmd === "connect") {
      socket.send(packet.generate({ cmd: "connack", returnCode: 0 }));
    } else if (message.cmd === "subscribe") {
      subscriptions += 1;
      socket.send(
        packet.generate({
          cmd: "suback",
          messageId: message.messageId,
          granted: message.subscriptions.map(() => 0),
        }),
      );
      client = socket;
    } else if (message.cmd === "pingreq") {
      socket.send(packet.generate({ cmd: "pingresp" }));
    }
  });
});
function publish(topic, value) {
  client.send(
    packet.generate({
      cmd: "publish",
      topic,
      payload: JSON.stringify(value),
      qos: 0,
      retain: false,
    }),
  );
}

mkdirSync(".codex", { recursive: true });
const profile = mkdtempSync(resolve(".codex/browser-check-"));
let chrome;
const pending = new Map();
const errors = [];
let sequence = 0;
let sessionId;
function command(method, params = {}, session = sessionId) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser command timed out: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId: session }) + "\0",
    );
  });
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
}
async function viewport(width, height) {
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function dimensions() {
  return evaluate(`(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width,
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
    };
    return { topics: rect('.topics'), value: rect('.message-panel'),
      history: rect('.history-panel'),
      overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
}

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  for (const executable of [
    process.env.CHROME_BIN,
    "google-chrome",
    "chromium",
  ].filter(Boolean)) {
    chrome = spawn(
      executable,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-debugging-pipe",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    try {
      await once(chrome, "spawn");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      chrome = undefined;
    }
  }
  assert(
    chrome,
    "Set CHROME_BIN to an installed Chrome or Chromium executable.",
  );
  let stderr = "";
  chrome.stderr.on("data", (data) => {
    stderr += data;
  });
  chrome.on("exit", () => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(`Browser exited: ${stderr}`));
    }
    pending.clear();
  });
  let buffer = "";
  chrome.stdio[4].on("data", (data) => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error)
          request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        errors.push(message.params.exceptionDetails);
      } else if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error"
      ) {
        errors.push(message.params.args);
      }
    }
  });
  const { targetId } = await command("Target.createTarget", {
    url: "about:blank",
  });
  ({ sessionId } = await command("Target.attachToTarget", {
    targetId,
    flatten: true,
  }));
  await command("Runtime.enable");
  await command("Page.enable");

  for (const base of [
    `http://127.0.0.1:${port}/`,
    pathToFileURL(resolve("dist/index.html")).href,
  ]) {
    await viewport(390, 844);
    await command("Page.navigate", { url: base });
    await until("document.querySelector('input[name=broker]')");
    assert(
      await evaluate("document.body.innerText.includes('Connect to MQTT')"),
    );
    assert(
      await evaluate(
        "/(?:local build|build [a-f0-9]{8})/.test(document.body.innerText)",
      ),
    );
    const empty = await dimensions();
    assert(
      empty.value.height < 150,
      `Empty Value reserves space: ${JSON.stringify(empty)}`,
    );
    await click(".history-disclosure");
    assert(
      (await dimensions()).history.height < 180,
      "Empty History reserves space",
    );

    const url = new URL(base);
    url.searchParams.set("broker", `ws://127.0.0.1:${port}`);
    url.searchParams.set("sub", "#");
    await command("Page.navigate", { url: url.href });
    await until(
      "document.querySelector('.connection-state')?.innerText.includes('Connected')",
    );
    publish("sample", 1);
    await until(
      "document.querySelector('[aria-label=\"MQTT topics\"] [role=treeitem]')",
    );
    await click('[aria-label="MQTT topics"] [role="treeitem"]');
    await until("document.querySelector('[aria-label=\"JSON fields\"]')");
    await click(".history-disclosure");
    const sparse = await dimensions();
    assert(
      sparse.value.height < 150,
      `Scalar Value reserves space: ${JSON.stringify(sparse)}`,
    );
    assert(
      sparse.history.height < 200,
      `Short History reserves space: ${JSON.stringify(sparse)}`,
    );

    for (let index = 0; index < 45; index++) {
      publish(`topic-${index}`, index);
      publish(
        "sample",
        Object.fromEntries(
          Array.from({ length: 40 }, (_, field) => [
            `field${field}`,
            index + field,
          ]),
        ),
      );
    }
    await until(
      "document.querySelectorAll('[aria-label=\"MQTT topics\"] [role=treeitem]').length >= 46",
    );
    await until(
      "document.querySelectorAll('[aria-label=\"JSON fields\"] [role=treeitem]').length >= 41",
    );
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [760, 360],
      [800, 600],
    ]) {
      await viewport(width, height);
      const full = await dimensions();
      assert(
        !full.overflow,
        `Page overflows at ${width}: ${JSON.stringify(full)}`,
      );
      for (const [name, pane] of Object.entries(full)) {
        if (name !== "overflow")
          assert(
            pane.height <= height * 0.45 + 1,
            `${name} exceeds cap at ${width}: ${JSON.stringify(full)}`,
          );
      }
      assert(
        await evaluate(
          "['.topic-tree', '.message-tree', '.table-scroll'].every(selector => { const e = document.querySelector(selector); return e.scrollHeight > e.clientHeight && e.clientHeight > 0; })",
        ),
        "Populated panes must scroll internally",
      );
    }
    await viewport(801, 600);
    assert(!(await dimensions()).overflow, "Narrow desktop overflows");
    assert(
      await evaluate(
        "getComputedStyle(document.querySelector('.message-panel .panel-controls')).gridRowStart === '2'",
      ),
      "Value header does not adapt to narrow sidebar",
    );
    await viewport(390, 844);
    await click(".connection-disclosure");
    assert(
      !(await dimensions()).overflow,
      "Connection editor overflows mobile viewport",
    );
    console.log(`Checked empty and populated panes: ${base}`);
  }
  assert(
    subscriptions >= 2,
    "Both origins must connect to the local MQTT fixture",
  );
  assert.deepEqual(errors, [], "Browser console errors");
} finally {
  for (const socket of broker.clients) socket.terminate();
  broker.close();
  server.close();
  if (chrome && chrome.exitCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
  }
  rmSync(profile, { recursive: true, force: true });
}
