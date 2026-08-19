<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import ConnectionForm from "./ConnectionForm.svelte";
  import HistoryLimit from "./HistoryLimit.svelte";
  import HistoryTable from "./HistoryTable.svelte";
  import MessagePanel from "./MessagePanel.svelte";
  import TelemetryPlot from "./TelemetryPlot.svelte";
  import TreeView from "./TreeView.svelte";
  import {
    TelemetryStore,
    fieldLabel,
    jsonPointer,
    jsonTree,
    plotSeries,
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
  let viewToken = crypto.randomUUID();
  let lastReceivedAt = 0;
  let renderFrame = 0;

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
  let selectedDescendantCount = $derived(
    Math.max(0, selectedSubtreeCount - currentHistory.length),
  );
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
  let series = $derived(
    activeField
      ? plotSeries(currentHistory, activeField)
      : { points: [], retainedExcluded: 0 },
  );
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

  onMount(() => {
    const popstate = (event: PopStateEvent) => {
      const next = readRoute(location.search);
      if (connectionKey(next) !== connectionKey(route)) {
        route = next;
        formFilters = next.filters.join("\n");
        formHistoryLimit = next.historyLimit;
        if (next.broker !== authBroker) {
          username = "";
          password = "";
          authBroker = next.broker;
        }
        if (next.broker) {
          formBroker = next.broker;
          startConnection(next);
        } else {
          stopConnection();
        }
      } else {
        const historyLimitChanged = next.historyLimit !== route.historyLimit;
        route = next;
        formHistoryLimit = next.historyLimit;
        if (historyLimitChanged) {
          store.setHistoryLimit(next.historyLimit);
          revision += 1;
        }
        restoreView(event.state);
      }
    };
    addEventListener("popstate", popstate);
    addEventListener("keydown", browserKeydown);
    if (route.broker) startConnection(route);
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
    viewToken = crypto.randomUUID();
    lastReceivedAt = 0;
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
    const now = performance.timeOrigin + performance.now();
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

  function startConnection(nextRoute: AppRoute) {
    const serial = ++connectSerial;
    session?.close();
    session = undefined;
    resetData(nextRoute.historyLimit);
    status = "Connecting";
    error = "";
    try {
      const nextSession = MqttSession.open(
        nextRoute.broker,
        nextRoute.filters,
        {
          message: ({ topic, payload, packet }) => {
            if (serial !== connectSerial || packet.cmd !== "publish") return;
            const added = store.add(topic, payload, {
              receivedAt: receiptTime(),
              retained: packet.retain,
              duplicate: packet.dup,
              qos: packet.qos,
            });
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
      selectedTopic: "",
      fieldPointer: null,
    };
    writeRoute(next, null);
    startConnection(next);
  }

  function changeConnection() {
    const previousBroker = route.broker;
    const next = {
      ...route,
      broker: "",
      selectedTopic: "",
      fieldPointer: null,
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
    {status}
    {error}
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
          {#if route.fieldPointer !== null}
            <span aria-hidden="true">›</span><span>{selectedFieldLabel}</span>
          {/if}
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
        <div class="topic-actions">
          <button
            disabled={!currentHistory.length}
            title="Clear local history for the selected topic only. Broker-retained messages are unchanged."
            type="button"
            onclick={clearTopicHistory}>Clear</button
          >
          <button
            disabled={!selectedDescendantCount}
            title="Clear local history for the selected topic and its subtopics. Broker-retained messages are unchanged."
            type="button"
            onclick={clearTopicSubtree}>Clear subtree</button
          >
        </div>
        <HistoryLimit
          value={route.historyLimit}
          onchange={changeHistoryLimit}
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
        onselect={selectJson}
        ontoggle={toggleJson}
      />
      <HistoryTable
        messages={currentHistory}
        selectedId={selectedMessageId}
        field={activeField}
        fieldLabel={selectedFieldLabel}
        onselect={selectHistory}
        onlatest={selectLatest}
      />
      <TelemetryPlot
        points={series.points}
        label={selectedFieldLabel}
        retainedExcluded={series.retainedExcluded}
      />
    </section>
  </main>
{/if}
