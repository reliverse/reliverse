import { assertJsonValue, isJsonObject, type JsonValue } from "./json";

export function canonicalizeJson(value: JsonValue): string {
  assertJsonValue(value);
  return JSON.stringify(normalizeJson(value));
}

export function serializeCanonicalJson(value: JsonValue): string {
  return `${canonicalizeJson(value)}\n`;
}

export async function sha256Hex(value: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("Web Crypto SubtleCrypto is required to calculate a DCS digest.");
  }

  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestCanonicalJson(value: JsonValue): Promise<string> {
  return sha256Hex(canonicalizeJson(value));
}

function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJson(value[key] as JsonValue)]),
    );
  }

  return value;
}
