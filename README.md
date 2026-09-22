# MQTT Telemetry

A read-only MQTT JSON browser with local history and up to ten live plots, inspired by [mqttui](https://github.com/EdJoPaTo/mqttui).

[Open MQTT Telemetry](https://telemetry.quartiq.de/) or [try a public broker](https://telemetry.quartiq.de/?broker=wss://test.mosquitto.org:8081/&sub=$SYS/%23).

Connect to your broker, browse topics, and pin numeric values to plot them. Simple numeric payloads can be pinned directly in the topic tree; structured JSON exposes its fields in **Value**. **History** lets you inspect earlier messages while plots continue following live traffic.

Use one MQTT subscription filter per line. Start with the topics you need: `#` on a busy broker can overwhelm the viewer. An empty list means no subscriptions. `$SYS` topics need an explicit filter such as `$SYS/#`.

## What to expect

History lives in the current tab and is lost on reload. Storage is bounded: older messages are pruned, preserving each topic’s latest received value, the topic tree, and your plots. The latest value is kept even beyond the history age limit. Clearing history keeps topics and pins; resetting collected data also forgets topics. If capacity is exhausted, the app explains what stopped and how to recover.

Credentials are remembered for reload using this tab’s session storage, when available.

Subscription edits and reconnects preserve the workspace. Changing the broker URL starts fresh. Messages missed during a connection interruption cannot be recovered.

Plots use browser receipt time. Display updates are batched; every accepted arrival enters history, including retained replays and empty payloads. Neither erases earlier messages. Binary previews retain at most 32 bytes, alongside the original message size. Retained replays are excluded from plots so refreshing subscriptions does not count old values as new measurements. A pinned field becoming absent or nonnumeric interrupts its line; the plot resumes when numeric values return.

Saved dashboards and share links contain connection settings and plots, but no credentials or message history. Broker and topic names in launch URLs may appear in browser history and hosting logs; use a local dashboard file for sensitive names.

## Local brokers

Browsers need MQTT over WebSockets. The hosted HTTPS app requires `wss://` and a browser-trusted certificate. Your browser may also request permission to access a local broker.

For a LAN broker offering only `ws://`, save the hosted page as **Webpage, HTML Only** and open the saved file. It is a complete offline application that connects directly to the broker.

Successful CI/CD runs also provide a downloadable `index.html` artifact. Main deploys that same tested build to Pages.

## Develop

```sh
npm ci
npm run dev
```

```sh
npm run format:check
npm test
npm run build
npm run test:browser
```

The build checks Svelte and produces the self-contained `dist/index.html`. Browser checks use a local MQTT fixture and require Chrome or Chromium; set `CHROME_BIN` if needed.

## License

Licensed under either Apache-2.0 or MIT.
