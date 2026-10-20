import { createHash } from "node:crypto";

export type GrJsonPrimitive = boolean | null | number | string;
export interface GrJsonArray extends ReadonlyArray<GrJsonValue> {}
export interface GrJsonObject {
  readonly [key: string]: GrJsonValue;
}
export type GrJsonValue = GrJsonArray | GrJsonObject | GrJsonPrimitive;

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValue(value: unknown, valuePath: string, ancestors: Set<object>): GrJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`Expected a finite JSON number at ${valuePath}.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`Circular JSON value detected at ${valuePath}.`);
    ancestors.add(value);
    const normalized = value.map((entry, index) =>
      normalizeValue(entry, `${valuePath}[${index}]`, ancestors),
    );
    ancestors.delete(value);
    return Object.freeze(normalized);
  }
  if (typeof value === "object") {
    if (!isPlainObject(value)) throw new TypeError(`Expected a plain JSON object at ${valuePath}.`);
    if (ancestors.has(value)) throw new TypeError(`Circular JSON value detected at ${valuePath}.`);
    ancestors.add(value);
    const normalized: Record<string, GrJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined)
        throw new TypeError(`Undefined JSON property at ${valuePath}.${key}.`);
      normalized[key] = normalizeValue(entry, `${valuePath}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return Object.freeze(normalized);
  }
  throw new TypeError(`Unsupported JSON value at ${valuePath}: ${typeof value}.`);
}

export function normalizeGrJson(value: unknown): GrJsonValue {
  return normalizeValue(value, "$", new Set());
}

export function stableGrJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeGrJson(value));
}

export function fingerprintGrJson(value: unknown, namespace = "gr.json.v0"): string {
  return createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(stableGrJsonStringify(value))
    .digest("hex");
}

export function fingerprintGrBytes(value: string | Uint8Array, namespace: string): string {
  return createHash("sha256").update(namespace).update("\0").update(value).digest("hex");
}
