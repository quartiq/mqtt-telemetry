import type { TreeNodeView } from "./tree";
import {
  formatValue,
  getJsonPath,
  type JsonObject,
  type JsonPath,
  type JsonValue,
} from "./json";
import { plotSeriesPath, type PlotSeries } from "./plot";

export type Payload =
  | {
      kind: "json";
      value: JsonValue;
      source: string;
      estimatedBytes: number;
      unsafeIntegers?: true;
      outOfRange?: true;
    }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array }
  | { kind: "omitted"; value: string };

export type TelemetryMessage = {
  id: number;
  receivedAt: number;
  segment: number;
  retained: boolean;
  duplicate: boolean;
  bytes: number;
  unsafeIntegers: boolean;
  payload: Payload;
};

type TopicNode = {
  id: string;
  label: string;
  parent?: string;
  topic: string;
  children: string[];
  history: Map<number, TelemetryMessage>;
  latest?: TelemetryMessage;
  historyRevision: number;
  published: boolean;
  messageCount: number;
};

type TopicNodeView = TreeNodeView & {
  // Whether the latest buffered payload is a finite JSON number.
  numeric: boolean;
  topic: string;
};

export type TopicSnapshot = {
  roots: string[];
  nodes: Map<string, TopicNodeView>;
  revision: number;
  topicCount: number;
  bufferedMessages: number;
  topicsOmitted: boolean;
  historyLimited: boolean;
  collectionStopped: boolean;
};

export type StoreLimits = {
  maxHistoryBytes: number;
  maxHistoryMessages: number;
  maxTopicNodes: number;
  maxTopicDepth: number;
  maxTopicBytes: number;
  maxPayloadBytes: number;
};

export const DEFAULT_STORE_LIMITS: StoreLimits = {
  maxHistoryBytes: 64 * 1024 * 1024,
  maxHistoryMessages: 100_000,
  maxTopicNodes: 10_000,
  maxTopicDepth: 64,
  maxTopicBytes: 8 * 1024 * 1024,
  maxPayloadBytes: 1024 * 1024,
};

const decoder = new TextDecoder("utf-8", { fatal: true });

function topicId(parts: string[]): string {
  return JSON.stringify(parts);
}

function topicLabel(part: string): string {
  return part || "(empty)";
}

export function parsePayload(bytes: Uint8Array): Payload {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { kind: "binary", value: bytes.slice() };
  }
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    return { kind: "text", value: text };
  }
  let unsafeIntegers = false;
  let outOfRange = false;
  // Conservative estimate of parsed values, slots, keys, and preserved source.
  let estimatedBytes = 192 + text.length * 2;
  const pending = [value];
  while (pending.length) {
    const current = pending.pop()!;
    estimatedBytes += 16;
    if (typeof current === "string") estimatedBytes += current.length * 2;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) outOfRange = true;
      if (Number.isInteger(current) && !Number.isSafeInteger(current))
        unsafeIntegers = true;
    } else if (Array.isArray(current)) {
      estimatedBytes += 64;
      for (const child of current) pending.push(child);
    } else if (isJsonObject(current)) {
      estimatedBytes += 64;
      for (const key of Object.keys(current)) {
        estimatedBytes += 32 + key.length * 2;
        pending.push(current[key]);
      }
    }
  }
  return {
    kind: "json",
    value,
    source: text,
    estimatedBytes: Math.max(256, estimatedBytes),
    ...(outOfRange ? { outOfRange: true } : {}),
    ...(unsafeIntegers ? { unsafeIntegers: true } : {}),
  };
}

