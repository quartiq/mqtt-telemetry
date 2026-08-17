import type { TreeNodeView } from "./tree";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type JsonPath = (string | number)[];

export type Payload =
  | { kind: "json"; value: JsonValue }
  | { kind: "text"; value: string }
  | { kind: "binary"; value: Uint8Array }
  | { kind: "omitted"; value: string };

export type TelemetryMessage = {
  id: number;
  receivedAt: number;
  retained: boolean;
  duplicate: boolean;
  qos: 0 | 1 | 2;
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
  published: boolean;
  messageCount: number;
};

export type TopicSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  revision: number;
  topicCount: number;
  droppedMessages: number;
  evictedMessages: number;
  omittedPayloads: number;
};

export type JsonSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  paths: Map<string, JsonPath>;
};

export type PlotPoint = { x: number; y: number };

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

export type JsonTreeLimits = {
  maxDepth: number;
  maxNodes: number;
};

export const DEFAULT_JSON_TREE_LIMITS: JsonTreeLimits = {
  maxDepth: 64,
  maxNodes: 10_000,
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

export function formatValue(value: JsonValue): string {
  return JSON.stringify(value) ?? String(value);
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

export function getJsonPath(
  root: JsonValue,
  path: JsonPath,
): JsonValue | undefined {
  let value = root;
  for (const segment of path) {
    if (typeof segment === "number" && Array.isArray(value)) {
      value = value[segment];
    } else if (typeof segment === "string" && isJsonObject(value)) {
      value = value[segment];
    } else {
      return undefined;
    }
    if (value === undefined) return undefined;
  }
  return value;
}

export function jsonPointer(path: JsonPath): string {
  return path
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .map((segment) => `/${segment}`)
    .join("");
}

export function resolveJsonPointer(
  root: JsonValue,
  pointer: string,
): JsonPath | undefined {
  if (!pointer) return [];
  if (!pointer.startsWith("/")) return undefined;
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  const path: JsonPath = [];
  let value = root;
  for (const token of tokens) {
    if (Array.isArray(value) && /^(0|[1-9]\d*)$/.test(token)) {
      const index = Number(token);
      if (index >= value.length) return undefined;
      path.push(index);
      value = value[index];
    } else if (isJsonObject(value) && token in value) {
      path.push(token);
      value = value[token];
    } else {
      return undefined;
    }
  }
  return path;
}

export function fieldLabel(path: JsonPath): string {
  if (!path.length) return "$";
  return path.reduce<string>((label, segment) => {
    if (typeof segment === "number") return `${label}[${segment}]`;
    return /^[A-Za-z_$][\w$]*$/.test(segment)
      ? `${label}.${segment}`
      : `${label}[${JSON.stringify(segment)}]`;
  }, "$");
}

export function selectedMessageValue(
  message: TelemetryMessage,
  path: JsonPath | undefined,
): string {
  if (!path) return "—";
  if (message.payload.kind !== "json")
    return path.length ? "—" : truncate(formatPayload(message.payload));
  const value = getJsonPath(message.payload.value, path);
  if (value === undefined) return "—";
  if (Array.isArray(value)) return `[${value.length.toLocaleString()} items]`;
  if (isJsonObject(value))
    return `{${Object.keys(value).length.toLocaleString()} fields}`;
  return truncate(formatValue(value));
}

export function plotPoints(
  history: TelemetryMessage[],
  path: JsonPath,
): PlotPoint[] {
  return history.flatMap((message) => {
    if (message.retained || message.payload.kind !== "json") return [];
    const value = getJsonPath(message.payload.value, path);
    return typeof value === "number" && Number.isFinite(value)
      ? [{ x: message.receivedAt, y: value }]
      : [];
  });
}

export function downsamplePlotPoints(
  points: PlotPoint[],
  limit: number,
): PlotPoint[] {
  if (points.length <= limit || limit < 4) return points;
  const buckets = Math.max(1, Math.floor((limit - 2) / 2));
  const sampled: PlotPoint[] = [points[0]];
  const interior = points.length - 2;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = 1 + Math.floor((bucket * interior) / buckets);
    const end = 1 + Math.floor(((bucket + 1) * interior) / buckets);
    if (start >= end) continue;
    let low = points[start];
    let high = low;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      if (point.y < low.y) low = point;
      if (point.y > high.y) high = point;
    }
    if (low.x <= high.x) sampled.push(low, ...(high === low ? [] : [high]));
    else sampled.push(high, low);
  }
  sampled.push(points.at(-1) as PlotPoint);
  return sampled;
}

