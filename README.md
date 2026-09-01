# MQTT Telemetry

A read-only MQTT JSON telemetry browser with bounded history and up to eight live plots.

## Use

Start with a [live public broker `dt/#` view](https://telemetry.quartiq.de/?broker=wss://broker.emqx.io:8084/mqtt&sub=dt/%23), which connects and subscribes immediately.

For another broker, open <https://telemetry.quartiq.de/> and enter its MQTT-over-WebSocket URL, with one subscription filter per line. MQTT excludes `$` topics from `#`; subscribe to `$SYS/#` explicitly when needed.

The address bar is a compact, bookmarkable launch URL: `broker`, repeated `sub`, `history`, and optional `age` and `window` durations using `s`, `m`, `h`, or `d`. `age` discards older local samples; `window` only limits the plotted interval and defaults to `all`. Encode MQTT wildcards as `%23` and `%2B`.

Launch parameters are ordinary query data and may appear in browser or hosting logs. For sensitive broker or topic names, load a dashboard file locally instead.

Select a value to inspect its history. Toggle the square beside a numeric field to plot it. Topic search is a case-insensitive substring search unless it contains MQTT `+` or `#` wildcards.

Receipt times use a consistent 24-hour clock. Choose Local or UTC from the connected header; saved dashboards retain that choice.

Save a dashboard to keep the launch settings plus timezone and plots as JSON; credentials and message history are never included. **Copy dashboard** creates a self-contained link; opening it imports the dashboard and replaces the embedded JSON with its compact launch URL.

Browsers require `ws://` or `wss://`; ordinary `mqtt://` TCP endpoints do not work. The hosted HTTPS page requires `wss://` with a browser-trusted certificate. Chromium may additionally request Local Network Access permission for a private or loopback broker.

For a LAN broker that only provides `ws://`, save the hosted page as **Webpage, HTML Only**, then open that file. It is a complete offline application and can connect directly to a private `ws://` endpoint.

### Data and reconnect behavior

History exists only in the current tab. It defaults to 1,000 live messages per topic and is also globally bounded; payloads over 1 MiB are omitted. The latest retained snapshot for each topic is kept outside the count and age limits, but not plotted because its original publication time is unknown. History count and maximum age delete local samples; the independent plot window only limits the visible interval and its statistics. Clear actions affect only this tab.

After a connection has been established, transport failures are retried and subscriptions are restored before the application reports connected. These are clean MQTT sessions: live QoS 0 traffic sent while disconnected is not recoverable. History marks reconnect gaps and plots do not join across them. An initial connection failure or a failed resubscription requires explicit user action.

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

`npm run build` type-checks and produces the self-contained `dist/index.html` used for both deployment and the local-file workflow.
The browser smoke test opens that artifact from `file://` with Chrome or Chromium.

## Deploy

GitHub Actions verifies pushes and pull requests, then deploys successful `main` builds to GitHub Pages. Pages must use GitHub Actions as its source, with `telemetry.quartiq.de` configured as the HTTPS custom domain and the `telemetry` DNS CNAME pointing to `quartiq.github.io`.
