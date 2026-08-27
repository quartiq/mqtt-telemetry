# MQTT Telemetry

A read-only browser for MQTT JSON telemetry, with topic discovery, bounded history, field inspection, and plotting.

## Use

Open <https://telemetry.quartiq.de/> and enter an MQTT-over-WebSocket URL. Use one subscription filter per line; the default is `#`. MQTT excludes `$` topics from `#`, so subscribe to filters such as `$SYS/#` explicitly.

Browse one JSON field at a time; use the square marker on numeric fields to pin up to eight independent plots with a shared receipt-time axis. History can be bounded by both messages per topic and age. Clearing history, removing plots, and changing the active field are independent actions.

Browsers require `ws://` or `wss://`; ordinary `mqtt://` TCP endpoints do not work. The hosted HTTPS page requires `wss://` with a browser-trusted certificate. Chromium may additionally request Local Network Access permission for a private or loopback broker.

For a LAN broker that only provides `ws://`, open the hosted application, choose **Save Page As** with the **Webpage, HTML Only** type, then open the saved file. The file is the complete application, works without `telemetry.quartiq.de`, and may connect directly to private `ws://` endpoints.

### Data and reconnect behavior

History exists only in the current tab. It defaults to 1,000 messages per topic and is bounded globally; payloads over 1 MiB are omitted. Retained publications appear in history but not in plots because their original publication time is unknown. Local clear actions never modify retained broker data.

After a connection has been established, transport failures are retried and subscriptions are restored before the application reports connected. These are clean MQTT sessions: live QoS 0 traffic sent while disconnected is not recoverable. History marks reconnect gaps and plots do not join across them. An initial connection failure or a failed resubscription requires explicit user action.

The address bar records the connection, retention settings, active field, and pinned plots, making that view shareable. Message history and credentials are not included. Credentials use normal browser autocomplete and are not stored by the application.

## Develop

```sh
npm ci
npm run dev
```

Before committing:

```sh
npm run format:check
npm test
npm run build
```

`npm run build` type-checks the application and produces the self-contained `dist/index.html` used both by GitHub Pages and the local-file workflow.

## Deploy

The CI/CD workflow verifies every push and pull request. A successful `main` build is deployed to GitHub Pages.

The repository must use **GitHub Actions** as its Pages source, configure `telemetry.quartiq.de` as the custom domain, and enforce HTTPS. DNS must point the `telemetry` CNAME to `quartiq.github.io`.