export function messageFrequency(history: TelemetryMessage[]): string {
  const live = history.filter((message) => !message.retained).slice(-100);
  if (live.length < 2) return "";
  const seconds =
    (live.at(-1)!.receivedAt - live[0].receivedAt) / (live.length - 1) / 1000;
  if (!(seconds > 0)) return "";
  if (seconds < 1)
    return `${(1 / seconds).toLocaleString(undefined, { maximumSignificantDigits: 3 })} msg/s`;
  return `every ${seconds.toLocaleString(undefined, { maximumSignificantDigits: 3 })} s`;
}

export function jsonTree(
  root: JsonValue,
  limits: JsonTreeLimits = DEFAULT_JSON_TREE_LIMITS,
): JsonSnapshot {
  const nodes = new Map<string, TreeNodeView>();
  const paths = new Map<string, JsonPath>();
  let nodeLimitReached = false;

  const summary = (value: JsonValue): string => {
    if (Array.isArray(value)) return `[${value.length.toLocaleString()} items]`;
    if (isJsonObject(value))
      return `{${Object.keys(value).length.toLocaleString()} fields}`;
    return formatValue(value);
  };

  const visit = (
    value: JsonValue,
    path: JsonPath,
    label: string,
    depth: number,
    parent?: string,
  ): string => {
    const id = jsonPointer(path) || "$";
    paths.set(id, path);
    nodes.set(id, {
      id,
      label,
      ...(parent ? { parent } : {}),
      children: [],
      title: fieldLabel(path),
    });
    if (depth >= limits.maxDepth) {
      nodes.set(id, {
        id,
        label,
        ...(parent ? { parent } : {}),
        children: [],
        value: `${summary(value)} (depth limit)`,
        title: fieldLabel(path),
      });
      return id;
    }
    const keys = isJsonObject(value)
      ? Object.keys(value).sort((a, b) => a.localeCompare(b))
      : [];
    const childCount = Array.isArray(value) ? value.length : keys.length;
    const children: string[] = [];
    for (let index = 0; index < childCount; index += 1) {
      if (nodeLimitReached) break;
      if (nodes.size >= limits.maxNodes) {
        nodeLimitReached = true;
        break;
      }
      if (nodes.size === limits.maxNodes - 1) {
        const omittedId = `${id}#omitted`;
        nodes.set(omittedId, {
          id: omittedId,
          label: "…",
          parent: id,
          children: [],
          value: "additional fields omitted",
        });
        children.push(omittedId);
        nodeLimitReached = true;
        break;
      }
      const segment = Array.isArray(value) ? index : keys[index];
      const child = Array.isArray(value)
        ? value[index]
        : (value as JsonObject)[segment];
      children.push(
        visit(child, [...path, segment], String(segment), depth + 1, id),
      );
    }
    nodes.set(id, {
      id,
      label,
      ...(parent ? { parent } : {}),
      children,
      ...(children.length ? {} : { value: summary(value) }),
      title: fieldLabel(path),
    });
    return id;
  };

  return { roots: [visit(root, [], "$", 0)], nodes, paths };
}

