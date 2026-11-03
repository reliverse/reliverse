import { createHash, randomUUID } from "node:crypto";

import type { GatehouseJson } from "./contracts";

function normalize(value: unknown, ancestors = new WeakSet<object>()): GatehouseJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Gatehouse canonical JSON rejects non-finite numbers.");
    }
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) throw new Error("Gatehouse canonical JSON rejects circular values.");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Gatehouse canonical JSON requires plain objects.");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return Array.from(value, (entry) => normalize(entry, ancestors));
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(entries.map(([key, entry]) => [key, normalize(entry, ancestors)]));
    } finally {
      ancestors.delete(value);
    }
  }
  throw new Error(`Gatehouse canonical JSON rejects ${typeof value} values.`);
}

export function canonicalizeGatehouseValue(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function fingerprintGatehouseValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeGatehouseValue(value)).digest("hex")}`;
}

export function createGatehouseId(prefix: string): string {
  const normalized = prefix
    .trim()
    .replace(/[^a-z0-9_-]+/giu, "-")
    .toLowerCase();
  if (!normalized) throw new Error("Gatehouse id prefix must be non-empty.");
  return `${normalized}_${randomUUID()}`;
}

export function createDeterministicGatehouseId(prefix: string, value: unknown): string {
  const fingerprint = fingerprintGatehouseValue(value);
  const digest = fingerprint.slice("sha256:".length, "sha256:".length + 32);
  return `${prefix}_${digest}`;
}
