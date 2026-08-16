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

The topic tree is populated as messages arrive. A click selects a topic; double-click or **Enter** toggles a branch. Use the caret or **Space** to fold a branch and the arrow, **Home**, **End**, **Page Up**, and **Page Down** keys to move through a tree. Select a JSON field in the message tree to show that field in every history row and plot its finite numeric values. The last field is remembered for each topic, and a field carried to a new topic remains selected when that topic has the same JSON path. Retained replays are visible in history but excluded from the plot because their original publication time is unknown.

The newest message is followed automatically. Selecting a history row freezes that message for inspection; **Up**, **Down**, **Home**, and **End** move through history without adding every row to the Tab order. **Latest** resumes following incoming messages. If a frozen message reaches the configured history limit and is evicted, the view resumes following the latest message.

Browser Back and Forward traverse connection, topic, historical-message, and field choices. Broker, subscriptions, selected topic, and selected field are encoded in the URL. Opening such a URL reveals the selected field in the JSON tree. Historical-message selection remains page-session state because message history is not persisted across reloads.

## URL parameters

| Parameter  | Meaning                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------- |
| `broker`   | Full `ws://` or `wss://` MQTT WebSocket URL. A valid value connects automatically.          |
| `topic`    | MQTT subscription filter. Repeat the parameter for multiple subscriptions. Defaults to `#`. |
| `history`  | Per-topic message limit from `1` to `10000`. Defaults to `1000`.                            |
| `selected` | Currently selected concrete topic.                                                          |
| `field`    | Selected JSON field encoded as an RFC 6901 JSON Pointer.                                    |

Example:

```text
?broker=ws%3A%2F%2Flocalhost%3A9001&topic=sensors%2F%23&topic=alerts%2F%2B&history=500
```

Username and password entered in the connection form are never placed in the URL. They are stored in `sessionStorage` for the current browser tab, keyed by broker URL. Broker URLs are themselves shared through the address bar, so do not put secret tokens or credentials in a broker URL.

For browser safety, payload contents above 1 MiB are omitted and discovery stops adding new topic nodes after 10,000 nodes. Existing topics continue updating; the Topics header reports any affected publications.

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
