<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import ConnectionFields from "./ConnectionFields.svelte";
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
    resolveJsonPath,
    telemetryPageTitle,
  } from "./lib/json";
  import { TelemetryStore } from "./lib/telemetry";
  import type { DisplayTimeZone } from "./lib/time";
  import { MqttSession, type SessionStatus } from "./lib/mqtt-session";
  import { randomId } from "./lib/random-id";
  import {
    dashboardJson,
    dashboardShareUrl,
    parseDashboardJson,
    readInlineDashboard,
    resolveStartupRoute,
    routeFromDashboard,
    type Dashboard,
  } from "./lib/dashboard";
  import {
    connectionKey,
    defaultRoute,
    isWebSocketBroker,
    launchUrl,
    MAX_PLOTS,
    readLaunchRoute,
    uniqueFilters,
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

  const inlineDashboard = readInlineDashboard(location.hash);
  const launchRoute = readLaunchRoute(location);
  const storedRoute = routeFromViewState(history.state);
  const startup = resolveStartupRoute(
    inlineDashboard,
    launchRoute,
    storedRoute,
  );
  const initialRoute = startup.route;
  const buildCommit = __BUILD_COMMIT__;
  const exactBuildCommit = /^[0-9a-f]{40}$/i.test(buildCommit);
  const buildLabel = exactBuildCommit
    ? `build ${buildCommit.slice(0, 8)}`
    : "local build";
  const buildUrl = exactBuildCommit
    ? `https://github.com/quartiq/mqtt-telemetry/commit/${buildCommit}`
    : undefined;
  let route = $state(initialRoute);
  let formBroker = $state(initialRoute.broker);
  let formFilters = $state(initialRoute.filters.join("\n"));
  let username = $state("");
  let password = $state("");
  let authBroker = initialRoute.broker;

  let session = $state<MqttSession | undefined>();
  let store = $state.raw(new TelemetryStore(initialRoute.historyLimit));
  let revision = $state(0);
  let selectedTopicId = $state("");
  let selectedMessageId = $state<number | null>(null);
  let fieldByTopic = new Map<string, string | null>();
  let revealedFieldKey = "";
  let topicExpanded = $state(new Set<string>());
  let autoExpandedTopicRoots = new Set<string>();
  let topicActivity = $state.raw(new Map<string, TreeActivity>());
  let topicSearch = $state("");
  let historyExpanded = $state(false);
  let jsonExpanded = $state(new Set<string>(["$"]));
  const jsonExpandedByTopic = new Map<string, Set<string>>();
  let status = $state(initialRoute.broker ? "Connecting" : "Not connected");
  let error = $state(startup.error);
  let dashboardNotice = $state("");
  let editingConnection = $state(!initialRoute.broker);
  let dashboardFileInput: HTMLInputElement;
  let connectSerial = 0;
  let activeUsername = "";
  let activePassword = "";
  let viewToken = randomId();
  let lastReceivedAt = 0;
  let lastSegment = 0;
  let renderFrame = 0;
  let plotNow = $state(Date.now());

  if (location.search || location.hash || !storedRoute)
    history.replaceState(
      browserViewState(initialRoute, viewToken, null),
      "",
      launchRoute.kind === "invalid" && inlineDashboard.kind === "absent"
        ? location.href
        : launchUrl(initialRoute, location),
    );

  let topicSnapshot = $derived.by(() => {
    revision;
    return store.snapshot();
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
  let connectionDraftMatches = $derived(
    connectionKey({
      ...route,
      broker: formBroker.trim(),
      filters: uniqueFilters(formFilters.split(/\r?\n/)),
    }) === connectionKey(route) &&
      username === activeUsername &&
      password === activePassword,
  );
  let canResubscribe = $derived(
    Boolean(session) && status === "Connected" && connectionDraftMatches,
  );
  let statusProblem = $derived(
    status === "Disconnected" ||
      status === "Connection error" ||
      status === "Connection failed",
  );
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
  let selectedFieldPath = $derived(
    selectedTopic
      ? route.selectedTopic === selectedTopic
        ? route.fieldPath
        : (fieldByTopic.get(selectedTopic) ?? null)
      : null,
  );
  let activeField = $derived.by(() => {
    if (selectedFieldPath === null) return undefined;
    for (let index = currentHistory.length - 1; index >= 0; index -= 1) {
      const payload = currentHistory[index].payload;
      if (payload.kind !== "json") continue;
      const resolved = resolveJsonPath(payload.value, selectedFieldPath);
      if (resolved) return resolved;
    }
    return undefined;
  });
  let selectedJsonId = $derived(selectedFieldPath ?? "");
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
        .map((plot) => plot.path),
    ),
  );
  let plotLimitReached = $derived(route.plots.length >= MAX_PLOTS);
  let selectedValuePlotCount = $derived.by(() => {
    if (!jsonSnapshot?.nodes.get(selectedJsonId)?.children.length) return 0;
    const path = selectedJsonId;
    return route.plots.filter(
      (plot) => plot.topic === selectedTopic && pathContains(path, plot.path),
    ).length;
  });
  let dashboardPlots = $derived.by(() => {
    revision;
    return route.plots.map<DashboardPlot>((plot) => {
      const nodeId = store.nodeId(plot.topic);
      const series = nodeId
        ? store.plotSeries(nodeId, plot.path)
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
      editingConnection = false;
      const next = routeFromViewState(event.state) ?? defaultRoute();
      if (connectionKey(next) !== connectionKey(route)) {
        route = next;
        formFilters = next.filters.join("\n");
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
        const historyAgeChanged = next.historyAgeMs !== route.historyAgeMs;
        route = next;
        if (historyLimitChanged) {
          store.setHistoryLimit(next.historyLimit);
          revision += 1;
        }
        if (
          historyAgeChanged &&
          next.historyAgeMs !== null &&
          store.expireBefore(Date.now() - next.historyAgeMs)
        )
          revision += 1;
        restoreView(event.state);
      }
    };
    addEventListener("popstate", popstate);
    addEventListener("keydown", browserKeydown);
    const brokerError = route.broker
      ? isWebSocketBroker(route.broker)
      : undefined;
    if (brokerError) {
      status = "Connection error";
      error = brokerError;
      editingConnection = true;
    } else if (route.broker) void startConnection(route);
    return () => {
      removeEventListener("popstate", popstate);
      removeEventListener("keydown", browserKeydown);
      if (renderFrame) cancelAnimationFrame(renderFrame);
      connectSerial += 1;
      session?.close();
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
      browserViewState(next, viewToken, messageId),
      "",
      launchUrl(next, location),
    );
  }

  function replaceRoute(next: AppRoute, messageId: number | null) {
    writeRoute(next, messageId, true);
  }

  function openDashboardFile() {
    dashboardFileInput.click();
  }

  async function loadDashboardFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) {
      error = "Dashboard file is too large.";
      return;
    }
    try {
      applyDashboard(parseDashboardJson(await file.text()));
      dashboardNotice = `Loaded ${file.name}`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function applyDashboard(dashboard: Dashboard) {
    editingConnection = false;
    const next = routeFromDashboard(dashboard);
    const sameConnection =
      Boolean(session) && connectionKey(next) === connectionKey(route);
    if (next.broker !== authBroker) {
      username = "";
      password = "";
      authBroker = next.broker;
    }
    formBroker = next.broker;
    formFilters = next.filters.join("\n");
    writeRoute(next, null);
    const brokerError = isWebSocketBroker(next.broker);
    if (brokerError) {
      stopConnection();
      error = brokerError;
    } else if (sameConnection) {
      store.setHistoryLimit(next.historyLimit);
      if (next.historyAgeMs !== null)
        store.expireBefore(Date.now() - next.historyAgeMs);
      revision += 1;
      restoreView(history.state);
    } else {
      void startConnection(next);
    }
  }

  function saveDashboard() {
    const blob = new Blob([dashboardJson(route)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mqtt-telemetry-dashboard.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url));
    dashboardNotice = "Dashboard saved";
  }

  async function copyDashboardLink() {
    const url = dashboardShareUrl(route, location);
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          // The fallback also works for local files and restricted clipboards.
        }
      }
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        try {
          textarea.select();
          if (!document.execCommand("copy")) throw new Error();
        } finally {
          textarea.remove();
        }
      }
      dashboardNotice = "Share link copied";
    } catch {
      dashboardNotice =
        "Clipboard unavailable; save the dashboard JSON instead.";
    }
  }

  function resetData(historyLimit: number) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    store = new TelemetryStore(historyLimit);
    revision += 1;
    selectedTopicId = "";
    selectedMessageId = null;
    fieldByTopic = new Map();
    revealedFieldKey = "";
    topicExpanded = new Set();
    autoExpandedTopicRoots = new Set();
    topicActivity = new Map();
    topicSearch = "";
    jsonExpanded = new Set(["$"]);
    jsonExpandedByTopic.clear();
    viewToken = randomId();
    lastReceivedAt = 0;
    lastSegment = 0;
    plotNow = Date.now();
  }

  function stopConnection() {
    connectSerial += 1;
    session?.close();
    session = undefined;
    status = "Not connected";
    error = "";
    editingConnection = true;
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

  async function startConnection(nextRoute: AppRoute, preserveData = false) {
    const serial = ++connectSerial;
    const credentials =
      username || password ? { username, password } : undefined;
    session?.close();
    if (!preserveData) {
      session = undefined;
      resetData(nextRoute.historyLimit);
    }
    const segments = new Map<number, number>();
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
            let historySegment = segments.get(segment);
            if (historySegment === undefined) {
              historySegment = ++lastSegment;
              segments.set(segment, historySegment);
            }
            const added = store.add(topic, payload, {
              receivedAt,
              segment: historySegment,
              retained: packet.retain,
              duplicate: packet.dup,
            });
            if (route.historyAgeMs !== null)
              store.expireBefore(receivedAt - route.historyAgeMs);
            plotNow = Date.now();
            scheduleRender();
            if (!added) return;
            const ancestors = store.ancestorIds(added.nodeId);
            const root = ancestors.at(-1);
            if (root && !autoExpandedTopicRoots.has(root)) {
              autoExpandedTopicRoots.add(root);
              topicExpanded = new Set([...topicExpanded, root]);
            }
            const activity = {
              at: performance.now(),
            };
            for (const id of [added.nodeId, ...ancestors])
              topicActivity.set(id, activity);
            if (route.selectedTopic === topic) {
              selectLoadedTopic(added.nodeId, false);
            }
          },
          status: (next) => {
            if (serial === connectSerial) statusChanged(next);
          },
        },
        credentials,
      );
      if (serial !== connectSerial) {
        nextSession.close();
        return;
      }
      session = nextSession;
      activeUsername = credentials?.username ?? "";
      activePassword = credentials?.password ?? "";
      restoreView(history.state);
    } catch (caught) {
      if (serial !== connectSerial) return;
      status = "Connection failed";
      error = caught instanceof Error ? caught.message : String(caught);
      editingConnection = true;
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
      historyLimit: route.historyLimit,
      historyAgeMs: route.historyAgeMs,
      plotWindowMs: route.plotWindowMs,
      timeZone: route.timeZone,
      selectedTopic: "",
      fieldPath: null,
      plots: [],
    };
    if (
      session &&
      connectionKey(next) === connectionKey(route) &&
      username === activeUsername &&
      password === activePassword
    ) {
      editingConnection = false;
      void startConnection(route, true);
      return;
    }
    editingConnection = false;
    writeRoute(next, null);
    void startConnection(next);
  }

  function editConnection() {
    formBroker = route.broker;
    formFilters = route.filters.join("\n");
    username = activeUsername;
    password = activePassword;
    editingConnection = true;
  }

  function cancelConnectionEdit() {
    formBroker = route.broker;
    formFilters = route.filters.join("\n");
    username = activeUsername;
    password = activePassword;
    editingConnection = false;
  }

  function submitConnectionEdit(event: SubmitEvent) {
    event.preventDefault();
    connectFromForm();
  }

  async function resubscribeFromForm() {
    const current = session;
    if (!current || !canResubscribe) return;
    editingConnection = false;
    status = "Resubscribing";
    error = "";
    try {
      await current.resubscribe();
    } catch (caught) {
      if (session !== current) return;
      status = "Connection error";
      error = caught instanceof Error ? caught.message : String(caught);
    }
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
    plotNow = Date.now();
    if (ageMs !== null && store.expireBefore(plotNow - ageMs)) revision += 1;
    writeRoute({ ...route, historyAgeMs: ageMs }, selectedMessageId);
    return true;
  }

  function changePlotWindow(windowMs: number | null): boolean {
    if (windowMs === route.plotWindowMs) return true;
    plotNow = Date.now();
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

  function togglePlot(id: string) {
    const path = jsonSnapshot?.paths.get(id);
    if (!path || !selectedTopic) return;
    const plot = { topic: selectedTopic, path: jsonPath(path) };
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

  function clearAllHistory() {
    if (!topicSnapshot.bufferedMessages) return;
    store.clearAllHistory();
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

<input
  accept="application/json,.json"
  bind:this={dashboardFileInput}
  class="dashboard-file"
  type="file"
  onchange={loadDashboardFile}
/>

<main class="browser">
  <header class="app-header panel">
    <div class="identity">
      <h1>
        <button
          aria-label={route.broker
            ? `Connection settings for ${route.broker}; subscriptions ${route.filters.join(", ")}`
            : "Open connection settings"}
          aria-expanded={editingConnection}
          class="connection-disclosure"
          disabled={status === "Connecting" ||
            status === "Resubscribing" ||
            (editingConnection && !route.broker)}
          title={route.broker
            ? `Connection settings: ${route.broker}\nSubscriptions: ${route.filters.join(", ")}`
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
              <span class="subscription-label">{route.filters.join(", ")}</span>
            {/if}
          </span>
        </button>
      </h1>
    </div>
    <div class="header-controls">
      <div class="connection-state">
        <span aria-live="polite" class:problem={statusProblem}>{status}</span>
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
          title="Only changes the visible plot interval and its statistics; history is not deleted"
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
      <div class="dashboard-actions" aria-label="Dashboard">
        <button disabled={!route.broker} type="button" onclick={saveDashboard}
          >Save</button
        >
        <button type="button" onclick={openDashboardFile}>Load…</button>
        <button
          disabled={!route.broker}
          title="Copy a self-contained link for the complete dashboard"
          type="button"
          onclick={copyDashboardLink}>Copy dashboard</button
        >
      </div>
    </div>
    {#if error}<strong class="header-error">{error}</strong>{/if}
    {#if dashboardNotice}
      <span class="header-notice meta" aria-live="polite"
        >{dashboardNotice}</span
      >
    {/if}
    {#if editingConnection}
      <form
        autocomplete="on"
        class="connection-editor"
        onsubmit={submitConnectionEdit}
      >
        <ConnectionFields
          bind:broker={formBroker}
          bind:filters={formFilters}
          bind:username
          bind:password
        />
        <div class="connection-editor-actions">
          <button
            title="Apply these settings and open a new MQTT connection"
            type="submit">{session ? "Reconnect" : "Connect"}</button
          >
          {#if session}
            <button
              disabled={!canResubscribe}
              title={!connectionDraftMatches
                ? "Reconnect to apply the changed settings first"
                : status !== "Connected"
                  ? "Available while connected"
                  : "Refresh subscriptions and retained messages without disconnecting"}
              type="button"
              onclick={resubscribeFromForm}>Resubscribe</button
            >
          {/if}
          {#if route.broker}
            <button type="button" onclick={cancelConnectionEdit}>Cancel</button>
          {/if}
        </div>
      </form>
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
          <span class="meta problem" title="Browser safety limits applied">
            {topicWarning}
          </span>
        {/if}
      </header>
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
          <p class="empty">
            {route.broker
              ? "Waiting for subscribed messages…"
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
      oncheck={togglePlot}
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
