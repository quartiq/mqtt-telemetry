<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import ConnectionForm from "./ConnectionForm.svelte";
  import HistoryTable from "./HistoryTable.svelte";
  import MessagePanel from "./MessagePanel.svelte";
  import TelemetryPlot from "./TelemetryPlot.svelte";
  import TreeView from "./TreeView.svelte";
  import { loadAuth, saveAuth } from "./lib/auth-store";
  import {
    TelemetryStore,
    fieldLabel,
    jsonPointer,
    jsonTree,
    plotPoints,
    resolveJsonPointer,
    type JsonPath,
  } from "./lib/model";
  import { MqttSession, type SessionStatus } from "./lib/mqtt-session";
  import {
    connectionKey,
    isWebSocketBroker,
    readRoute,
    routeSearch,
    uniqueFilters,
    type AppRoute,
  } from "./lib/routes";

  type ViewState = {
    app: "mqtt-telemetry";
    token: string;
    messageId: number | null;
  };

  const initialRoute = readRoute(location.search);
  let route = $state(initialRoute);
  let formBroker = $state(initialRoute.broker);
  let formFilters = $state(initialRoute.filters.join("\n"));
  const initialAuth = loadAuth(initialRoute.broker);
  let username = $state(initialAuth.username);
  let password = $state(initialAuth.password);
  let authBroker = initialRoute.broker;

  let session = $state<MqttSession | undefined>();
  let store = $state.raw(new TelemetryStore(initialRoute.historyLimit));
  let revision = $state(0);
  let selectedTopicId = $state("");
  let selectedMessageId = $state<number | null>(null);
  let selectedField = $state<JsonPath>([]);
  let topicExpanded = $state(new Set<string>());
  let jsonExpanded = $state(new Set<string>(["$"]));
  let status = $state("Idle");
  let error = $state("");
  let busy = $state(false);
  let connectSerial = 0;
  let viewToken = crypto.randomUUID();
  let lastReceivedAt = 0;

  let topicSnapshot = $derived.by(() => {
    revision;
    return store.snapshot();
  });
  let selectedTopic = $derived(store.topic(selectedTopicId) ?? "");
  let currentHistory = $derived.by(() => {
    revision;
    return selectedTopicId ? store.history(selectedTopicId) : [];
  });
  let currentMessage = $derived.by(() => {
    if (!currentHistory.length) return undefined;
    if (selectedMessageId === null) return currentHistory.at(-1);
    return (
      currentHistory.find((message) => message.id === selectedMessageId) ??
      currentHistory.at(-1)
    );
  });
  let jsonSnapshot = $derived(
    currentMessage?.payload.kind === "json"
      ? jsonTree(currentMessage.payload.value)
      : undefined,
  );
  let selectedJsonId = $derived(jsonPointer(selectedField) || "$");
  let points = $derived(plotPoints(currentHistory, selectedField));
  let selectedFieldLabel = $derived(fieldLabel(selectedField));
  let directTopicCount = $derived(
    [...topicSnapshot.nodes.keys()].filter((id) => store.history(id).length)
      .length,
  );

  $effect(() => {
    const message = currentMessage;
    if (message?.payload.kind !== "json") {
      selectedField = [];
      return;
    }
    const resolved = resolveJsonPointer(
      message.payload.value,
      route.fieldPointer,
    );
    if (resolved) {
      if (jsonPointer(resolved) !== jsonPointer(selectedField))
        selectedField = resolved;
    } else if (route.fieldPointer) {
      selectedField = [];
      replaceRoute({ ...route, fieldPointer: "" }, selectedMessageId);
    }
  });

  onMount(() => {
    const popstate = (event: PopStateEvent) => {
      const next = readRoute(location.search);
      if (connectionKey(next) !== connectionKey(route)) {
        route = next;
        formFilters = next.filters.join("\n");
        if (next.broker) {
          formBroker = next.broker;
          loadBrokerAuth(next.broker);
          void startConnection(next);
        } else {
          stopConnection();
        }
      } else {
        route = next;
        restoreView(event.state);
      }
    };
    addEventListener("popstate", popstate);
    if (route.broker) void startConnection(route);
    return () => {
      removeEventListener("popstate", popstate);
      connectSerial += 1;
      session?.close();
    };
  });

  function historyState(messageId = selectedMessageId): ViewState {
    return { app: "mqtt-telemetry", token: viewToken, messageId };
  }

  function writeRoute(
    next: AppRoute,
    messageId: number | null,
    replace = false,
  ) {
    route = next;
    const method = replace ? "replaceState" : "pushState";
    history[method](historyState(messageId), "", routeSearch(next));
  }

  function replaceRoute(next: AppRoute, messageId: number | null) {
    writeRoute(next, messageId, true);
  }

  function loadBrokerAuth(broker: string) {
    if (authBroker === broker) return;
    authBroker = broker;
    ({ username, password } = loadAuth(broker));
  }

  function resetData(historyLimit: number) {
    store = new TelemetryStore(historyLimit);
    revision += 1;
    selectedTopicId = "";
    selectedMessageId = null;
    selectedField = [];
    topicExpanded = new Set();
    jsonExpanded = new Set(["$"]);
    viewToken = crypto.randomUUID();
    lastReceivedAt = 0;
  }

  function stopConnection() {
    connectSerial += 1;
    session?.close();
    session = undefined;
    busy = false;
    status = "Idle";
    error = "";
    resetData(route.historyLimit);
  }

  function statusChanged(next: SessionStatus) {
    switch (next.state) {
      case "connected":
        status = "Connected";
        error = "";
        break;
      case "reconnecting":
        status = "Reconnecting";
        break;
      case "offline":
      case "closed":
        status = "Disconnected";
        break;
      case "error":
        status = "Connection error";
        error = next.error;
        break;
    }
  }

  function receiptTime(): number {
    const now = performance.timeOrigin + performance.now();
    lastReceivedAt = Math.max(now, lastReceivedAt + 0.001);
    return lastReceivedAt;
  }

  async function startConnection(nextRoute: AppRoute) {
    const serial = ++connectSerial;
    session?.close();
    session = undefined;
    resetData(nextRoute.historyLimit);
    busy = true;
    status = "Connecting";
    error = "";
    try {
      const nextSession = await MqttSession.connect(
        nextRoute.broker,
        nextRoute.filters,
        {
          message: ({ topic, payload, packet }) => {
            if (serial !== connectSerial || packet.cmd !== "publish") return;
            const added = store.add(topic, payload, {
              receivedAt: receiptTime(),
              retained: packet.retain,
              qos: packet.qos,
            });
            revision += 1;
            if (route.selectedTopic === topic) {
              selectLoadedTopic(added.nodeId, false);
            } else if (!route.selectedTopic && !selectedTopicId) {
              selectLoadedTopic(added.nodeId, false);
              replaceRoute(
                { ...route, selectedTopic: topic, fieldPointer: "" },
                null,
              );
            }
          },
          status: (next) => {
            if (serial === connectSerial) statusChanged(next);
          },
        },
        username || password ? { username, password } : undefined,
      );
      if (serial !== connectSerial) {
        nextSession.close();
        return;
      }
      session = nextSession;
      busy = false;
      restoreView(history.state);
    } catch (caught) {
      if (serial !== connectSerial) return;
      busy = false;
      status = "Connection failed";
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function connectFromForm() {
    const broker = formBroker.trim();
    const brokerError = isWebSocketBroker(broker);
    if (brokerError) {
      error = brokerError;
      return;
    }
    const filters = uniqueFilters(formFilters.split(/\r?\n/));
    saveAuth(broker, { username, password });
    const next: AppRoute = {
      broker,
      filters,
      historyLimit: route.historyLimit,
      selectedTopic: "",
      fieldPointer: "",
    };
    writeRoute(next, null);
    void startConnection(next);
  }

  function changeConnection() {
    const previousBroker = route.broker;
    const next = { ...route, broker: "", selectedTopic: "", fieldPointer: "" };
    writeRoute(next, null);
    stopConnection();
    formBroker = previousBroker;
  }

  function selectLoadedTopic(id: string, reset: boolean) {
    selectedTopicId = id;
    topicExpanded = new Set([...topicExpanded, ...store.ancestorIds(id)]);
    if (reset) {
      selectedMessageId = null;
      selectedField = [];
      jsonExpanded = new Set(["$"]);
    }
  }

  function selectTopic(id: string) {
    const topic = store.topic(id);
    if (topic === undefined) return;
    selectLoadedTopic(id, true);
    writeRoute({ ...route, selectedTopic: topic, fieldPointer: "" }, null);
  }

  function toggleTopic(id: string, open: boolean) {
    const next = new Set(topicExpanded);
    if (open) next.add(id);
    else next.delete(id);
    topicExpanded = next;
  }

  function selectJson(id: string) {
    const path = jsonSnapshot?.paths.get(id);
    if (!path) return;
    selectedField = path;
    writeRoute(
      { ...route, fieldPointer: jsonPointer(path) },
      selectedMessageId,
    );
  }

  function toggleJson(id: string, open: boolean) {
    const next = new Set(jsonExpanded);
    if (open) next.add(id);
    else next.delete(id);
    jsonExpanded = next;
  }

  function selectHistory(messageId: number) {
    selectedMessageId = messageId;
    writeRoute(route, messageId);
  }

  function selectLatest() {
    selectedMessageId = null;
    writeRoute(route, null);
  }

  function restoreView(state: unknown) {
    const id = route.selectedTopic
      ? store.nodeId(route.selectedTopic)
      : undefined;
    if (id) selectLoadedTopic(id, selectedTopic !== route.selectedTopic);
    else if (route.selectedTopic) selectedTopicId = "";

    const view = state as Partial<ViewState> | null;
    const messageId =
      view?.app === "mqtt-telemetry" &&
      view.token === viewToken &&
      typeof view.messageId === "number"
        ? view.messageId
        : null;
    selectedMessageId = currentHistory.some(
      (message) => message.id === messageId,
    )
      ? messageId
      : null;
  }
</script>

{#if !session}
  <ConnectionForm
    bind:broker={formBroker}
    bind:filters={formFilters}
    bind:username
    bind:password
    historyLimit={route.historyLimit}
    {status}
    {error}
    {busy}
    onconnect={connectFromForm}
  />
{:else}
  <main class="browser">
    <header class="app-header panel">
      <div class="identity">
        <h1>{selectedTopic || "MQTT Telemetry"}</h1>
        <div class="breadcrumb" aria-label="Current browsing path">
          <span>{route.broker}</span>
          {#if selectedTopic}<span aria-hidden="true">›</span><span
              >{selectedTopic}</span
            >{/if}
          {#if selectedField.length}
            <span aria-hidden="true">›</span><span>{selectedFieldLabel}</span>
          {/if}
        </div>
      </div>
      <div class="connection-state">
        <span class:problem={status !== "Connected"}>{status}</span>
        <button type="button" onclick={changeConnection}
          >Change connection</button
        >
      </div>
      {#if error}<strong class="header-error">{error}</strong>{/if}
    </header>

    <aside class="topics panel">
      <header>
        <h2>
          Topics <span class="count">({directTopicCount.toLocaleString()})</span
          >
        </h2>
        <span class="meta" title={route.filters.join("\n")}
          >{route.filters.join(", ")}</span
        >
      </header>
      <div class="topic-tree">
        {#if topicSnapshot.roots.length}
          <TreeView
            roots={topicSnapshot.roots}
            nodes={topicSnapshot.nodes}
            selected={selectedTopicId}
            expanded={topicExpanded}
            label="MQTT topics"
            onselect={selectTopic}
            ontoggle={toggleTopic}
          />
        {:else}
          <p class="empty">Waiting for messages…</p>
        {/if}
      </div>
    </aside>

    <section class="details">
      <MessagePanel
        message={currentMessage}
        snapshot={jsonSnapshot}
        selected={selectedJsonId}
        expanded={jsonExpanded}
        onselect={selectJson}
        ontoggle={toggleJson}
      />
      <HistoryTable
        messages={currentHistory}
        selectedId={selectedMessageId}
        field={selectedField}
        onselect={selectHistory}
        onlatest={selectLatest}
      />
      <TelemetryPlot {points} label={selectedFieldLabel} />
    </section>
  </main>
{/if}
