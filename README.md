# MQTT Telemetry

A small, read-only web frontend for browsing MQTT JSON telemetry. It discovers topics from live and retained publications, keeps a bounded in-memory history per topic, lets you inspect any JSON field, and plots that field over receipt time.

## Run

```sh
npm install
npm run dev
```

Open the printed URL and enter an MQTT-over-WebSocket broker such as `ws://localhost:9001`. Browser applications cannot connect directly to ordinary `mqtt://` TCP ports. An HTTPS deployment must use a `wss://` broker because browsers block mixed content.

The connection form accepts one MQTT subscription filter per line and defaults to `#`. `$` topics are not matched by `#`; add a filter such as `$SYS/#` explicitly when needed.

The browser keeps retrying after initial or later transport failures and resubscribes after reconnection. Changing connection explicitly stops those retries.

## Browsing

The topic tree is populated as messages arrive. Press **/** to search complete topic paths and **Escape** to clear the search. Both trees use the same controls: click selects a node; double-click or **Enter** toggles a branch; the caret or **Space** also folds it; and the arrow, **Home**, **End**, **Page Up**, and **Page Down** keys move through visible nodes. Collapsing a branch selects it if its selected descendant would otherwise become hidden.

Topic history initially shows a bounded compact preview of each complete payload. Select a JSON field in the current-value tree to project that field into every history row and plot its finite numeric values. No field and the JSON root are distinct selections. The last field is remembered for each topic, and a field carried to a new topic remains selected when that topic has the same JSON path. The current-value header reports when a remembered field is absent from the displayed message. Retained replays are visible in history but excluded from the plot because their original publication time is unknown. MQTT redeliveries are marked `DUP` rather than discarded.

The newest message is followed automatically. Selecting a history row marks the current value as historical and freezes that message for inspection; **Up**, **Down**, **Home**, and **End** move through history without adding every row to the Tab order. **Latest** resumes following incoming messages.

The connection form and Topics panel configure how many messages are kept per topic. Lowering the limit discards older buffered messages across every topic immediately. **Clear local…** in Topic history clears only the exact selected topic; **Clear local branch history…** clears that topic and its discovered subtopics. Both actions affect this browser tab only: they do not publish, change subscriptions, or remove retained data from the broker. A retained publication that was cleared locally can therefore reappear after reconnecting and resubscribing. If a frozen message is cleared or evicted, the view resumes following the latest message.

Browser Back and Forward traverse connection, topic, historical-message, and field choices. Broker, subscriptions, selected topic, and selected field are encoded in the URL. Opening such a URL reveals the selected field in the JSON tree. Historical-message selection remains page-session state because message history is not persisted across reloads.

## URL parameters

| Parameter  | Meaning                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `broker`   | Full `ws://` or `wss://` MQTT WebSocket URL. A valid value connects automatically.                                  |
| `topic`    | MQTT subscription filter. Repeat the parameter for multiple subscriptions. Defaults to `#`.                         |
| `history`  | Per-topic message limit from `1` to `10000`. Defaults to `1000`.                                                    |
| `selected` | Currently selected concrete topic.                                                                                  |
| `field`    | Selected JSON field encoded as an RFC 6901 JSON Pointer. Omit it for no selection; an empty value selects the root. |

Example:

```text
?broker=ws://localhost:9001&topic=sensors/%23&topic=alerts/%2B&history=500
```

Username and password entered in the connection form are never placed in the URL. They are stored in `sessionStorage` for the current browser tab, keyed by broker URL. Broker URLs containing embedded credentials are rejected because URLs are shared through browser history and the address bar. Broker-specific secret query parameters cannot be recognized automatically and should not be used in shared links.

For browser safety, payload contents above 1 MiB are omitted, discovery stops after 10,000 topic nodes, and history is globally limited to 100,000 messages and an estimated 64 MiB of payload storage. Oldest messages are evicted first across topics. JSON value trees stop after 10,000 nodes or 64 levels. Existing topics continue updating; the Topics header reports dropped publications, omitted payloads, and global history evictions.

## Build and verify

```sh
npm run format:check
npm run check
npm test
npm run build
```

The static production site is written to `dist/` and can be served by any ordinary static web server.

## Scope

The frontend does not publish messages, clear broker-retained topics, persist telemetry, provide draggable dashboards, or connect to multiple brokers simultaneously. In MQTT, removing a retained value is a broker-side publish operation; the local history actions above never perform it. The runtime dependencies are Svelte and MQTT.js; the accessible trees and SVG plot are implemented locally.
