# MQTT Telemetry

A small, read-only web frontend for browsing MQTT JSON telemetry. It discovers topics from live and retained publications, keeps a bounded in-memory history per topic, lets you inspect any JSON field, and plots that field over receipt time.

## Run

```sh
npm install
npm run dev
```

Open the printed URL and enter an MQTT-over-WebSocket broker such as `ws://localhost:9001`. Browser applications cannot connect directly to ordinary `mqtt://` TCP ports. An HTTPS deployment must use a `wss://` broker because browsers block mixed content.

The connection form accepts one MQTT subscription filter per line and defaults to `#`. `$` topics are not matched by `#`; add a filter such as `$SYS/#` explicitly when needed.

## Browsing

The topic tree is populated as messages arrive. Select a topic to see its newest message and history. Select a JSON field in the message tree to show that field in every history row and plot its finite numeric values. Retained replays are visible in history but excluded from the plot because their original publication time is unknown.

The newest message is followed automatically. Selecting a history row freezes that message for inspection; **Latest** resumes following incoming messages.

Browser Back and Forward traverse connection, topic, historical-message, and field choices. Broker, subscriptions, selected topic, and selected field are encoded in the URL. Historical-message selection remains page-session state because message history is not persisted across reloads.

## URL parameters

| Parameter  | Meaning                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| `broker`   | Full `ws://` or `wss://` MQTT WebSocket URL. A valid value connects automatically.          |
| `topic`    | MQTT subscription filter. Repeat the parameter for multiple subscriptions. Defaults to `#`. |
| `history`  | Positive per-topic message limit. Defaults to `1000`.                                       |
| `selected` | Currently selected concrete topic.                                                          |
| `field`    | Selected JSON field encoded as an RFC 6901 JSON Pointer.                                    |

Example:

```text
?broker=ws%3A%2F%2Flocalhost%3A9001&topic=sensors%2F%23&topic=alerts%2F%2B&history=500
```

Username and password are never placed in the URL. They are stored in `sessionStorage` for the current browser tab, keyed by broker URL.

## Build and verify

```sh
npm run format:check
npm run check
npm test
npm run build
```

The static production site is written to `dist/` and can be served by any ordinary static web server.

## Scope

The frontend does not publish messages, clear retained topics, persist telemetry, provide draggable dashboards, or connect to multiple brokers simultaneously. Its runtime dependencies are Svelte and MQTT.js; the accessible trees and SVG plot are implemented locally.
