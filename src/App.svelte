<svelte:options runes={true} />

<script lang="ts">
  import { restoreAuth } from "./lib/session-auth";
  import { onMount } from "svelte";
  import ConnectionEditor from "./ConnectionEditor.svelte";
  import DashboardActions from "./DashboardActions.svelte";
  import DurationSelect from "./DurationSelect.svelte";
  import HistoryPolicy from "./HistoryPolicy.svelte";
  import HistoryTable from "./HistoryTable.svelte";
  import MessagePanel from "./MessagePanel.svelte";
  import PlotDashboard, { type DashboardPlot } from "./PlotDashboard.svelte";
  import TreeView from "./TreeView.svelte";
  import {
    fieldLabel,
    getJsonPath,
    jsonPath,
    jsonTree,
    parseJsonPath,
    telemetryPageTitle,
  } from "./lib/json";
  import { TelemetryStore } from "./lib/telemetry";
  import type { DisplayTimeZone } from "./lib/time";
  import { Connection, type ConnectionTarget } from "./lib/connection.svelte";
  import type { SessionAuth } from "./lib/mqtt-session";
  import { topicMatchesFilter } from "./lib/mqtt-filter";
  import { randomId } from "./lib/random-id";
  import {
    readInlineDashboard,
    resolveStartupRoute,
    routeFromDashboard,
    type Dashboard,
  } from "./lib/dashboard";
  import {
    defaultRoute,
    isWebSocketBroker,
    launchUrl,
    MAX_PLOTS,
    readLaunchRoute,
    type AppRoute,
    type PlotRef,
  } from "./lib/routes";
  import {
    browserViewState,
    messageIdFromViewState,
    routeFromViewState,
  } from "./lib/view-state";
  import {
    filterTopicTree,
    selectionAfterCollapse,
    treeAncestorIds,
    type TreeActivity,
  } from "./lib/tree";

  // Keep receipt times, plot windows, and expiration on the same monotonic clock.
  const clockOrigin = Date.now() - performance.now();
  const telemetryNow = () => clockOrigin + performance.now();

  const inlineDashboard = readInlineDashboard(location.hash);
  const launchRoute = readLaunchRoute(location);
  const storedRoute = routeFromViewState(history.state);
  const startup = resolveStartupRoute(
    inlineDashboard,
    launchRoute,
    storedRoute,
  );
  const initialRoute = startup.route;
  const initialAuth = restoreAuth(initialRoute.broker);
  const credentialsRequired =
    storedRoute?.broker === initialRoute.broker &&
    history.state?.credentialsRequired === true;
  const buildCommit = __BUILD_COMMIT__;
  const exactBuildCommit = /^[0-9a-f]{40}$/i.test(buildCommit);
  const buildLabel = exactBuildCommit
    ? `build ${buildCommit.slice(0, 8)}`
    : "local build";
  const buildUrl = exactBuildCommit
    ? `https://github.com/quartiq/mqtt-telemetry/commit/${buildCommit}`
    : undefined;
  let route = $state(initialRoute);

  const connection = new Connection({
    message: ({ topic, payload, packet, segment }) => {
      if (packet.cmd !== "publish") return;
      const previous = segments.get(topic);
      const historySegment =
        previous?.transport === segment ? previous.id : ++lastSegment;
      const added = store.add(topic, payload, {
        receivedAt: telemetryNow(),
        segment: historySegment,
        retained: packet.retain,
        duplicate: packet.dup,
      });
      if (!added) return;
      segments.set(topic, { transport: segment, id: historySegment });
      const ancestors = store.ancestorIds(added.nodeId);
      const root = ancestors.at(-1);
      if (root && !autoExpandedTopicRoots.has(root)) {
        autoExpandedTopicRoots.add(root);
        topicExpanded = new Set([...topicExpanded, root]);
      }
      const activity = { at: performance.now() };
      for (const id of [added.nodeId, ...ancestors])
        activityByTopic.set(id, activity);
      if (route.selectedTopic === topic) selectLoadedTopic(added.nodeId, false);
    },
    starting: () => segments.clear(),
    subscribed: (accepted) => {
      for (const topic of segments.keys())
        if (!accepted.some((filter) => topicMatchesFilter(topic, filter)))
          segments.delete(topic);
    },
    ready: () => restoreView(history.state),
    failed: () => editConnection(),
  });
  let store = $state.raw(new TelemetryStore(initialRoute.historyLimit));
  let selectedTopicId = $state("");
  let selectedMessageId = $state<number | null>(null);
  let fieldByTopic = new Map<string, string | null>();
  let revealedFieldKey = "";
  let topicExpanded = $state(new Set<string>());
  let autoExpandedTopicRoots = new Set<string>();
  let activityByTopic = new Map<string, TreeActivity>();
  let topicActivity = $derived.by(() => {
    topicSnapshot;
    return new Map(activityByTopic);
  });
  let topicSearch = $state("");
  let historyExpanded = $state(false);
  let jsonExpanded = $state(new Set<string>(["$"]));
  const jsonExpandedByTopic = new Map<string, Set<string>>();
  let connectionState = $derived(connection.state);
  let status = $derived(
    {
      idle: "Not connected",
      connecting: "Connecting",
      connected: "Connected",
      offline: "Reconnecting",
      reconnecting: "Reconnecting",
      restoring: "Restoring subscriptions",
      updating: "Updating subscriptions",
      failed: "Connection failed",
      error: "Connection error",
    }[connectionState],
  );
  let error = $state(startup.error);
  let connectionError = $derived(connection.error);
  let connectionNotice = $derived(connection.notice);
  let editingConnection = $state(!initialRoute.broker);
  let viewToken = randomId();
  let lastSegment = 0;
  const segments = new Map<string, { transport: number; id: number }>();
  let plotNow = $state(telemetryNow());

  if (location.search || location.hash || !storedRoute)
    history.replaceState(
      {
        ...browserViewState(initialRoute, viewToken, null),
        credentialsRequired:
          credentialsRequired ||
          Boolean(initialAuth?.username || initialAuth?.password),
      },
      "",
      launchRoute.kind === "invalid" && inlineDashboard.kind === "absent"
        ? location.href
        : launchUrl(initialRoute, location),
    );

  let topicSnapshot = $derived($store.snapshot());
  $effect(() => {
    topicSnapshot;
    plotNow = telemetryNow();
  });
  let topicFilter = $derived(
    filterTopicTree(topicSnapshot.roots, topicSnapshot.nodes, topicSearch),
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
  let statusProblem = $derived(
    connectionState === "offline" ||
      connectionState === "error" ||
      connectionState === "failed",
  );
  let selectedSubtreeCount = $derived(
    selectedTopicId ? $store.subtreeMessageCount(selectedTopicId) : 0,
  );
  let currentHistory = $derived(
    selectedTopicId ? $store.history(selectedTopicId) : [],
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
  let selectedFieldPath = $derived(
    selectedTopic
      ? route.selectedTopic === selectedTopic
        ? route.fieldPath
        : (fieldByTopic.get(selectedTopic) ?? null)
      : null,
  );
  let activeField = $derived(
    selectedFieldPath === null ? undefined : parseJsonPath(selectedFieldPath),
  );
  let selectedJsonId = $derived(selectedFieldPath ?? "");
  let checkedJson = $derived(
    new Set(
      route.plots
        .filter((plot) => plot.topic === selectedTopic)
        .map((plot) => plot.path),
    ),
  );
  let checkableJson = $derived.by(() => {
    const ids = new Set(checkedJson);
    if (currentMessage?.payload.kind !== "json" || !jsonSnapshot) return ids;
    for (const [id, path] of jsonSnapshot.paths) {
      const value = getJsonPath(currentMessage.payload.value, path);
      if (typeof value === "number" && Number.isFinite(value)) ids.add(id);
    }
    return ids;
  });
  let plotLimitReached = $derived(route.plots.length >= MAX_PLOTS);
  let checkedTopics = $derived.by(() => {
    return new Set(
      route.plots
        .filter((plot) => plot.path === "$")
        .flatMap((plot) => {
          const id = $store.nodeId(plot.topic);
          return id === undefined ? [] : [id];
        }),
    );
  });
  let checkableTopics = $derived(
    new Set([
      ...checkedTopics,
      ...[...topicSnapshot.nodes]
        .filter(([, node]) => node.numeric)
        .map(([id]) => id),
    ]),
  );
  let selectedValuePlotCount = $derived.by(() => {
    if (!jsonSnapshot?.nodes.get(selectedJsonId)?.children.length) return 0;
    const path = selectedJsonId;
    return route.plots.filter(
      (plot) => plot.topic === selectedTopic && pathContains(path, plot.path),
    ).length;
  });
  let dashboardPlots = $derived.by(() => {
    return route.plots.map<DashboardPlot>((plot) => {
      const nodeId = $store.nodeId(plot.topic);
      const series = nodeId
        ? $store.plotSeries(nodeId, plot.path)
        : { points: [], retainedExcluded: 0 };
      const label = fieldLabel(parseJsonPath(plot.path) ?? []);
      return {
        ...plot,
        key: plotKey(plot),
        label,
        ...series,
      };
    });
  });
  let selectedFieldLabel = $derived(
    selectedFieldPath === null
      ? undefined
      : activeField
        ? fieldLabel(activeField)
        : selectedFieldPath,
  );
  let topicWarning = $derived(
    topicSnapshot.collectionStopped
      ? ""
      : topicSnapshot.topicsOmitted
        ? "Topics omitted. Narrow subscriptions, then reset collected data."
        : topicSnapshot.historyLimited
          ? "History trimmed; latest values kept."
          : "",
  );

  $effect(() => {
    document.title = telemetryPageTitle(selectedTopic, activeField);
  });

  $effect(() => {
    const topic = selectedTopic;
    const path = selectedFieldPath;
    if (!topic) return;
    fieldByTopic.set(topic, path);
    if (path === null || !activeField) return;
    const id = jsonPath(activeField);
    const revealKey = `${topic}\0${path}`;
    if (jsonSnapshot?.nodes.has(id) && revealedFieldKey !== revealKey) {
      revealedFieldKey = revealKey;
      revealJson(id);
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
      const now = telemetryNow();
      plotNow = now;
      if (route.historyAgeMs !== null)
        store.expireBefore(now - route.historyAgeMs);
      timer = window.setTimeout(tick, Math.max(50, 1000 - (now % 1000)));
    };
    tick();
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const popstate = (event: PopStateEvent) => {
      applyConfiguration(routeFromViewState(event.state) ?? defaultRoute(), {
        viewState: event.state,
        credentialsRequired: event.state?.credentialsRequired === true,
      });
    };
    addEventListener("popstate", popstate);
    addEventListener("keydown", browserKeydown);
    applyConfiguration(route, {
      auth: initialAuth,
      credentialsRequired,
      viewState: history.state,
    });
    if (startup.error) error = startup.error;
    return () => {
      removeEventListener("popstate", popstate);
      removeEventListener("keydown", browserKeydown);
      connection.close();
    };
  });

  function writeRoute(
    next: AppRoute,
    messageId: number | null,
    replace = false,
  ) {
    route = next;
    const method = replace ? "replaceState" : "pushState";
    history[method](
      {
        ...browserViewState(next, viewToken, messageId),
        credentialsRequired:
          connection.needsCredentials ||
          Boolean(connection.auth.username || connection.auth.password),
      },
      "",
      launchUrl(next, location),
    );
  }

  function replaceRoute(next: AppRoute, messageId: number | null) {
    writeRoute(next, messageId, true);
  }

  // Every external configuration entry point uses this transition. UI-only route
  // edits still write history directly; they cannot replace a connection.
  function applyConfiguration(
    next: AppRoute,
    options: {
      auth?: SessionAuth;
      credentialsRequired?: boolean;
      viewState?: unknown;
      pushHistory?: boolean;
      messageId?: number | null;
    } = {},
  ) {
    const brokerError = next.broker
      ? isWebSocketBroker(next.broker)
      : undefined;
    if (brokerError) {
      error = brokerError;
      editingConnection = true;
      return;
    }
    const brokerChanged = next.broker !== route.broker;
    const limitChanged = next.historyLimit !== route.historyLimit;
    route = next;
    error = "";
    editingConnection = false;
    if (brokerChanged) resetData(next.historyLimit);
    else if (limitChanged) store.setHistoryLimit(next.historyLimit);
    if (next.historyAgeMs !== null)
      store.expireBefore(telemetryNow() - next.historyAgeMs);
    void connection.apply(next, {
      auth: options.auth,
      credentialsRequired: options.credentialsRequired,
    });
    if (connection.needsCredentials || !next.broker) editingConnection = true;
    if (options.pushHistory)
      writeRoute(
        next,
        brokerChanged
          ? null
          : options.messageId === undefined
            ? selectedMessageId
            : options.messageId,
      );
    restoreView(options.viewState ?? history.state);
  }

  function applyDashboard(dashboard: Dashboard) {
    const next = routeFromDashboard(dashboard);
    const brokerError = isWebSocketBroker(next.broker);
    if (brokerError) throw new Error(brokerError);
    applyConfiguration(next, { pushHistory: true, messageId: null });
  }

  function resetData(historyLimit: number) {
    store = new TelemetryStore(historyLimit);
    selectedTopicId = "";
    selectedMessageId = null;
    fieldByTopic = new Map();
    revealedFieldKey = "";
    topicExpanded = new Set();
    autoExpandedTopicRoots = new Set();
    activityByTopic = new Map();
    topicSearch = "";
    jsonExpanded = new Set(["$"]);
    jsonExpandedByTopic.clear();
    viewToken = randomId();
    lastSegment = 0;
    segments.clear();
    plotNow = telemetryNow();
  }

  function applyConnection(target: ConnectionTarget, auth: SessionAuth) {
    const sameBroker = target.broker === route.broker;
    applyConfiguration(
      {
        ...route,
        ...target,
        ...(sameBroker
          ? {}
          : { selectedTopic: "", fieldPath: null, plots: [] }),
      },
      { auth, pushHistory: true },
    );
  }

  function editConnection() {
    error = "";
    editingConnection = true;
  }

  function cancelConnectionEdit() {
    error = "";
    editingConnection = false;
  }

  function changeTimeZone(event: Event) {
    const timeZone = (event.currentTarget as HTMLSelectElement)
      .value as DisplayTimeZone;
    if (timeZone !== "local" && timeZone !== "utc") return;
    writeRoute({ ...route, timeZone }, selectedMessageId);
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
    if (changed || reset) {
      topicExpanded = new Set([...topicExpanded, ...store.ancestorIds(id)]);
      revealTopic(id);
    }
    if (reset) {
      selectedMessageId = null;
      revealedFieldKey = "";
    }
  }

  function revealTopic(id: string) {
    if (topicSearch.trim() && !topicFilter.nodes.has(id)) topicSearch = "";
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `.topic-tree [data-tree-id="${CSS.escape(id)}"]`,
        )
        ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  }

  function selectTopic(id: string) {
    const topic = store.topic(id);
    if (topic === undefined) return;
    let path: string | null;
    if (fieldByTopic.has(topic))
      path = fieldByTopic.get(topic) as string | null;
    else if (fieldByTopic.has(selectedTopic))
      path = fieldByTopic.get(selectedTopic) as string | null;
    else path = route.fieldPath;
    const unchanged =
      id === selectedTopicId &&
      selectedMessageId === null &&
      route.selectedTopic === topic &&
      route.fieldPath === path;
    fieldByTopic.set(topic, path);
    selectLoadedTopic(id, true);
    if (!unchanged)
      writeRoute({ ...route, selectedTopic: topic, fieldPath: path }, null);
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
    const fieldPath = jsonPath(path);
    fieldByTopic.set(selectedTopic, fieldPath);
    revealedFieldKey = `${selectedTopic}\0${fieldPath}`;
    revealJson(id);
    if (route.fieldPath !== fieldPath)
      writeRoute({ ...route, fieldPath }, selectedMessageId);
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
    plotNow = telemetryNow();
    if (ageMs !== null) store.expireBefore(plotNow - ageMs);
    writeRoute({ ...route, historyAgeMs: ageMs }, selectedMessageId);
    return true;
  }

  function changePlotWindow(windowMs: number | null): boolean {
    if (windowMs === route.plotWindowMs) return true;
    plotNow = telemetryNow();
    writeRoute({ ...route, plotWindowMs: windowMs }, selectedMessageId);
    return true;
  }

  function plotKey(plot: PlotRef): string {
    return JSON.stringify([plot.topic, plot.path]);
  }

  function pathContains(parent: string, candidate: string): boolean {
    const parentPath = parseJsonPath(parent);
    const candidatePath = parseJsonPath(candidate);
    return Boolean(
      parentPath &&
      candidatePath &&
      parentPath.length <= candidatePath.length &&
      parentPath.every((segment, index) => candidatePath[index] === segment),
    );
  }

  function togglePlot(plot: PlotRef) {
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

  function movePlot(plot: PlotRef, offset: -1 | 1) {
    const index = route.plots.findIndex(
      (current) => plotKey(current) === plotKey(plot),
    );
    const target = index + offset;
    if (index < 0 || target < 0 || target >= route.plots.length) return;
    const plots = [...route.plots];
    [plots[index], plots[target]] = [plots[target], plots[index]];
    writeRoute({ ...route, plots }, selectedMessageId);
  }

  function removeSelectedValuePlots() {
    const path = selectedJsonId;
    removePlots(
      (plot) => plot.topic === selectedTopic && pathContains(path, plot.path),
    );
  }

  function focusPlot(plot: PlotRef) {
    const id = store.nodeId(plot.topic);
    if (id) selectLoadedTopic(id, true);
    else selectedTopicId = "";
    fieldByTopic.set(plot.topic, plot.path);
    writeRoute(
      {
        ...route,
        selectedTopic: plot.topic,
        fieldPath: plot.path,
      },
      null,
    );
  }

  function clearTopicSubtree() {
    if (!selectedTopicId) return;
    store.clearSubtree(selectedTopicId);
    selectedMessageId = null;
    replaceRoute(route, null);
  }

  function clearTopicHistory() {
    if (!selectedTopicId) return;
    store.clearHistory(selectedTopicId);
    selectedMessageId = null;
    replaceRoute(route, null);
  }

  function resetCollectedData() {
    resetData(route.historyLimit);
    replaceRoute({ ...route, selectedTopic: "", fieldPath: null }, null);
  }

  function clearAllHistory() {
    if (!topicSnapshot.bufferedMessages) return;
    store.clearAllHistory();
    selectedMessageId = null;
    replaceRoute(route, null);
  }

  function restoreView(state: unknown) {
    const id = route.selectedTopic
      ? store.nodeId(route.selectedTopic)
      : undefined;
    if (id) selectLoadedTopic(id, selectedTopic !== route.selectedTopic);
    else selectedTopicId = "";

    const messageId = messageIdFromViewState(state, viewToken);
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

<main class="browser">
  <header class="app-header panel">
    <div class="identity">
      <h1>
        <button
          aria-label={route.broker
            ? `Connection settings for ${route.broker}; subscriptions ${route.filters.join(", ") || "No subscriptions"}`
            : "Open connection settings"}
          aria-expanded={editingConnection}
          class="connection-disclosure"
          disabled={connection.busy || (editingConnection && !route.broker)}
          title={route.broker
            ? `Connection settings: ${route.broker}\nSubscriptions: ${route.filters.join(", ") || "No subscriptions"}`
            : "Connect to an MQTT broker"}
          type="button"
          onclick={editingConnection && route.broker
            ? cancelConnectionEdit
            : editConnection}
        >
          <span aria-hidden="true" class="disclosure-mark"
            >{editingConnection ? "▾" : "▸"}</span
          >
          <span class="connection-summary">
            <span class="broker-label">{route.broker || "Connect to MQTT"}</span
            >
            {#if route.broker}
              <span class="subscription-label"
                >{route.filters.join(", ") || "No subscriptions"}</span
              >
            {/if}
          </span>
        </button>
      </h1>
    </div>
    <div class="header-controls">
      <div class="connection-state">
        <span aria-live="polite" class:problem={statusProblem}>{status}</span>
        {#if connectionState === "failed" && !editingConnection}
          <button type="button" onclick={() => void connection.reconnect()}
            >Reconnect</button
          >
        {/if}
        <span aria-hidden="true" class="build-separator">·</span>
        {#if buildUrl}
          <a
            class="build-id"
            href={buildUrl}
            rel="noreferrer"
            target="_blank"
            title={`Open source commit ${buildCommit}`}>{buildLabel}</a
          >
        {:else}
          <span
            class="build-id"
            title="No source commit was supplied at build time"
            >{buildLabel}</span
          >
        {/if}
      </div>
      <div class="history-options" aria-label="History policy">
        <HistoryPolicy
          value={route.historyLimit}
          onchange={changeHistoryLimit}
          ageMs={route.historyAgeMs}
          onagechange={changeHistoryAge}
        />
      </div>
      <div class="display-options" aria-label="Display">
        <label class="display-option">
          <span class="meta">Time</span>
          <select
            aria-label="Displayed time zone"
            title="Display receipt times in the browser time zone or UTC"
            value={route.timeZone}
            onchange={changeTimeZone}
          >
            <option value="local">Local</option>
            <option value="utc">UTC</option>
          </select>
        </label>
        <label
          class="display-option"
          title="Changes the plotted interval without deleting history"
        >
          <span class="meta">Show</span>
          <DurationSelect
            ariaLabel="Plot time window"
            noneLabel="all history"
            prefix="last "
            value={route.plotWindowMs}
            onchange={changePlotWindow}
          />
        </label>
      </div>
      <DashboardActions {route} onload={applyDashboard} />
    </div>
    {#if topicSnapshot.collectionStopped}
      <span class="header-notice problem" role="status">
        Collection stopped: storage full. Narrow subscriptions, then reset
        collected data.
      </span>
    {/if}
    {#if error || connectionError}<strong class="header-error"
        >{error || connectionError}</strong
      >{/if}
    {#if connectionNotice}
      <span class="header-notice connection-notice meta" aria-live="polite"
        >{connectionNotice}</span
      >
    {/if}
    {#if editingConnection}
      {#key JSON.stringify([route.broker, route.filters])}
        <ConnectionEditor
          target={route}
          {connection}
          onapply={applyConnection}
          oncancel={cancelConnectionEdit}
        />
      {/key}
    {/if}
  </header>

  <section
    aria-label="Telemetry browsers"
    class:history-expanded={historyExpanded}
    class="browsers"
  >
    <aside class="topics panel">
      <header class="topics-header">
        <h2>
          Topics <span class="count"
            >({topicSnapshot.topicCount.toLocaleString()})</span
          >
        </h2>
        <button
          type="button"
          onclick={resetCollectedData}
          disabled={!topicSnapshot.nodes.size &&
            !topicSnapshot.topicsOmitted &&
            !topicSnapshot.collectionStopped}
          title="Clear collected messages and topics; keep subscriptions and plots"
          >Reset collected data</button
        >
        <div class="topic-search">
          <input
            aria-label="Search topic paths"
            id="topic-search"
            onkeydown={topicSearchKeydown}
            placeholder="Substring or MQTT filter"
            title="Plain text matches anywhere in a topic path; + and # use MQTT filter syntax. Press / to focus."
            type="search"
            bind:value={topicSearch}
          />
          {#if topicSearch.trim()}
            {#if topicFilter.error}
              <span class="meta problem" title={topicFilter.error}
                >Invalid filter</span
              >
            {:else}
              <span class="meta">
                {topicFilter.matches.length.toLocaleString()}
                {topicFilter.matches.length === 1 ? "match" : "matches"}
              </span>
            {/if}
          {/if}
        </div>
        {#if topicWarning}
          <span
            class="topic-warning meta"
            class:problem={topicSnapshot.topicsOmitted}
            role="status"
          >
            {topicWarning}
          </span>
        {/if}
      </header>
      <div class="topic-tree">
        {#if visibleTopics.roots.length}
          <TreeView
            roots={visibleTopics.roots}
            nodes={visibleTopics.nodes}
            selected={selectedTopicId}
            expanded={visibleTopicExpanded}
            fixedExpanded={Boolean(topicSearch.trim())}
            activity={topicActivity}
            label="MQTT topics"
            checkable={checkableTopics}
            checked={checkedTopics}
            checkDisabled={plotLimitReached}
            oncheck={(id) => {
              const topic = store.topic(id);
              if (topic !== undefined) togglePlot({ topic, path: "$" });
            }}
            onselect={selectTopic}
            ontoggle={toggleTopic}
          />
        {:else if topicSearch.trim()}
          <p class="empty">No matching topics.</p>
        {:else}
          <p class="empty">
            {route.broker
              ? route.filters.length
                ? "Waiting for subscribed messages…"
                : "No subscriptions. Edit connection settings to add topics."
              : "Connect to a broker to browse topics."}
          </p>
        {/if}
      </div>
    </aside>

    <MessagePanel
      message={currentMessage}
      topic={selectedTopic}
      snapshot={jsonSnapshot}
      selected={selectedJsonId}
      selectedLabel={selectedFieldLabel}
      following={selectedMessageId === null}
      expanded={jsonExpanded}
      checkable={checkableJson}
      checked={checkedJson}
      checkDisabled={plotLimitReached}
      subtreePlotCount={selectedValuePlotCount}
      plotCount={route.plots.length}
      subtreeMessages={selectedSubtreeCount}
      showPlotHint={Boolean(checkableJson.size && !route.plots.length)}
      timeZone={route.timeZone}
      onselect={selectJson}
      ontoggle={toggleJson}
      oncheck={(path) => togglePlot({ topic: selectedTopic, path })}
      onremoveplots={removeSelectedValuePlots}
      onremoveallplots={() => removePlots(() => true)}
    />
    <HistoryTable
      expanded={historyExpanded}
      messages={currentHistory}
      selectedId={selectedMessageId}
      field={activeField}
      timeZone={route.timeZone}
      canClearTopic={Boolean(currentHistory.length)}
      canClearSubtree={Boolean(selectedSubtreeCount)}
      canClearAll={Boolean(topicSnapshot.bufferedMessages)}
      onselect={selectHistory}
      onlatest={selectLatest}
      oncleartopic={clearTopicHistory}
      onclearsubtree={clearTopicSubtree}
      onclearall={clearAllHistory}
      ontoggle={() => (historyExpanded = !historyExpanded)}
    />
  </section>
  <PlotDashboard
    plots={dashboardPlots}
    now={plotNow}
    windowMs={route.plotWindowMs}
    timeZone={route.timeZone}
    onfocus={focusPlot}
    onmove={movePlot}
    onremove={(plot) =>
      removePlots((current) => plotKey(current) === plotKey(plot))}
    onshowall={() => changePlotWindow(null)}
  />
</main>
