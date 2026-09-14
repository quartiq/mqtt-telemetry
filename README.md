# MQTT Telemetry

A read-only MQTT JSON browser with local history and up to ten live plots.

## Connect

Open [MQTT Telemetry](https://telemetry.quartiq.de/) and enter a `ws://` or `wss://` broker URL, optional credentials, and one subscription filter per line. **Connect** opens the connection and subscribes. A [public broker example](https://telemetry.quartiq.de/?broker=wss://test.mosquitto.org:8081/&sub=$SYS/%23) starts immediately.

The initial editor contains `#`. Empty the list to connect without subscriptions, or to unsubscribe everything with **Apply**. Exact duplicates and blank lines are ignored; spaces and empty levels such as `a//b` are preserved. An empty list is valid; an empty MQTT filter is not. `#` does not include MQTT `$` topics; subscribe to `$SYS/#` explicitly when needed. Invalid filters are reported before changing the connection.

## Inspect and plot

Select a topic to inspect its latest received message. Numeric root payloads appear inline as `topic (99) = 23.456`; the value follows the latest received message even while inspecting history. Topic counts show buffered messages on that exact topic; branches without a count only group descendant topics. Search matches a case-insensitive substring, or an MQTT filter when the query contains `+` or `#`.

Pin a numeric JSON payload directly from its topic row. For an object or array, select the topic and pin numeric fields in **Value**. Both controls operate on the same plots. Pinning does not change the selected topic. Plot titles return to the corresponding topic and field; plot controls reorder or remove plots. At the ten-plot limit, remove a plot before adding another.

Pins keep their exact topic and JSON path when payload types change. A missing or nonnumeric field interrupts its plot line; numeric values returning resume the same plot. The last plotted sample remains historical, and the plot reports when the current field is absent or nonnumeric.

Expand **History** and select a message to inspect an earlier value; **Latest** resumes following incoming messages. This changes the inspected message, not the pinned plots. Plot hover inspection uses the mouse. On touch screens, the trees and plot controls are available, but hover inspection is not.

## Change subscriptions or connection

Open the broker heading to edit the applied settings. **Cancel** discards the edit; recovery never uses unapplied credentials.

| Action                           | Connection behavior                                                                             | Local history and plots                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Apply** subscription edits     | Updates filters on the existing connection. While reconnecting, updates the filters to restore. | Keeps history, selection, and plots.                                        |
| **Apply** changed credentials    | Reconnects to the same broker.                                                                  | Keeps history, selection, and plots.                                        |
| **Apply** a different broker URL | Opens a new connection.                                                                         | Clears history, selection, and plots.                                       |
| **Refresh subscriptions**        | Subscribes again to request retained values and retry rejected filters.                         | Keeps the workspace; received retained snapshots replace earlier snapshots. |
| **Reconnect**                    | Opens a new connection using the applied settings.                                              | Keeps the same broker's workspace.                                          |

Subscription additions are acknowledged before old filters are removed. A broker can reject individual filters; the connection remains open and the rejected filters are listed. Edit those filters or use **Refresh subscriptions** to retry. Removing a filter stops future reception where no remaining filter covers the topic; it does not erase collected messages or plots.

Established connections retry transport failures automatically. Subscription acknowledgment failure or a 15-second acknowledgment timeout stops the attempt and exposes **Reconnect**. An initial connection failure opens the editor for correction and retry. Connected means the broker has answered the subscription requests, not that messages are arriving.

## Keep or discard data

History exists only in the current tab. **Live max** defaults to 1,000 messages per topic; **Age** limits older live history. Automatic pruning always keeps each topic’s latest received message, even when it is older than **Age**. It never removes topics or plot definitions. Clear history actions explicitly remove messages, including the latest values, while keeping topics and plots.

One retained snapshot per topic is kept outside live count and age limits. A superseded retained snapshot may be removed under shared storage pressure; it never takes priority over a newer received value. Retained snapshots are inspectable and excluded from plots because their publication time is unknown. Payloads over 1 MiB are omitted.

The shared storage budget is 100,000 messages and 64 MiB of estimated storage. Older history is trimmed first, so **Live max** is an upper bound rather than a reservation. At the 10,000-node topic-tree limit, new branches are ignored while existing topics continue updating. If even the latest values alone cannot fit the storage budget, collection stops with an explicit notice; the connection stays open and collected data remains inspectable.

To recover, narrow the subscriptions and **Apply**, then **Reset collected data**. Reset clears local messages and the topic tree, keeps subscriptions and plot definitions, and resumes collection. It does not reconnect. **Refresh subscriptions** can then request retained snapshots again. Clear and reset actions never publish or delete retained values on the broker.

Plots use browser receipt time. **Time** selects Local or UTC display. **Show** limits the plotted interval and its statistics without deleting history. Plot lines and history mark reception interruptions after a reconnect or after a topic loses subscription coverage. Changing an unrelated filter does not interrupt that topic's plot. Missing live messages are not recovered after reconnecting.

## Save, share, and return

**Save** writes dashboard JSON containing the broker, subscriptions, history limits, display settings, and plots. **Load** replaces those settings and plots. Loading for the same broker keeps existing messages within the loaded history limits; changing broker starts empty. Credentials, message history, selection, and tree expansion are not saved in dashboard files or links.

**Copy dashboard** creates a link containing the dashboard in its fragment. The fragment is removed after import. The address bar otherwise contains a bookmarkable launch query: `broker`, repeated `sub`, `history`, and optional `age` and `window` durations such as `10m`, `1h`, or `7d`. Encode filter wildcards as `%23` and `%2B`. A launch URL with a broker and no `sub` parameters connects without subscriptions; `sub=` is an invalid empty filter.

A dashboard fragment takes precedence over a launch query. Reload restores matching same-tab dashboard settings; an explicitly different launch query takes precedence over that tab state. Reload does not restore messages. Back and Forward restore dashboard settings and selection, applying subscription changes as needed; they cannot restore discarded history.

Launch queries may appear in browser history and hosting logs. For sensitive broker or topic names, load a dashboard file locally instead.

## Local brokers

Browsers require MQTT over WebSockets; `mqtt://` TCP endpoints do not work. The hosted HTTPS page requires `wss://` and a browser-trusted certificate. Chromium may also request Local Network Access permission for private or loopback brokers.

For a LAN broker that only supports `ws://`, save the hosted page as **Webpage, HTML Only**, then open the saved file. It is a complete offline application and can connect directly to the broker. Its build link identifies the source commit; builds without source metadata say `local build`.

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

The build includes Svelte checks and produces the self-contained `dist/index.html`. Browser checks require installed Chrome or Chromium (`CHROME_BIN` can select it). They use a local MQTT fixture over HTTP and `file://`, with responsive-layout and touch-emulation checks; they do not contact an external broker.

The concept and many ideas are adopted from [`mqttui`](https://github.com/EdJoPaTo/mqttui).

## License

Licensed under either Apache-2.0 or MIT.