export function formatPayload(payload: Payload): string {
  switch (payload.kind) {
    case "json":
      return payload.source;
    case "text":
      return payload.value;
    case "binary":
      return Array.from(payload.value, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(" ");
    case "omitted":
      return payload.value;
  }
}

export function selectedMessageValue(
  message: TelemetryMessage,
  path: JsonPath,
): string {
  if (message.payload.kind !== "json")
    return path.length
      ? "—"
      : message.bytes === 0
        ? "empty payload"
        : truncate(formatPayload(message.payload));
  if (!path.length) return truncate(message.payload.source);
  const value = getJsonPath(message.payload.value, path);
  if (value === undefined) return "—";
  return truncate(formatValue(value));
}

export function messagePayloadPreview(message: TelemetryMessage): string {
  switch (message.payload.kind) {
    case "json":
      return truncate(message.payload.source);
    case "text":
      return truncate(message.payload.value || "empty payload");
    case "binary":
      return `binary (${message.bytes.toLocaleString()} bytes)`;
    case "omitted":
      return message.payload.value;
  }
}

export function messageFrequency(history: readonly TelemetryMessage[]): string {
  const segment = history.at(-1)?.segment;
  const live: TelemetryMessage[] = [];
  for (
    let index = history.length - 1;
    index >= 0 && live.length < 100;
    index -= 1
  ) {
    const message = history[index];
    if (!message.retained && message.segment === segment) live.push(message);
  }
  live.reverse();
  if (live.length < 2) return "";
  const seconds =
    (live.at(-1)!.receivedAt - live[0].receivedAt) / (live.length - 1) / 1000;
  if (seconds < 0) return "";
  if (seconds < 0.001) return "burst (<1 ms apart)";
  if (seconds < 1)
    return `${(1 / seconds).toLocaleString(undefined, { maximumSignificantDigits: 3 })} msg/s`;
  return `every ${seconds.toLocaleString(undefined, { maximumSignificantDigits: 3 })} s`;
}

export function messageSpan(history: readonly TelemetryMessage[]): string {
  if (history.length < 2) return "";
  const milliseconds = history.at(-1)!.receivedAt - history[0].receivedAt;
  if (!(milliseconds > 0)) return "";
  if (milliseconds < 1) return "<1 ms span";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms span`;
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s span`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s span`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m span`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h span`;
}

function truncate(value: string, limit = 256): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

const MAX_HISTORY_CACHE_ENTRIES = 8;
const MAX_PLOT_CACHE_ENTRIES = 16;

export class TelemetryStore {
  private readonly nodes = new Map<string, TopicNode>();
  private readonly topicIds = new Map<string, string>();
  private readonly views = new Map<string, TopicNodeView>();
  private readonly dirtyViews = new Set<string>();
  private roots: string[] = [];
  private readonly unsorted = new Set<string | undefined>();
  // Map insertion order is arrival order; its first remaining value is oldest.
  private readonly messages = new Map<
    number,
    { nodeId: string; cost: number; receivedAt: number }
  >();
  private readonly plotCache = new Map<
    string,
    { historyRevision: number; series: PlotSeries }
  >();
  private readonly historyCache = new Map<
    string,
    { historyRevision: number; history: readonly TelemetryMessage[] }
  >();
  private historyBytes = 0;
  private sequence = 0;
  private revision = 0;
  private topicCount = 0;
  private topicBytes = 0;
  private topicsOmitted = false;
  private historyLimited = false;
  private collectionStopped = false;
  private latestBytes = 0;
  private latestCount = 0;
  private readonly limits: StoreLimits;

  constructor(
    private historyLimit: number,
    limits: Partial<StoreLimits> = {},
  ) {
    this.limits = { ...DEFAULT_STORE_LIMITS, ...limits };
  }

  add(
    topic: string,
    payload: Uint8Array,
    metadata: {
      receivedAt: number;
      segment?: number;
      retained: boolean;
      duplicate?: boolean;
    },
  ): { nodeId: string; message: TelemetryMessage } | undefined {
    if (this.collectionStopped) return undefined;
    const nodeId = this.topicIds.get(topic) ?? this.addTopic(topic);
    if (!nodeId) {
      if (!this.topicsOmitted) this.revision += 1;
      this.topicsOmitted = true;
      return undefined;
    }
    const node = this.nodes.get(nodeId) as TopicNode;
    let parsed: Payload;
    if (payload.byteLength > this.limits.maxPayloadBytes) {
      parsed = {
        kind: "omitted",
        value: `Payload omitted: ${payload.byteLength.toLocaleString()} bytes (limit ${this.limits.maxPayloadBytes.toLocaleString()} bytes).`,
      };
    } else {
      parsed = parsePayload(payload);
    }
    const message: TelemetryMessage = {
      id: ++this.sequence,
      ...metadata,
      segment: metadata.segment ?? 0,
      duplicate: metadata.duplicate ?? false,
      bytes: payload.byteLength,
      unsafeIntegers: parsed.kind === "json" && Boolean(parsed.unsafeIntegers),
      payload: parsed,
    };
    const cost =
      parsed.kind === "omitted"
        ? Math.max(256, parsed.value.length * 2)
        : parsed.kind === "json"
          ? parsed.estimatedBytes
          : Math.max(256, payload.byteLength * 4);
    const previousLatest = node.latest;
    const previousCost = previousLatest
      ? this.messages.get(previousLatest.id)!.cost
      : 0;
    // Do not accept a partial current view when even one value per topic cannot fit.
    if (
      this.latestBytes - previousCost + cost > this.limits.maxHistoryBytes ||
      this.latestCount + (previousLatest ? 0 : 1) >
        this.limits.maxHistoryMessages
    ) {
      this.collectionStopped = true;
      this.revision += 1;
      return undefined;
    }
    if (!node.published) {
      node.published = true;
      this.topicCount += 1;
    }
    this.latestBytes += cost - previousCost;
    if (!previousLatest) this.latestCount += 1;
    node.history.set(message.id, message);
    node.latest = message;
    node.historyRevision += 1;
    const stored = {
      nodeId,
      cost,
      receivedAt: message.receivedAt,
    };
    this.messages.set(message.id, stored);
    this.historyBytes += cost;
    this.adjustSubtree(nodeId, 1);
    const excess = node.history.size - this.historyLimit;
    if (excess > 0) this.dropOldest(nodeId, excess, true);
    this.enforceGlobalBudget();
    this.revision += 1;
    return { nodeId, message };
  }

  nodeId(topic: string): string | undefined {
    return this.topicIds.get(topic);
  }

  topic(id: string): string | undefined {
    return this.nodes.get(id)?.topic;
  }

  subtreeMessageCount(id: string): number {
    return this.nodes.get(id)?.messageCount ?? 0;
  }

  history(id: string): readonly TelemetryMessage[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    const cached = this.historyCache.get(id);
    if (cached?.historyRevision === node.historyRevision) {
      this.historyCache.delete(id);
      this.historyCache.set(id, cached);
      return cached.history;
    }

    const history = [...node.history.values()];
    this.historyCache.delete(id);
    this.historyCache.set(id, {
      historyRevision: node.historyRevision,
      history,
    });
    while (this.historyCache.size > MAX_HISTORY_CACHE_ENTRIES)
      this.historyCache.delete(this.historyCache.keys().next().value as string);
    return history;
  }

  plotSeries(id: string, singularPath: string): PlotSeries {
    const node = this.nodes.get(id);
    if (!node) return { points: [], retainedExcluded: 0 };
    const key = JSON.stringify([id, singularPath]);
    const cached = this.plotCache.get(key);
    if (cached?.historyRevision === node.historyRevision) {
      // Refresh insertion order so abandoned dashboard fields age out.
      this.plotCache.delete(key);
      this.plotCache.set(key, cached);
      return cached.series;
    }

    const series = plotSeriesPath(this.history(id), singularPath);
    this.plotCache.delete(key);
    this.plotCache.set(key, { historyRevision: node.historyRevision, series });
    while (this.plotCache.size > MAX_PLOT_CACHE_ENTRIES)
      this.plotCache.delete(this.plotCache.keys().next().value as string);
    return series;
  }

  setHistoryLimit(limit: number): void {
    this.historyLimit = limit;
    for (const node of this.nodes.values()) {
      const excess = node.history.size - limit;
      if (excess > 0) this.dropOldest(node.id, excess, true);
    }
    this.revision += 1;
  }

  expireBefore(cutoff: number): number {
    let removed = 0;
    const expired = new Map<string, number>();
    for (const [id, oldest] of this.messages) {
      if (oldest.receivedAt >= cutoff) break;
      const node = this.nodes.get(oldest.nodeId)!;
      if (node.latest?.id === id) continue;
      expired.set(oldest.nodeId, (expired.get(oldest.nodeId) ?? 0) + 1);
      removed += 1;
    }
    for (const [id, count] of expired) this.dropOldest(id, count, true);
    if (removed) this.revision += 1;
    return removed;
  }

  clearHistory(id: string): void {
    const node = this.nodes.get(id);
    if (!node?.history.size) return;
    this.dropOldest(id, node.history.size);
    this.revision += 1;
  }

  clearSubtree(id: string): void {
    const pending = [id];
    while (pending.length) {
      const node = this.nodes.get(pending.pop() as string);
      if (!node) continue;
      pending.push(...node.children);
      if (node.history.size) this.dropOldest(node.id, node.history.size);
    }
    this.revision += 1;
  }

  clearAllHistory(): void {
    if (!this.messages.size) return;
    for (const node of this.nodes.values()) {
      if (node.history.size) this.dropOldest(node.id, node.history.size);
    }
    this.revision += 1;
  }

  ancestorIds(id: string): string[] {
    const ancestors: string[] = [];
    let parent = this.nodes.get(id)?.parent;
    while (parent) {
      ancestors.push(parent);
      parent = this.nodes.get(parent)?.parent;
    }
    return ancestors;
  }

  snapshot(): TopicSnapshot {
    for (const id of this.unsorted) {
      if (id === undefined) this.roots = this.sorted([...this.roots]);
      else {
        const node = this.nodes.get(id)!;
        node.children = this.sorted([...node.children]);
      }
    }
    this.unsorted.clear();
    for (const id of this.dirtyViews) this.views.set(id, this.nodeView(id));
    this.dirtyViews.clear();
    return {
      roots: this.roots,
      nodes: this.views,
      revision: this.revision,
      topicCount: this.topicCount,
      bufferedMessages: this.messages.size,
      topicsOmitted: this.topicsOmitted,
      historyLimited: this.historyLimited,
      collectionStopped: this.collectionStopped,
    };
  }

  private sorted(ids: string[]): string[] {
    return ids.sort((left, right) =>
      (this.nodes.get(left)?.label ?? "").localeCompare(
        this.nodes.get(right)?.label ?? "",
      ),
    );
  }

  private addTopic(topic: string): string | undefined {
    if (this.nodes.size >= this.limits.maxTopicNodes) return undefined;
    const parts = topic.split("/");
    if (parts.length > this.limits.maxTopicDepth) return undefined;
    const ids = parts.map((_, index) => topicId(parts.slice(0, index + 1)));
    const missing = ids.filter((id) => !this.nodes.has(id)).length;
    if (this.nodes.size + missing > this.limits.maxTopicNodes) return undefined;

    // Account for path strings and node overhead before mutating the tree.
    const cost = ids.reduce(
      (sum, id) => sum + (this.nodes.has(id) ? 0 : 256 + id.length * 8),
      0,
    );
    if (this.topicBytes + cost > this.limits.maxTopicBytes) return undefined;
    this.topicBytes += cost;
    let parent: string | undefined;
    for (let index = 0; index < parts.length; index += 1) {
      const id = ids[index];
      if (!this.nodes.has(id)) {
        const nodeTopic = parts.slice(0, index + 1).join("/");
        this.nodes.set(id, {
          id,
          label: topicLabel(parts[index]),
          ...(parent ? { parent } : {}),
          topic: nodeTopic,
          children: [],
          history: new Map(),
          historyRevision: 0,
          published: false,
          messageCount: 0,
        });
        this.topicIds.set(nodeTopic, id);
        this.dirtyViews.add(id);
        if (parent) {
          const parentNode = this.nodes.get(parent) as TopicNode;
          if (!this.unsorted.has(parent))
            parentNode.children = [...parentNode.children];
          parentNode.children.push(id);
          this.unsorted.add(parent);
          this.dirtyViews.add(parent);
        } else {
          if (!this.unsorted.has(undefined)) this.roots = [...this.roots];
          this.roots.push(id);
          this.unsorted.add(undefined);
        }
      }
      parent = id;
    }
    return parent;
  }

  private nodeView(id: string): TopicNodeView {
    const node = this.nodes.get(id) as TopicNode;
    const direct = node.history.size;
    const payload = node.latest?.payload;
    const numeric =
      payload?.kind === "json" &&
      typeof payload.value === "number" &&
      Number.isFinite(payload.value);
    return {
      id,
      numeric,
      topic: node.topic,
      ...(numeric ? { value: String(payload.value) } : {}),
      label: node.label,
      ...(node.parent ? { parent: node.parent } : {}),
      children: node.children,
      ...(direct ? { suffix: `(${direct.toLocaleString()})` } : {}),
      title: `${node.topic}\nBuffered here: ${direct.toLocaleString()}${
        node.children.length
          ? `\nBuffered in subtree: ${node.messageCount.toLocaleString()}`
          : ""
      }`,
    };
  }

  private adjustSubtree(id: string, delta: number): void {
    let current: string | undefined = id;
    while (current) {
      const node = this.nodes.get(current) as TopicNode;
      node.messageCount += delta;
      this.dirtyViews.add(current);
      current = node.parent;
    }
  }

  private dropOldest(
    nodeId: string,
    count: number,
    preserveLatest = false,
  ): void {
    const node = this.nodes.get(nodeId) as TopicNode;
    const removed: TelemetryMessage[] = [];
    for (const message of node.history.values()) {
      if (removed.length >= count) break;
      if (preserveLatest && message === node.latest) continue;
      removed.push(message);
    }
    this.removeMessages(nodeId, removed);
  }

  private removeMessages(nodeId: string, removed: TelemetryMessage[]): void {
    if (!removed.length) return;
    const node = this.nodes.get(nodeId) as TopicNode;
    const latest = node.latest!;
    for (const message of removed) node.history.delete(message.id);
    this.historyCache.delete(nodeId);
    // Removals are always an oldest prefix, including explicit history clearing.
    if (!node.history.size) {
      this.latestBytes -= this.messages.get(latest.id)!.cost;
      this.latestCount -= 1;
      node.latest = undefined;
    }
    node.historyRevision += 1;
    for (const message of removed) {
      const stored = this.messages.get(message.id);
      if (!stored) continue;
      this.messages.delete(message.id);
      this.historyBytes -= stored.cost;
    }
    this.adjustSubtree(nodeId, -removed.length);
  }

  private enforceGlobalBudget(): void {
    for (const [id, stored] of this.messages) {
      if (
        this.messages.size <= this.limits.maxHistoryMessages &&
        this.historyBytes <= this.limits.maxHistoryBytes
      )
        break;
      const node = this.nodes.get(stored.nodeId)!;
      if (node.latest?.id === id) continue;
      this.removeMessages(stored.nodeId, [node.history.get(id)!]);
      this.historyLimited = true;
    }
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
