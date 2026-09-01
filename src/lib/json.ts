import type { TreeNodeView } from "./tree";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };
export type JsonPath = (string | number)[];

export type JsonSnapshot = {
  roots: string[];
  nodes: Map<string, TreeNodeView>;
  paths: Map<string, JsonPath>;
};

export type JsonTreeLimits = {
  maxDepth: number;
  maxNodes: number;
};

export const DEFAULT_JSON_TREE_LIMITS: JsonTreeLimits = {
  maxDepth: 64,
  maxNodes: 10_000,
};

export function formatValue(value: JsonValue): string {
  return JSON.stringify(value) ?? String(value);
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

// A deterministic singular JSONPath subset: dot notation where it is clear,
// bracket notation for other member names, and numeric array indices.
export function jsonPath(path: JsonPath): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)
          ? `${result}.${segment}`
          : `${result}['${escapeJsonPathName(segment)}']`,
    "$",
  );
}

export function parseJsonPath(value: string): JsonPath | undefined {
  if (!value.startsWith("$")) return undefined;
  const path: JsonPath = [];
  let index = 1;
  while (index < value.length) {
    if (value[index] === ".") {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(index + 1));
      if (!match) return undefined;
      path.push(match[0]);
      index += match[0].length + 1;
      continue;
    }
    if (value[index] !== "[") return undefined;
    index += 1;
    if (value[index] === "'" || value[index] === '"') {
      const quote = value[index];
      const parsed = parseJsonPathName(value, index + 1, quote);
      if (!parsed) return undefined;
      path.push(parsed.name);
      index = parsed.next;
    } else {
      const end = value.indexOf("]", index);
      if (end < 0) return undefined;
      const token = value.slice(index, end);
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      const arrayIndex = Number(token);
      if (!Number.isSafeInteger(arrayIndex)) return undefined;
      path.push(arrayIndex);
      index = end + 1;
    }
  }
  return path;
}

export function resolveJsonPath(
  root: JsonValue,
  singularPath: string,
): JsonPath | undefined {
  const path = parseJsonPath(singularPath);
  if (!path) return undefined;
  return getJsonPath(root, path) === undefined ? undefined : path;
}

function escapeJsonPathName(value: string): string {
  let escaped = "";
  for (const character of value) {
    switch (character) {
      case "'":
        escaped += "\\'";
        break;
      case "\\":
        escaped += "\\\\";
        break;
      case "\b":
        escaped += "\\b";
        break;
      case "\f":
        escaped += "\\f";
        break;
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\t":
        escaped += "\\t";
        break;
      default: {
        const codePoint = character.codePointAt(0) as number;
        escaped +=
          codePoint < 0x20
            ? `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`
            : character;
      }
    }
  }
  return escaped;
}

function parseJsonPathName(
  value: string,
  start: number,
  quote: string,
): { name: string; next: number } | undefined {
  let name = "";
  let index = start;
  while (index < value.length) {
    const character = value[index];
    if (character === quote)
      return value[index + 1] === "]" ? { name, next: index + 2 } : undefined;
    if (character !== "\\") {
      if (character.codePointAt(0)! < 0x20) return undefined;
      name += character;
      index += 1;
      continue;
    }
    const escape = value[index + 1];
    const simple: Record<string, string> = {
      [quote]: quote,
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape in simple) {
      name += simple[escape];
      index += 2;
      continue;
    }
    if (escape !== "u") return undefined;
    const hex = value.slice(index + 2, index + 6);
    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return undefined;
    name += String.fromCharCode(Number.parseInt(hex, 16));
    index += 6;
  }
  return undefined;
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

export function telemetryPageTitle(topic: string, path?: JsonPath): string {
  const topicName = topic.split("/").filter(Boolean).at(-1) ?? topic;
  const field = path?.at(-1);
  const fieldName =
    typeof field === "number" ? `[${field}]` : field || (path ? "$" : "");
  return [fieldName, topicName, "MQTT Telemetry"]
    .filter(Boolean)
    .map((part) => shortenTitle(part))
    .join(" — ");
}

function shortenTitle(value: string): string {
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

export function jsonTree(
  root: JsonValue,
  limits: JsonTreeLimits = DEFAULT_JSON_TREE_LIMITS,
): JsonSnapshot {
  const nodes = new Map<string, TreeNodeView>();
  const paths = new Map<string, JsonPath>();
  let nodeLimitReached = false;

  const summary = (value: JsonValue): string => {
    if (Array.isArray(value))
      return value.length
        ? `array (${value.length.toLocaleString()} items)`
        : "[]";
    if (isJsonObject(value)) {
      const count = Object.keys(value).length;
      return count ? `object (${count.toLocaleString()} fields)` : "{}";
    }
    return formatValue(value);
  };

  const visit = (
    value: JsonValue,
    path: JsonPath,
    label: string,
    depth: number,
    parent?: string,
  ): string => {
    const id = jsonPath(path);
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

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
