import { createHash } from "node:crypto";

export type JsonPrimitive = boolean | null | number | string;
export interface JsonArray extends ReadonlyArray<JsonValue> {}
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(value: unknown, path: string, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Expected a finite JSON number at ${path}.`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`Circular JSON value detected at ${path}.`);
    }
    ancestors.add(value);
    const normalized = value.map((entry, index) =>
      normalizeJsonValue(entry, `${path}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return Object.freeze(normalized);
  }

  if (typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new TypeError(`Expected a plain JSON object at ${path}.`);
    }
    if (ancestors.has(value)) {
      throw new TypeError(`Circular JSON value detected at ${path}.`);
    }
    ancestors.add(value);
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) {
        throw new TypeError(`Undefined JSON property at ${path}.${key}.`);
      }
      normalized[key] = normalizeJsonValue(entry, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return Object.freeze(normalized);
  }

  throw new TypeError(`Unsupported JSON value at ${path}: ${typeof value}.`);
}

export function normalizeJson(value: unknown): JsonValue {
  return normalizeJsonValue(value, "$", new Set());
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function fingerprintJson(value: unknown, namespace = "rq.json.v0"): string {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(stableJsonStringify(value))
    .digest("hex");
}
