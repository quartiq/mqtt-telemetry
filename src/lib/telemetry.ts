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
  | { kind: "json"; value: JsonValue }
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
  history: TelemetryMessage[];
  historyRevision: number;
  latestRetainedId?: number;
  published: boolean;
  messageCount: number;
};

export type TopicSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  revision: number;
  topicCount: number;
  bufferedMessages: number;
  droppedMessages: number;
  evictedMessages: number;
  omittedPayloads: number;
};

export type StoreLimits = {
  maxHistoryBytes: number;
  maxHistoryMessages: number;
  maxTopicNodes: number;
  maxPayloadBytes: number;
};

export const DEFAULT_STORE_LIMITS: StoreLimits = {
  maxHistoryBytes: 64 * 1024 * 1024,
  maxHistoryMessages: 100_000,
  maxTopicNodes: 10_000,
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
  try {
    return { kind: "json", value: JSON.parse(text) as JsonValue };
  } catch {
    return { kind: "text", value: text };
  }
}

function hasUnsafeInteger(payload: Payload): boolean {
  if (payload.kind !== "json") return false;
  const pending: JsonValue[] = [payload.value];
  while (pending.length) {
    const value = pending.pop() as JsonValue;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      !Number.isSafeInteger(value)
    )
      return true;
    if (Array.isArray(value)) pending.push(...value);
    else if (isJsonObject(value)) pending.push(...Object.values(value));
  }
  return false;
}

