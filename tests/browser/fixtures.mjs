import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Exercise the same packet/transport versions as the real MQTT client.
const requireMqtt = createRequire(import.meta.resolve("mqtt"));
const { WebSocketServer } = requireMqtt("ws");
export const packet = requireMqtt("mqtt-packet");
const html = readFileSync("dist/index.html");

export const test = base.extend({
  broker: async ({}, use) => {
    const server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    });
    const sockets = new WebSocketServer({ server });
    const broker = {
      client: undefined,
      connections: [],
      requests: [],
      subscriptionReply: "accept",
      acknowledge: undefined,
      port: 0,
      publish(topic, value, retain = false) {
        this.client.send(
          packet.generate({
            cmd: "publish",
            topic,
            payload: Buffer.isBuffer(value) ? value : JSON.stringify(value),
            qos: 0,
            retain,
          }),
        );
      },
    };
    sockets.on("connection", (socket) => {
      const parser = packet.parser();
      socket.on("error", () => {});
      socket.on("message", (bytes) => parser.parse(bytes));
      parser.on("packet", (message) => {
        if (message.cmd === "connect") {
          broker.client = socket;
          broker.connections.push({
            username: message.username ?? "",
            password: message.password?.toString() ?? "",
          });
          socket.send(packet.generate({ cmd: "connack", returnCode: 0 }));
        } else if (message.cmd === "subscribe") {
          broker.requests.push({
            cmd: "subscribe",
            filters: message.subscriptions.map(({ topic }) => topic),
          });
          broker.acknowledge = () =>
            socket.send(
              packet.generate({
                cmd: "suback",
                messageId: message.messageId,
                granted: message.subscriptions.map((_, index) =>
                  broker.subscriptionReply === "reject" && index === 1
                    ? 128
                    : 0,
                ),
              }),
            );
          if (broker.subscriptionReply !== "hold") broker.acknowledge();
        } else if (message.cmd === "unsubscribe") {
          broker.requests.push({
            cmd: "unsubscribe",
            filters: message.unsubscriptions,
          });
          socket.send(
            packet.generate({ cmd: "unsuback", messageId: message.messageId }),
          );
        } else if (message.cmd === "pingreq") {
          socket.send(packet.generate({ cmd: "pingresp" }));
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    broker.port = server.address().port;
    try {
      await use(broker);
    } finally {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    }
  },
  baseURL: async ({ broker }, use, testInfo) => {
    await use(
      testInfo.project.name === "file"
        ? pathToFileURL(resolve("dist/index.html")).href
        : `http://127.0.0.1:${broker.port}/`,
    );
  },
  cdp: async ({ context, page }, use) => {
    const session = await context.newCDPSession(page);
    await use(session);
    await session.detach();
  },
  consoleErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
  connected: [
    async ({ page, broker, baseURL, consoleErrors }, use) => {
      const url = new URL(baseURL);
      url.searchParams.set("broker", `ws://127.0.0.1:${broker.port}`);
      url.searchParams.append("sub", "#");
      url.searchParams.append("sub", "alerts/+");
      await page.goto(url.href);
      await expect(page.locator(".connection-state")).toContainText(
        "Connected",
      );
      await use();
    },
    { auto: true },
  ],
});

export async function seedDashboard(page, broker, plots = 1) {
  broker.publish(
    "sample",
    Object.fromEntries(
      Array.from({ length: 12 }, (_, field) => [`field${field}`, field]),
    ),
  );
  await page.getByText("sample", { exact: true }).click();
  await expect(
    page.locator('.message-tree [data-tree-id="$.field0"]'),
  ).toBeVisible();
  for (let index = 0; index < plots; index++)
    await page
      .locator(`.message-tree [data-tree-id="$.field${index}"] .plot-toggle`)
      .click();
}

export async function authenticate(page) {
  await page.locator(".connection-disclosure").click();
  await page.locator("input[name=username]").fill("another-user");
  await page.locator("input[name=password]").fill("reload-secret");
  await page.locator(".connection-editor button[type=submit]").click();
  await expect(page.locator(".connection-editor")).toHaveCount(0);
  await expect(page.locator(".connection-state")).toContainText("Connected");
}

export async function dimensions(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    return {
      topics: rect(".topics"),
      value: rect(".message-panel"),
      history: rect(".history-panel"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}
