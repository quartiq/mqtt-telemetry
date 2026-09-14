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
const requests = [];
const connections = [];
let subscriptionReply = "accept";
let acknowledge;
broker.on("connection", (socket) => {
  const parser = packet.parser();
  socket.on("error", () => {});
  socket.on("message", (bytes) => parser.parse(bytes));
  parser.on("packet", (message) => {
    if (message.cmd === "connect") {
      connections.push(message.username ?? "");
      socket.send(packet.generate({ cmd: "connack", returnCode: 0 }));
    } else if (message.cmd === "subscribe") {
      subscriptions += 1;
      requests.push({
        cmd: "subscribe",
        filters: message.subscriptions.map(({ topic }) => topic),
      });
      acknowledge = () =>
        socket.send(
          packet.generate({
            cmd: "suback",
            messageId: message.messageId,
            granted:
              subscriptionReply === "incomplete"
                ? [0]
                : message.subscriptions.map((_, index) =>
                    subscriptionReply === "reject" && index === 1 ? 128 : 0,
                  ),
          }),
        );
      client = socket;
      if (subscriptionReply !== "hold") acknowledge();
    } else if (message.cmd === "unsubscribe") {
      requests.push({ cmd: "unsubscribe", filters: message.unsubscriptions });
      socket.send(
        packet.generate({ cmd: "unsuback", messageId: message.messageId }),
      );
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
async function tap(selector) {
  const { x, y } = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await command("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await command("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}
async function fill(selector, value) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
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
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });
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
    url.searchParams.append("sub", "alerts/+");
    await command("Page.navigate", { url: url.href });
    await until(
      "document.querySelector('.connection-state')?.innerText.includes('Connected')",
    );
    publish("sample", 1);
    await until(
      "document.querySelector('[aria-label=\"MQTT topics\"] [role=treeitem]')",
    );
    await until("document.querySelector('.topic-tree .plot-toggle')");
    await click(".topic-tree .plot-toggle");
    await until("document.querySelectorAll('.plot-panel').length === 1");
    assert(
      await evaluate("!document.querySelector('[aria-label=\"JSON fields\"]')"),
      "Pinning a topic must not change selection",
    );
    await click('[aria-label="MQTT topics"] [role="treeitem"]');
    await until("document.querySelector('[aria-label=\"JSON fields\"]')");
    assert(
      await evaluate(
        "document.querySelector('.message-tree .plot-toggle').getAttribute('aria-pressed') === 'true'",
      ),
    );
    await click(".message-tree .plot-toggle");
    await until("!document.querySelector('.plot-panel')");
    assert(
      await evaluate(
        "document.querySelector('.topic-tree .plot-toggle').getAttribute('aria-pressed') === 'false'",
      ),
    );
    publish("sample/child", 2);
    await until("document.querySelector('.topic-tree [role=treeitem] .caret')");
    assert(
      await evaluate(
        "document.querySelector('.topic-tree [role=treeitem]').querySelectorAll('button').length === 2",
      ),
      "Numeric parent topics need both expand and pin controls",
    );
    await click(".topic-tree .plot-toggle");
    publish("sample", { value: 3 });
    await until("document.querySelector('.message-tree .caret')");
    assert(
      await evaluate(
        "document.querySelector('.topic-tree .plot-toggle[aria-pressed=true]') !== null",
      ),
      "A changed payload type must still allow unpinning",
    );
    assert(
      await evaluate(
        "document.querySelector('.message-tree .plot-toggle[aria-pressed=true]') !== null",
      ),
      "Value must retain the same unpin control after a type change",
    );
    await click(".topic-tree .plot-toggle[aria-pressed=true]");
    await until(
      "!document.querySelector('.message-tree .plot-toggle[aria-pressed=true]')",
    );
    await click('button[aria-label="Clear history for the selected topic"]');
    publish("sample", 1);
    await until("document.querySelector('.message-tree .plot-toggle')");
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
    await click(".connection-disclosure");
    await command("Emulation.setTouchEmulationEnabled", { enabled: true });
    assert(await evaluate("matchMedia('(pointer: coarse)').matches"));
    const fieldToggle =
      '[aria-label="JSON fields"] .plot-toggle:not([aria-pressed="true"]):not(:disabled)';
    assert(
      await evaluate(`['.message-tree .caret', '.message-tree .plot-toggle'].every(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return rect.width >= 44 && rect.height >= 44;
    })`),
      "Tree touch targets are too small",
    );
    await tap(".message-tree .caret");
    await until("!document.querySelector('.message-tree .plot-toggle')");
    await tap(".message-tree .caret");
    await until("document.querySelector('.message-tree .plot-toggle')");
    for (let count = 1; count <= 10; count++) {
      await tap(fieldToggle);
      await until(
        `document.querySelectorAll('.plot-panel').length === ${count}`,
      );
    }
    assert(
      await evaluate(
        "document.querySelector('.plot-limit').innerText.includes('10/10')",
      ),
    );
    assert(
      await evaluate(
        "document.querySelectorAll('.message-tree .plot-toggle:disabled').length === 30",
      ),
    );
    const firstTitle = await evaluate(
      "document.querySelector('.plot-title').innerText",
    );
    await tap('.plot-panel .plot-action[title="Move plot later"]');
    await until(
      `document.querySelector('.plot-title').innerText !== ${JSON.stringify(firstTitle)}`,
    );
    await tap('.plot-panel .plot-action[title="Remove plot"]');
    await until(
      "document.querySelectorAll('.plot-panel').length === 9 && !document.querySelector('.plot-limit')",
    );
    await tap(fieldToggle);
    await until("document.querySelectorAll('.plot-panel').length === 10");
    assert(
      await evaluate(
        "Array.from(document.querySelectorAll('.plot-action')).every(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })",
      ),
    );
    // Keyboard removal remains available at the limit.
    await evaluate(
      "document.querySelector('.plot-toggle[aria-pressed=true]').closest('[role=treeitem]').focus()",
    );
    await command("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
    });
    await command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
    });
    await until("document.querySelectorAll('.plot-panel').length === 9");
    assert(
      !(await dimensions()).overflow,
      "Touch controls overflow the viewport",
    );
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });
    subscriptionReply = "hold";
    client.terminate();
    await until(
      "document.querySelector('.connection-state').innerText.includes('Restoring subscriptions')",
    );
    assert(
      await evaluate(
        "document.querySelector('.connection-notice').innerText.includes('interrupted')",
      ),
    );
    subscriptionReply = "reject";
    acknowledge();
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    assert(
      await evaluate(
        "document.querySelector('.header-error').innerText.includes('alerts/+')",
      ),
    );
    assert(
      !(await evaluate(
        "document.body.innerText.includes('Subscriptions restored')",
      )),
    );
    assert(
      await evaluate("document.querySelectorAll('.plot-panel').length === 9"),
    );
    await click(".connection-disclosure");
    await fill(".subscriptions textarea", "bad/#/path");
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.header-error')?.innerText.includes('line 1')",
    );
    await click(".connection-editor-actions button:last-child");
    assert(
      await evaluate(
        "document.querySelector('.header-error').innerText.includes('alerts/+')",
      ),
      "Cancel should discard validation errors but retain broker rejections",
    );
    subscriptionReply = "incomplete";
    await click(".connection-disclosure");
    await click(
      '.connection-editor-actions button[title="Request retained values again and retry rejected filters"]',
    );
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connection failed')",
    );
    subscriptionReply = "accept";
    await click(".connection-state button");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    assert(
      await evaluate("document.querySelectorAll('.plot-panel').length === 9"),
    );
    assert(
      await evaluate(
        "document.querySelector('.connection-notice').innerText.includes('Subscriptions restored')",
      ),
    );
    assert(
      await evaluate(
        "document.querySelectorAll('[aria-label=\"MQTT topics\"] [role=treeitem]').length >= 46",
      ),
    );
    publish("sample", { field0: 1000 });
    await until(
      "document.querySelector('.message-tree')?.innerText.includes('1000')",
    );
    const gapsBeforeEdits = await evaluate(
      "document.querySelectorAll('.gap-row').length",
    );
    const established = client;
    const previousRequests = requests.length;
    await click(".connection-disclosure");
    await fill(".subscriptions textarea", "#\n\nbad/#/path");
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.header-error')?.innerText.includes('line 3')",
    );
    assert.equal(
      requests.length,
      previousRequests,
      "Invalid filters reached the broker",
    );
    assert.equal(client, established);
    await fill(".subscriptions textarea", "#\nalerts/+\nextra/#");
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected') && !document.querySelector('.connection-editor')",
    );
    assert.equal(client, established, "Adding a subscription reconnected");
    assert.deepEqual(requests.at(-1), {
      cmd: "subscribe",
      filters: ["extra/#"],
    });
    assert(
      await evaluate("document.querySelectorAll('.plot-panel').length === 9"),
    );
    await click(".connection-disclosure");
    await fill(".subscriptions textarea", "#\nalerts/+");
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected') && !document.querySelector('.connection-editor')",
    );
    assert.equal(client, established, "Removing a subscription reconnected");
    assert.deepEqual(requests.at(-1), {
      cmd: "unsubscribe",
      filters: ["extra/#"],
    });
    publish("sample", { field0: 1001 });
    await until(
      "document.querySelector('.message-tree')?.innerText.includes('1001')",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.gap-row').length"),
      gapsBeforeEdits,
      "Unrelated subscription removal breaks continuous history",
    );
    await evaluate("history.back()");
    await until(
      "document.querySelector('.subscription-label').innerText.includes('extra/#') && document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    assert.deepEqual(requests.at(-1), {
      cmd: "subscribe",
      filters: ["extra/#"],
    });
    assert.equal(client, established, "Back navigation reconnected");
    await click(".connection-disclosure");
    await fill(".subscriptions textarea", "alerts/+\nextra/#");
    await click(".connection-editor button[type=submit]");
    await until(
      "!document.querySelector('.connection-editor') && document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    await click(".connection-disclosure");
    await fill(".subscriptions textarea", "#\nalerts/+\nextra/#");
    await click(".connection-editor button[type=submit]");
    await until(
      "!document.querySelector('.connection-editor') && document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    publish("sample", { field0: 1002 });
    await until(
      "document.querySelector('.message-tree')?.innerText.includes('1002')",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.gap-row').length"),
      gapsBeforeEdits + 1,
      "Resuming a removed topic must mark its reception gap",
    );

    await click(".connection-disclosure");
    await fill("input[name=username]", "another-user");
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected') && !document.querySelector('.connection-editor')",
    );
    assert.notEqual(client, established, "Credential changes must reconnect");
    assert(
      await evaluate("document.querySelectorAll('.plot-panel').length === 9"),
    );
    assert(
      await evaluate(
        "document.querySelectorAll('[aria-label=\"MQTT topics\"] [role=treeitem]').length >= 46",
      ),
    );
    await click(".connection-disclosure");
    await fill("input[name=username]", "unapplied-draft");
    await evaluate("history.back()");
    await until("!document.querySelector('.connection-editor')");
    subscriptionReply = "incomplete";
    client.terminate();
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connection failed')",
    );
    subscriptionReply = "accept";
    await click(".connection-state button");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected')",
    );
    assert.equal(
      connections.at(-1),
      "another-user",
      "Recovery applied an unsubmitted credential draft",
    );
    await click(".connection-disclosure");
    await fill("input[name=broker]", `ws://127.0.0.1:${port}/another-broker`);
    assert(
      await evaluate(
        "document.querySelector('.connection-editor').innerText.includes('clears')",
      ),
    );
    await click(".connection-editor button[type=submit]");
    await until(
      "document.querySelector('.connection-state').innerText.includes('Connected') && !document.querySelector('.connection-editor')",
    );
    assert(
      await evaluate(
        "!document.querySelector('.plot-panel') && !document.querySelector('[aria-label=\"MQTT topics\"]')",
      ),
    );
    console.log(
      `Checked panes, touch controls, recovery, and subscription editing: ${base}`,
    );
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
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
