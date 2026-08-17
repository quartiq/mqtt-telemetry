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
  qos: 0 | 1 | 2;
  bytes: number;
  payload: Payload;
};

type TopicNode = {
  id: string;
  label: string;
  parent?: string;
  topic: string;
  children: Set<string>;
  history: TelemetryMessage[];
};

export type TopicSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  droppedMessages: number;
  omittedPayloads: number;
};

export type JsonSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  paths: Map<string, JsonPath>;
};

export type PlotPoint = { x: number; y: number };

export type StoreLimits = {
  maxTopicNodes: number;
  maxPayloadBytes: number;
};

export const DEFAULT_STORE_LIMITS: StoreLimits = {
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
    return path.length ? "—" : formatPayload(message.payload);
  const value = getJsonPath(message.payload.value, path);
  return value === undefined ? "—" : formatValue(value);
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

export function jsonTree(root: JsonValue): JsonSnapshot {
  const nodes = new Map<string, TreeNodeView>();
  const paths = new Map<string, JsonPath>();

  const visit = (
    value: JsonValue,
    path: JsonPath,
    label: string,
    parent?: string,
  ): string => {
    const id = jsonPointer(path) || "$";
    const entries = Array.isArray(value)
      ? value.map((child, index) => [index, child] as const)
      : isJsonObject(value)
        ? Object.keys(value)
            .sort((a, b) => a.localeCompare(b))
            .map((key) => [key, value[key]] as const)
        : [];
    const children = entries.map(([segment, child]) =>
      visit(child, [...path, segment], String(segment), id),
    );
    nodes.set(id, {
      id,
      label,
      ...(parent ? { parent } : {}),
      children,
      ...(children.length ? {} : { value: formatValue(value) }),
      title: fieldLabel(path),
    });
    paths.set(id, path);
    return id;
  };

  return { roots: [visit(root, [], "$")], nodes, paths };
}

export class TelemetryStore {
  readonly nodes = new Map<string, TopicNode>();
  private readonly topics = new Map<string, string>();
  private sequence = 0;
  private droppedMessages = 0;
  private omittedPayloads = 0;

  constructor(
    private historyLimit: number,
    private readonly limits: StoreLimits = DEFAULT_STORE_LIMITS,
  ) {}

  add(
    topic: string,
    payload: Uint8Array,
    metadata: { receivedAt: number; retained: boolean; qos: 0 | 1 | 2 },
  ): { nodeId: string; message: TelemetryMessage } | undefined {
    const parts = topic.split("/");
    const ids = parts.map((_, index) => topicId(parts.slice(0, index + 1)));
    const missing = ids.filter((id) => !this.nodes.has(id)).length;
    if (this.nodes.size + missing > this.limits.maxTopicNodes) {
      this.droppedMessages += 1;
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
          children: new Set(),
          history: [],
        });
        if (parent) this.nodes.get(parent)?.children.add(id);
      }
      parent = id;
    }
    const nodeId = parent as string;
    const node = this.nodes.get(nodeId) as TopicNode;
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
      bytes: payload.byteLength,
      payload: parsed,
    };
    node.history = [...node.history, message].slice(-this.historyLimit);
    this.topics.set(topic, nodeId);
    return { nodeId, message };
  }

  nodeId(topic: string): string | undefined {
    return this.topics.get(topic);
  }

  topic(id: string): string | undefined {
    return this.nodes.get(id)?.topic;
  }

  history(id: string): TelemetryMessage[] {
    return this.nodes.get(id)?.history ?? [];
  }

  setHistoryLimit(limit: number): void {
    this.historyLimit = limit;
    for (const node of this.nodes.values()) {
      node.history = node.history.slice(-limit);
    }
  }

  clearHistory(id: string): void {
    const node = this.nodes.get(id);
    if (node) node.history = [];
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
    const stats = new Map<string, number>();
    const count = (id: string): number => {
      const cached = stats.get(id);
      if (cached !== undefined) return cached;
      const node = this.nodes.get(id) as TopicNode;
      const total = [...node.children].reduce(
        (sum, child) => sum + count(child),
        node.history.length,
      );
      stats.set(id, total);
      return total;
    };

    const views = new Map<string, TreeNodeView>();
    for (const node of this.nodes.values()) {
      const children = [...node.children].sort((left, right) =>
        (this.nodes.get(left)?.label ?? "").localeCompare(
          this.nodes.get(right)?.label ?? "",
        ),
      );
      const messages = count(node.id);
      const displayedMessages = node.history.length || messages;
      views.set(node.id, {
        id: node.id,
        label: node.label,
        ...(node.parent ? { parent: node.parent } : {}),
        children,
        value: `${displayedMessages.toLocaleString()} ${displayedMessages === 1 ? "msg" : "msgs"}`,
        title: node.children.size
          ? `${node.topic}\n${node.history.length.toLocaleString()} direct; ${messages.toLocaleString()} in subtree`
          : node.topic,
      });
    }
    const roots = [...this.nodes.values()]
      .filter((node) => !node.parent)
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((node) => node.id);
    return {
      roots,
      nodes: views,
      droppedMessages: this.droppedMessages,
      omittedPayloads: this.omittedPayloads,
    };
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
