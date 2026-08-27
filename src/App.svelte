<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import ConnectionForm from "./ConnectionForm.svelte";
  import HistoryLimit from "./HistoryLimit.svelte";
  import HistoryTable from "./HistoryTable.svelte";
  import MessagePanel from "./MessagePanel.svelte";
  import PlotDashboard, { type DashboardPlot } from "./PlotDashboard.svelte";
  import TreeView from "./TreeView.svelte";
  import {
    TelemetryStore,
    fieldLabel,
    getJsonPath,
    jsonPointer,
    jsonTree,
    plotSeriesPointer,
    resolveJsonPointer,
    telemetryPageTitle,
    type JsonPath,
  } from "./lib/model";
  import { MqttSession, type SessionStatus } from "./lib/mqtt-session";
  import { randomId } from "./lib/random-id";
  import {
    connectionKey,
    isWebSocketBroker,
    MAX_PLOTS,
    readRoute,
    routeSearch,
    uniqueFilters,
    type AppRoute,
    type PlotRef,
  } from "./lib/routes";
  import {
    filterTree,
    selectionAfterCollapse,
    treeAncestorIds,
    type TreeActivity,
  } from "./lib/tree";

  type ViewState = {
    app: "mqtt-telemetry";
    token: string;
    messageId: number | null;
  };

  const initialRoute = readRoute(location.search);
  let route = $state(initialRoute);
  let formBroker = $state(initialRoute.broker);
  let formFilters = $state(initialRoute.filters.join("\n"));
  let formHistoryLimit = $state(initialRoute.historyLimit);
  let formHistoryAgeMs = $state(initialRoute.historyAgeMs);
  let username = $state("");
  let password = $state("");
  let authBroker = initialRoute.broker;

  let session = $state<MqttSession | undefined>();
  let store = $state.raw(new TelemetryStore(initialRoute.historyLimit));
  let revision = $state(0);
  let selectedTopicId = $state("");
  let selectedMessageId = $state<number | null>(null);
  let selectedField = $state<JsonPath | undefined>();
  let fieldByTopic = new Map<string, string | null>();
  let revealedFieldKey = "";
  let topicExpanded = $state(new Set<string>());
  let topicActivity = $state.raw(new Map<string, TreeActivity>());
  let topicSearch = $state("");
  let jsonExpanded = $state(new Set<string>(["$"]));
  const jsonExpandedByTopic = new Map<string, Set<string>>();
  let status = $state("Idle");
  let error = $state("");
  let connectSerial = 0;
  let viewToken = randomId();
  let lastReceivedAt = 0;
  let renderFrame = 0;
  let plotNow = $state(Date.now());

  let topicSnapshot = $derived.by(() => {
    revision;
    return store.snapshot();
  });
  let topicFilter = $derived(
    filterTree(topicSnapshot.roots, topicSnapshot.nodes, topicSearch),
  );
  let visibleTopics = $derived(
    topicSearch.trim() ? topicFilter : topicSnapshot,
  );
  let visibleTopicExpanded = $derived(
    topicSearch.trim()
      ? new Set([...topicExpanded, ...topicFilter.expanded])
      : topicExpanded,
  );
  let selectedTopic = $derived(store.topic(selectedTopicId) ?? "");
  let selectedSubtreeCount = $derived.by(() => {
    revision;
    return selectedTopicId ? store.subtreeMessageCount(selectedTopicId) : 0;
  });
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
  let activeField = $derived.by(() => {
    if (route.fieldPointer === null || !selectedField) return undefined;
    return jsonPointer(selectedField) === route.fieldPointer
      ? selectedField
      : undefined;
  });
  let selectedJsonId = $derived(
    route.fieldPointer === null
      ? ""
      : activeField
        ? jsonPointer(activeField) || "$"
        : route.fieldPointer || "$",
  );
  let checkableJson = $derived.by(() => {
    const ids = new Set<string>();
    if (currentMessage?.payload.kind !== "json" || !jsonSnapshot) return ids;
    for (const [id, path] of jsonSnapshot.paths) {
      const value = getJsonPath(currentMessage.payload.value, path);
      if (typeof value === "number" && Number.isFinite(value)) ids.add(id);
    }
    return ids;
  });
  let checkedJson = $derived(
    new Set(
      route.plots
        .filter((plot) => plot.topic === selectedTopic)
        .map((plot) => plot.pointer || "$"),
    ),
  );
  let plotLimitReached = $derived(route.plots.length >= MAX_PLOTS);
  let selectedValuePlotCount = $derived.by(() => {
    if (!jsonSnapshot?.nodes.get(selectedJsonId)?.children.length) return 0;
    const pointer = selectedJsonId === "$" ? "" : selectedJsonId;
    return route.plots.filter(
      (plot) =>
        plot.topic === selectedTopic && pointerContains(pointer, plot.pointer),
    ).length;
  });
  let selectedTopicPlotCount = $derived(
    selectedTopicId
      ? route.plots.filter((plot) => plot.topic === selectedTopic).length
      : 0,
  );
  let selectedTopicSubtreePlotCount = $derived(
    selectedTopicId
      ? route.plots.filter((plot) => topicContains(selectedTopic, plot.topic))
          .length
      : 0,
  );
  let dashboardPlots = $derived.by(() => {
    revision;
    return route.plots.map<DashboardPlot>((plot) => {
      const nodeId = store.nodeId(plot.topic);
      const history = nodeId ? store.history(nodeId) : [];
      const series = plotSeriesPointer(history, plot.pointer);
      let label = plot.pointer || "$";
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const payload = history[index].payload;
        if (payload.kind !== "json") continue;
        const path = resolveJsonPointer(payload.value, plot.pointer);
        if (path) {
          label = fieldLabel(path);
          break;
        }
      }
      return {
        ...plot,
        key: plotKey(plot),
        label,
        ...series,
      };
    });
  });
  let selectedFieldLabel = $derived(
    route.fieldPointer === null
      ? undefined
      : activeField
        ? fieldLabel(activeField)
        : route.fieldPointer || "$",
  );
  let topicWarning = $derived(
    [
      topicSnapshot.droppedMessages
        ? `${topicSnapshot.droppedMessages.toLocaleString()} dropped`
        : "",
      topicSnapshot.evictedMessages
        ? `${topicSnapshot.evictedMessages.toLocaleString()} globally evicted`
        : "",
      topicSnapshot.omittedPayloads
        ? `${topicSnapshot.omittedPayloads.toLocaleString()} payloads omitted`
        : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  $effect(() => {
    document.title = telemetryPageTitle(selectedTopic, activeField);
  });

  $effect(() => {
    const topic = selectedTopic;
    if (!topic) {
      selectedField = undefined;
      return;
    }
    const pointer =
      route.selectedTopic === topic
        ? route.fieldPointer
        : (fieldByTopic.get(topic) ?? null);
    fieldByTopic.set(topic, pointer);
    if (pointer === null) {
      selectedField = undefined;
      return;
    }
    let resolved: JsonPath | undefined;
    for (let index = currentHistory.length - 1; index >= 0; index -= 1) {
      const payload = currentHistory[index].payload;
      if (payload.kind !== "json") continue;
      resolved = resolveJsonPointer(payload.value, pointer);
      if (resolved) break;
    }
    if (resolved) {
      if (
        !selectedField ||
        jsonPointer(resolved) !== jsonPointer(selectedField)
      )
        selectedField = resolved;
      const id = jsonPointer(resolved) || "$";
      const revealKey = `${topic}\0${pointer}`;
      if (jsonSnapshot?.nodes.has(id) && revealedFieldKey !== revealKey) {
        revealedFieldKey = revealKey;
        revealJson(id);
      }
    } else {
      selectedField = undefined;
    }
  });

  $effect(() => {
    const id = selectedMessageId;
    if (id !== null && !currentHistory.some((message) => message.id === id)) {
      selectedMessageId = null;
      replaceRoute(route, null);
    }
  });

  $effect(() => {
    const clockNeeded = route.historyAgeMs !== null || route.plots.length > 0;
    if (!clockNeeded) return;
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      plotNow = now;
      if (
        route.historyAgeMs !== null &&
        store.expireBefore(now - route.historyAgeMs)
      )
        revision += 1;
      timer = window.setTimeout(tick, Math.max(50, 1000 - (now % 1000)));
    };
    tick();
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const popstate = (event: PopStateEvent) => {
      const next = readRoute(location.search);
      if (connectionKey(next) !== connectionKey(route)) {
        route = next;
        formFilters = next.filters.join("\n");
        formHistoryLimit = next.historyLimit;
        formHistoryAgeMs = next.historyAgeMs;
        if (next.broker !== authBroker) {
          username = "";
          password = "";
          authBroker = next.broker;
        }
        if (next.broker) {
          formBroker = next.broker;
          void startConnection(next);
        } else {
          stopConnection();
        }
      } else {
        const historyLimitChanged = next.historyLimit !== route.historyLimit;
        route = next;
        formHistoryLimit = next.historyLimit;
        formHistoryAgeMs = next.historyAgeMs;
        if (historyLimitChanged) {
          store.setHistoryLimit(next.historyLimit);
          revision += 1;
        }
        restoreView(event.state);
      }
    };
    addEventListener("popstate", popstate);
    addEventListener("keydown", browserKeydown);
    if (route.broker) void startConnection(route);
    return () => {
      removeEventListener("popstate", popstate);
      removeEventListener("keydown", browserKeydown);
      if (renderFrame) cancelAnimationFrame(renderFrame);
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

  function resetData(historyLimit: number) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    store = new TelemetryStore(historyLimit);
    revision += 1;
    selectedTopicId = "";
    selectedMessageId = null;
    selectedField = undefined;
    fieldByTopic = new Map();
    revealedFieldKey = "";
    topicExpanded = new Set();
    topicActivity = new Map();
    topicSearch = "";
    jsonExpanded = new Set(["$"]);
    jsonExpandedByTopic.clear();
    viewToken = randomId();
    lastReceivedAt = 0;
    plotNow = Date.now();
  }

  function stopConnection() {
    connectSerial += 1;
    session?.close();
    session = undefined;
    status = "Idle";
    error = "";
    resetData(route.historyLimit);
  }

  function statusChanged(next: SessionStatus) {
    switch (next.state) {
      case "connected":
        status = "Connected";
        error = next.rejected.length
          ? `Subscription rejected: ${next.rejected.join(", ")}`
          : "";
        break;
      case "reconnecting":
        status = "Reconnecting";
        break;
      case "offline":
        status = "Disconnected";
        break;
      case "error":
        status = "Connection error";
        error = next.error;
        break;
    }
  }

  function receiptTime(): number {
    const now = Date.now();
    lastReceivedAt = Math.max(now, lastReceivedAt + 0.001);
    return lastReceivedAt;
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      revision += 1;
    });
  }

  async function startConnection(nextRoute: AppRoute) {
    const serial = ++connectSerial;
    session?.close();
    session = undefined;
    resetData(nextRoute.historyLimit);
    status = "Connecting";
    error = "";
    try {
      const nextSession = await MqttSession.connect(
        nextRoute.broker,
        nextRoute.filters,
        {
          message: ({ topic, payload, packet, segment }) => {
            if (serial !== connectSerial || packet.cmd !== "publish") return;
            const receivedAt = receiptTime();
            const added = store.add(topic, payload, {
              receivedAt,
              segment,
              retained: packet.retain,
              duplicate: packet.dup,
              qos: packet.qos,
            });
            if (route.historyAgeMs !== null)
              store.expireBefore(receivedAt - route.historyAgeMs);
            plotNow = Date.now();
            scheduleRender();
            if (!added) return;
            const activity = {
              at: performance.now(),
            };
            topicActivity.set(added.nodeId, activity);
            if (route.selectedTopic === topic) {
              selectLoadedTopic(added.nodeId, false);
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
      restoreView(history.state);
    } catch (caught) {
      if (serial !== connectSerial) return;
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
    authBroker = broker;
    const next: AppRoute = {
      broker,
      filters,
      historyLimit: formHistoryLimit,
      historyAgeMs: formHistoryAgeMs,
      selectedTopic: "",
      fieldPointer: null,
      plots: [],
    };
    writeRoute(next, null);
    void startConnection(next);
  }

  function changeConnection() {
    const previousBroker = route.broker;
    const next = {
      ...route,
      broker: "",
      selectedTopic: "",
      fieldPointer: null,
      plots: [],
    };
    writeRoute(next, null);
    stopConnection();
    formBroker = previousBroker;
  }

  function selectLoadedTopic(id: string, reset: boolean) {
    const changed = selectedTopicId !== id;
    const previousTopic = selectedTopic;
    const nextTopic = store.topic(id) ?? "";
    if (changed) {
      if (previousTopic) jsonExpandedByTopic.set(previousTopic, jsonExpanded);
      jsonExpanded = new Set(jsonExpandedByTopic.get(nextTopic) ?? ["$"]);
    }
    selectedTopicId = id;
    if (changed || reset)
      topicExpanded = new Set([...topicExpanded, ...store.ancestorIds(id)]);
    if (reset) {
      selectedMessageId = null;
      selectedField = undefined;
      revealedFieldKey = "";
    }
  }

  function selectTopic(id: string) {
    const topic = store.topic(id);
    if (topic === undefined) return;
    let pointer: string | null;
    if (fieldByTopic.has(topic))
      pointer = fieldByTopic.get(topic) as string | null;
    else if (fieldByTopic.has(selectedTopic))
      pointer = fieldByTopic.get(selectedTopic) as string | null;
    else pointer = route.fieldPointer;
    const unchanged =
      id === selectedTopicId &&
      selectedMessageId === null &&
      route.selectedTopic === topic &&
      route.fieldPointer === pointer;
    fieldByTopic.set(topic, pointer);
    selectLoadedTopic(id, true);
    if (!unchanged)
      writeRoute(
        { ...route, selectedTopic: topic, fieldPointer: pointer },
        null,
      );
  }

  function toggleTopic(id: string, open: boolean) {
    if (!open) {
      const selected = selectionAfterCollapse(
        selectedTopicId,
        id,
        topicSnapshot.nodes,
      );
      if (selected !== selectedTopicId) selectTopic(selected);
    }
    const next = new Set(topicExpanded);
    if (open) next.add(id);
    else next.delete(id);
    topicExpanded = next;
  }

  function selectJson(id: string) {
    const path = jsonSnapshot?.paths.get(id);
    if (!path) return;
    const pointer = jsonPointer(path);
    selectedField = path;
    fieldByTopic.set(selectedTopic, pointer);
    revealedFieldKey = `${selectedTopic}\0${pointer}`;
    revealJson(id);
    if (route.fieldPointer !== pointer)
      writeRoute({ ...route, fieldPointer: pointer }, selectedMessageId);
  }

  function revealJson(id: string) {
    const ancestors = jsonSnapshot
      ? treeAncestorIds(id, jsonSnapshot.nodes)
      : [];
    if (ancestors.some((ancestor) => !jsonExpanded.has(ancestor)))
      rememberJsonExpansion(new Set([...jsonExpanded, ...ancestors]));
  }

  function rememberJsonExpansion(expanded: Set<string>) {
    jsonExpanded = expanded;
    if (selectedTopic) jsonExpandedByTopic.set(selectedTopic, expanded);
  }

  function toggleJson(id: string, open: boolean) {
    if (!open && jsonSnapshot) {
      const selected = selectionAfterCollapse(
        selectedJsonId,
        id,
        jsonSnapshot.nodes,
      );
      if (selected !== selectedJsonId) selectJson(selected);
    }
    const next = new Set(jsonExpanded);
    if (open) next.add(id);
    else next.delete(id);
    rememberJsonExpansion(next);
  }

  function selectHistory(messageId: number) {
    selectedMessageId = messageId;
    writeRoute(route, messageId);
  }

  function selectLatest() {
    selectedMessageId = null;
    writeRoute(route, null);
  }

  function changeHistoryLimit(limit: number): boolean {
    if (limit === route.historyLimit) return true;
    store.setHistoryLimit(limit);
    formHistoryLimit = limit;
    revision += 1;
    const id = selectedMessageId;
    const nextMessageId = currentHistory.some((message) => message.id === id)
      ? id
      : null;
    selectedMessageId = nextMessageId;
    writeRoute({ ...route, historyLimit: limit }, nextMessageId);
    return true;
  }

  function changeHistoryAge(ageMs: number | null): boolean {
    if (ageMs === route.historyAgeMs) return true;
    formHistoryAgeMs = ageMs;
    plotNow = Date.now();
    if (ageMs !== null && store.expireBefore(plotNow - ageMs)) revision += 1;
    writeRoute({ ...route, historyAgeMs: ageMs }, selectedMessageId);
    return true;
  }

  function plotKey(plot: PlotRef): string {
    return JSON.stringify([plot.topic, plot.pointer]);
  }

  function pointerContains(parent: string, candidate: string): boolean {
    return (
      !parent || candidate === parent || candidate.startsWith(`${parent}/`)
    );
  }

  function topicContains(parent: string, candidate: string): boolean {
    return candidate === parent || candidate.startsWith(`${parent}/`);
  }

  function togglePlot(id: string) {
    const path = jsonSnapshot?.paths.get(id);
    if (!path || !selectedTopic) return;
    const plot = { topic: selectedTopic, pointer: jsonPointer(path) };
    const key = plotKey(plot);
    const pinned = route.plots.some((current) => plotKey(current) === key);
    if (!pinned && route.plots.length >= MAX_PLOTS) return;
    const plots = pinned
      ? route.plots.filter((current) => plotKey(current) !== key)
      : [...route.plots, plot];
    writeRoute({ ...route, plots }, selectedMessageId);
  }

  function removePlots(predicate: (plot: PlotRef) => boolean) {
    const plots = route.plots.filter((plot) => !predicate(plot));
    if (plots.length !== route.plots.length)
      writeRoute({ ...route, plots }, selectedMessageId);
  }

  function removeSelectedValuePlots() {
    const pointer = selectedJsonId === "$" ? "" : selectedJsonId;
    removePlots(
      (plot) =>
        plot.topic === selectedTopic && pointerContains(pointer, plot.pointer),
    );
  }

  function removeTopicPlots() {
    if (!selectedTopicId) return;
    removePlots((plot) => plot.topic === selectedTopic);
  }

  function removeTopicSubtreePlots() {
    if (!selectedTopicId) return;
    removePlots((plot) => topicContains(selectedTopic, plot.topic));
  }

  function focusPlot(plot: PlotRef) {
    const id = store.nodeId(plot.topic);
    if (id) selectLoadedTopic(id, true);
    else selectedTopicId = "";
    fieldByTopic.set(plot.topic, plot.pointer);
    writeRoute(
      {
        ...route,
        selectedTopic: plot.topic,
        fieldPointer: plot.pointer,
      },
      null,
    );
  }

  function clearTopicSubtree() {
    if (!selectedTopicId) return;
    store.clearSubtree(selectedTopicId);
    selectedMessageId = null;
    revision += 1;
    replaceRoute(route, null);
  }

  function clearTopicHistory() {
    if (!selectedTopicId) return;
    store.clearHistory(selectedTopicId);
    selectedMessageId = null;
    revision += 1;
    replaceRoute(route, null);
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

  function topicSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      topicSearch = "";
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Enter") {
      const first = topicFilter.matches[0];
      if (first) selectTopic(first);
    }
  }

  function browserKeydown(event: KeyboardEvent) {
    if (
      event.key !== "/" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    event.preventDefault();
    document.querySelector<HTMLInputElement>("#topic-search")?.focus();
  }
</script>

{#if !session}
  <ConnectionForm
    bind:broker={formBroker}
    bind:filters={formFilters}
    bind:username
    bind:password
    bind:historyLimit={formHistoryLimit}
    bind:historyAgeMs={formHistoryAgeMs}
    {status}
    {error}
    connecting={status === "Connecting"}
    onconnect={connectFromForm}
  />
{:else}
  <main class="browser">
    <header class="app-header panel">
      <div class="identity">
        <h1>MQTT Telemetry</h1>
        <div class="breadcrumb" aria-label="Current browsing path">
          <span>{route.broker}</span>
          {#if selectedTopic}<span aria-hidden="true">›</span><span
              >{selectedTopic}</span
            >{/if}
        </div>
      </div>
      <div class="connection-state">
        <span aria-live="polite" class:problem={status !== "Connected"}
          >{status}</span
        >
        <button type="button" onclick={changeConnection}
          >Change connection</button
        >
      </div>
      {#if error}<strong class="header-error">{error}</strong>{/if}
    </header>

    <aside class="topics panel">
      <header>
        <h2>
          Topics <span class="count"
            >({topicSnapshot.topicCount.toLocaleString()})</span
          >
        </h2>
        <span class="meta" title={route.filters.join("\n")}
          >{route.filters.join(", ")}</span
        >
        {#if topicWarning}
          <span class="meta problem" title="Browser safety limits applied">
            {topicWarning}
          </span>
        {/if}
      </header>
      <div class="topic-policy">
        <div class="topic-action-groups">
          <div class="topic-actions">
            <span class="meta">History</span>
            <button
              disabled={!currentHistory.length}
              title="Clear local history for the selected topic only. Broker-retained messages are unchanged."
              type="button"
              onclick={clearTopicHistory}>Clear topic</button
            >
            <button
              disabled={!selectedSubtreeCount}
              title="Clear local history for the selected topic and its subtopics. Broker-retained messages are unchanged."
              type="button"
              onclick={clearTopicSubtree}>Clear subtree</button
            >
          </div>
          <div class="topic-actions">
            <span class="meta">Plots</span>
            <button
              disabled={!selectedTopicPlotCount}
              type="button"
              onclick={removeTopicPlots}>Remove topic</button
            >
            <button
              disabled={!selectedTopicSubtreePlotCount}
              type="button"
              onclick={removeTopicSubtreePlots}>Remove subtree</button
            >
          </div>
        </div>
        <HistoryLimit
          value={route.historyLimit}
          onchange={changeHistoryLimit}
          ageMs={route.historyAgeMs}
          onagechange={changeHistoryAge}
        />
      </div>
      <div class="topic-search">
        <input
          aria-label="Search topic paths"
          id="topic-search"
          onkeydown={topicSearchKeydown}
          placeholder="Search topics  /"
          type="search"
          bind:value={topicSearch}
        />
        {#if topicSearch.trim()}
          <span class="meta">
            {topicFilter.matches.length.toLocaleString()}
            {topicFilter.matches.length === 1 ? "match" : "matches"}
          </span>
        {/if}
      </div>
      <div class="topic-tree">
        {#if visibleTopics.roots.length}
          <TreeView
            roots={visibleTopics.roots}
            nodes={visibleTopics.nodes}
            revision={topicSnapshot.revision}
            selected={selectedTopicId}
            expanded={visibleTopicExpanded}
            activity={topicActivity}
            label="MQTT topics"
            onselect={selectTopic}
            ontoggle={toggleTopic}
          />
        {:else if topicSearch.trim()}
          <p class="empty">No matching topics.</p>
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
        selectedLabel={selectedFieldLabel}
        following={selectedMessageId === null}
        expanded={jsonExpanded}
        checkable={checkableJson}
        checked={checkedJson}
        checkDisabled={plotLimitReached}
        subtreePlotCount={selectedValuePlotCount}
        onselect={selectJson}
        ontoggle={toggleJson}
        oncheck={togglePlot}
        onremoveplots={removeSelectedValuePlots}
      />
      <HistoryTable
        messages={currentHistory}
        selectedId={selectedMessageId}
        field={activeField}
        fieldLabel={selectedFieldLabel}
        onselect={selectHistory}
        onlatest={selectLatest}
      />
      <PlotDashboard
        plots={dashboardPlots}
        now={plotNow}
        ageMs={route.historyAgeMs}
        onfocus={focusPlot}
        onremove={(plot) =>
          removePlots((current) => plotKey(current) === plotKey(plot))}
        onremoveall={() => removePlots(() => true)}
      />
    </section>
  </main>
{/if}