export function formatPayload(payload: Payload): string {
  switch (payload.kind) {
    case "json":
      return formatValue(payload.value);
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
    return path.length ? "—" : truncate(formatPayload(message.payload));
  const value = getJsonPath(message.payload.value, path);
  if (value === undefined) return "—";
  return truncate(formatValue(value));
}

export function messagePayloadPreview(message: TelemetryMessage): string {
  switch (message.payload.kind) {
    case "json":
      return truncate(formatValue(message.payload.value));
    case "text":
      return truncate(message.payload.value || "empty text");
    case "binary":
      return `binary (${message.bytes.toLocaleString()} bytes)`;
    case "omitted":
      return message.payload.value;
  }
}

export function messageFrequency(history: readonly TelemetryMessage[]): string {
  const segment = history.at(-1)?.segment;
  const live = history
    .filter((message) => !message.retained && message.segment === segment)
    .slice(-100);
  if (live.length < 2) return "";
  const seconds =
    (live.at(-1)!.receivedAt - live[0].receivedAt) / (live.length - 1) / 1000;
  if (!(seconds > 0)) return "";
  if (seconds < 0.001) return "burst (<1 ms apart)";
  if (seconds < 1)
    return `${(1 / seconds).toLocaleString(undefined, { maximumSignificantDigits: 3 })} msg/s`;
  return `every ${seconds.toLocaleString(undefined, { maximumSignificantDigits: 3 })} s`;
}

export function messageSpan(history: readonly TelemetryMessage[]): string {
  const live = history.filter((message) => !message.retained);
  if (live.length < 2) return "";
  const milliseconds = live.at(-1)!.receivedAt - live[0].receivedAt;
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
  private readonly views = new Map<string, TreeNodeView>();
  private readonly dirtyViews = new Set<string>();
  private roots: string[] = [];
  // Map insertion order is arrival order; its first remaining value is oldest.
  private readonly messages = new Map<
    number,
    { nodeId: string; cost: number; receivedAt: number }
  >();
  private readonly expirable = new Map<
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
  private droppedMessages = 0;
  private evictedMessages = 0;
  private omittedPayloads = 0;
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
    const nodeId = this.topicIds.get(topic) ?? this.addTopic(topic);
    if (!nodeId) {
      this.droppedMessages += 1;
      this.revision += 1;
      return undefined;
    }
    const node = this.nodes.get(nodeId) as TopicNode;
    if (!node.published) {
      node.published = true;
      this.topicCount += 1;
    }
    let parsed: Payload;
    if (payload.byteLength > this.limits.maxPayloadBytes) {
      this.omittedPayloads += 1;
      parsed = {
        kind: "omitted",
        value: `[payload omitted: ${payload.byteLength.toLocaleString()} bytes exceeds the ${this.limits.maxPayloadBytes.toLocaleString()} byte limit]`,
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
      unsafeIntegers: hasUnsafeInteger(parsed),
      payload: parsed,
    };
    const cost =
      parsed.kind === "omitted"
        ? Math.max(256, parsed.value.length * 2)
        : Math.max(256, payload.byteLength * 4);
    if (metadata.retained && node.latestRetainedId !== undefined) {
      const previous = node.history.find(
        ({ id }) => id === node.latestRetainedId,
      );
      if (previous) this.removeMessages(nodeId, [previous], false);
    }
    node.history.push(message);
    node.historyRevision += 1;
    if (metadata.retained) node.latestRetainedId = message.id;
    const stored = {
      nodeId,
      cost,
      receivedAt: message.receivedAt,
    };
    this.messages.set(message.id, stored);
    if (!metadata.retained) this.expirable.set(message.id, stored);
    this.historyBytes += cost;
    this.adjustSubtree(nodeId, 1);
    const liveMessages =
      node.history.length - (node.latestRetainedId === undefined ? 0 : 1);
    const excess = liveMessages - this.historyLimit;
    if (excess > 0) this.dropOldest(nodeId, excess, false, true);
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

    const history = [...node.history];
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

    const series = plotSeriesPath(node.history, singularPath);
    this.plotCache.delete(key);
    this.plotCache.set(key, { historyRevision: node.historyRevision, series });
    while (this.plotCache.size > MAX_PLOT_CACHE_ENTRIES)
      this.plotCache.delete(this.plotCache.keys().next().value as string);
    return series;
  }

  setHistoryLimit(limit: number): void {
    this.historyLimit = limit;
    for (const node of this.nodes.values()) {
      const liveMessages =
        node.history.length - (node.latestRetainedId === undefined ? 0 : 1);
      const excess = liveMessages - limit;
      if (excess > 0) this.dropOldest(node.id, excess, false, true);
    }
    this.revision += 1;
  }

  expireBefore(cutoff: number): number {
    let removed = 0;
    while (true) {
      const oldest = this.expirable.values().next().value;
      if (!oldest || oldest.receivedAt >= cutoff) break;
      this.dropOldest(oldest.nodeId, 1, false, true);
      removed += 1;
    }
    if (removed) this.revision += 1;
    return removed;
  }

  clearHistory(id: string): void {
    const node = this.nodes.get(id);
    if (!node?.history.length) return;
    this.dropOldest(id, node.history.length, false);
    this.revision += 1;
  }

  clearSubtree(id: string): void {
    const pending = [id];
    while (pending.length) {
      const node = this.nodes.get(pending.pop() as string);
      if (!node) continue;
      pending.push(...node.children);
      if (node.history.length)
        this.dropOldest(node.id, node.history.length, false);
    }
    this.revision += 1;
  }

  clearAllHistory(): void {
    if (!this.messages.size) return;
    for (const node of this.nodes.values()) {
      if (node.history.length)
        this.dropOldest(node.id, node.history.length, false);
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
    for (const id of this.dirtyViews) this.views.set(id, this.nodeView(id));
    this.dirtyViews.clear();
    return {
      roots: this.roots,
      nodes: this.views,
      revision: this.revision,
      topicCount: this.topicCount,
      bufferedMessages: this.messages.size,
      droppedMessages: this.droppedMessages,
      evictedMessages: this.evictedMessages,
      omittedPayloads: this.omittedPayloads,
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
    const parts = topic.split("/");
    const ids = parts.map((_, index) => topicId(parts.slice(0, index + 1)));
    const missing = ids.filter((id) => !this.nodes.has(id)).length;
    if (this.nodes.size + missing > this.limits.maxTopicNodes) return undefined;

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
          history: [],
          historyRevision: 0,
          published: false,
          messageCount: 0,
        });
        this.topicIds.set(nodeTopic, id);
        this.dirtyViews.add(id);
        if (parent) {
          const parentNode = this.nodes.get(parent) as TopicNode;
          parentNode.children = this.sorted([...parentNode.children, id]);
          this.dirtyViews.add(parent);
        } else {
          this.roots = this.sorted([...this.roots, id]);
        }
      }
      parent = id;
    }
    return parent;
  }

  private nodeView(id: string): TreeNodeView {
    const node = this.nodes.get(id) as TopicNode;
    const direct = node.history.length;
    return {
      id,
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
    countAsEvicted: boolean,
    preserveLatestRetained = false,
  ): void {
    const node = this.nodes.get(nodeId) as TopicNode;
    const removed: TelemetryMessage[] = [];
    for (const message of node.history) {
      if (removed.length >= count) break;
      if (preserveLatestRetained && message.id === node.latestRetainedId)
        continue;
      removed.push(message);
    }
    this.removeMessages(nodeId, removed, countAsEvicted);
  }

  private removeMessages(
    nodeId: string,
    removed: TelemetryMessage[],
    countAsEvicted: boolean,
  ): void {
    if (!removed.length) return;
    const node = this.nodes.get(nodeId) as TopicNode;
    const ids = new Set(removed.map(({ id }) => id));
    node.history = node.history.filter(({ id }) => !ids.has(id));
    node.historyRevision += 1;
    for (const message of removed) {
      const stored = this.messages.get(message.id);
      if (!stored) continue;
      this.messages.delete(message.id);
      this.expirable.delete(message.id);
      this.historyBytes -= stored.cost;
      if (node.latestRetainedId === message.id)
        node.latestRetainedId = undefined;
    }
    this.adjustSubtree(nodeId, -removed.length);
    if (countAsEvicted) this.evictedMessages += removed.length;
  }

  private enforceGlobalBudget(): void {
    while (
      this.messages.size > this.limits.maxHistoryMessages ||
      this.historyBytes > this.limits.maxHistoryBytes
    ) {
      const oldestLive = this.expirable.values().next().value;
      const oldest = oldestLive ?? this.messages.values().next().value;
      if (!oldest) break;
      this.dropOldest(oldest.nodeId, 1, true, Boolean(oldestLive));
    }
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