function truncate(value: string, limit = 256): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export class TelemetryStore {
  private readonly nodes = new Map<string, TopicNode>();
  private readonly views = new Map<string, TreeNodeView>();
  private roots: string[] = [];
  // Map insertion order is arrival order; its first remaining value is oldest.
  private readonly retained = new Map<
    number,
    { nodeId: string; cost: number }
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
      retained: boolean;
      duplicate?: boolean;
      qos: 0 | 1 | 2;
    },
  ): { nodeId: string; message: TelemetryMessage } | undefined {
    const parts = topic.split("/");
    const ids = parts.map((_, index) => topicId(parts.slice(0, index + 1)));
    const missing = ids.filter((id) => !this.nodes.has(id)).length;
    if (this.nodes.size + missing > this.limits.maxTopicNodes) {
      this.droppedMessages += 1;
      this.revision += 1;
      return undefined;
    }
    let parent: string | undefined;
    for (let index = 0; index < parts.length; index += 1) {
      const currentParts = parts.slice(0, index + 1);
      const id = ids[index];
      if (!this.nodes.has(id)) {
        this.nodes.set(id, {
          id,
          label: topicLabel(parts[index]),
          ...(parent ? { parent } : {}),
          topic: currentParts.join("/"),
          children: [],
          history: [],
          published: false,
          messageCount: 0,
        });
        this.views.set(id, this.nodeView(id));
        if (parent) {
          const parentNode = this.nodes.get(parent) as TopicNode;
          parentNode.children = this.sorted([...parentNode.children, id]);
          this.refreshView(parent);
        } else {
          this.roots = this.sorted([...this.roots, id]);
        }
      }
      parent = id;
    }
    const nodeId = parent as string;
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
      duplicate: metadata.duplicate ?? false,
      bytes: payload.byteLength,
      unsafeIntegers: hasUnsafeInteger(parsed),
      payload: parsed,
    };
    const cost =
      parsed.kind === "omitted"
        ? Math.max(256, parsed.value.length * 2)
        : Math.max(256, payload.byteLength * 4);
    node.history.push(message);
    this.retained.set(message.id, { nodeId, cost });
    this.historyBytes += cost;
    this.adjustSubtree(nodeId, 1);
    const excess = node.history.length - this.historyLimit;
    if (excess > 0) this.dropOldest(nodeId, excess, false);
    this.enforceGlobalBudget();
    this.revision += 1;
    return { nodeId, message };
  }

  nodeId(topic: string): string | undefined {
    const id = topicId(topic.split("/"));
    return this.nodes.has(id) ? id : undefined;
  }

  topic(id: string): string | undefined {
    return this.nodes.get(id)?.topic;
  }

  history(id: string): TelemetryMessage[] {
    return [...(this.nodes.get(id)?.history ?? [])];
  }

  setHistoryLimit(limit: number): void {
    this.historyLimit = limit;
    for (const node of this.nodes.values()) {
      const excess = node.history.length - limit;
      if (excess > 0) this.dropOldest(node.id, excess, false);
    }
    this.revision += 1;
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
    return {
      roots: this.roots,
      nodes: this.views,
      revision: this.revision,
      topicCount: this.topicCount,
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

  private nodeView(id: string): TreeNodeView {
    const node = this.nodes.get(id) as TopicNode;
    const direct = node.history.length;
    return {
      id,
      label: node.label,
      ...(node.parent ? { parent: node.parent } : {}),
      children: node.children,
      value: `${node.messageCount.toLocaleString()} ${node.messageCount === 1 ? "msg" : "msgs"}`,
      title: node.children.length
        ? `${node.topic}\n${direct.toLocaleString()} direct; ${node.messageCount.toLocaleString()} total`
        : node.topic,
    };
  }

  private refreshView(id: string): void {
    this.views.set(id, this.nodeView(id));
  }

  private adjustSubtree(id: string, delta: number): void {
    let current: string | undefined = id;
    while (current) {
      const node = this.nodes.get(current) as TopicNode;
      node.messageCount += delta;
      this.refreshView(current);
      current = node.parent;
    }
  }

  private dropOldest(
    nodeId: string,
    count: number,
    countAsEvicted: boolean,
  ): void {
    const node = this.nodes.get(nodeId) as TopicNode;
    const removed = node.history.slice(0, count);
    node.history.splice(0, removed.length);
    for (const message of removed) {
      const retained = this.retained.get(message.id);
      if (!retained) continue;
      this.retained.delete(message.id);
      this.historyBytes -= retained.cost;
    }
    if (removed.length) {
      this.adjustSubtree(nodeId, -removed.length);
      if (countAsEvicted) this.evictedMessages += removed.length;
    }
  }

  private enforceGlobalBudget(): void {
    while (
      this.retained.size > this.limits.maxHistoryMessages ||
      this.historyBytes > this.limits.maxHistoryBytes
    ) {
      const oldest = this.retained.values().next().value;
      if (!oldest) break;
      this.dropOldest(oldest.nodeId, 1, true);
    }
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
