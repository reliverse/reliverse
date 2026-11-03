export type JsonPrimitive = boolean | null | number | string;
export type JsonArray = readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isJsonValue(value: unknown): value is JsonValue {
  try {
    assertJsonValue(value);
    return true;
  } catch {
    return false;
  }
}

export function assertJsonValue(value: unknown, path = "$"): asserts value is JsonValue {
  assertJsonValueInternal(value, path, new WeakSet<object>());
}

function assertJsonValueInternal(value: unknown, path: string, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must not contain a non-finite number.`);
    }

    return;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`${path} must not contain a circular array.`);
    }

    ancestors.add(value);
    for (const [index, item] of value.entries()) {
      assertJsonValueInternal(item, `${path}[${index}]`, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  if (isJsonObject(value)) {
    if (ancestors.has(value)) {
      throw new TypeError(`${path} must not contain a circular object.`);
    }

    ancestors.add(value);
    for (const [key, item] of Object.entries(value)) {
      assertJsonValueInternal(item, `${path}.${key}`, ancestors);
    }
    ancestors.delete(value);
    return;
  }

  throw new TypeError(`${path} must be a JSON value.`);
}

export function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as unknown as T;
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    ) as T;
  }

  return value;
}

export function freezeJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeJsonValue(item);
    }
  } else if (isJsonObject(value)) {
    for (const item of Object.values(value)) {
      freezeJsonValue(item);
    }
  }

  return Object.freeze(value) as T;
}

export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeJsonPointerSegment(segment: string): string | undefined {
  let output = "";

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character !== "~") {
      output += character;
      continue;
    }

    const escaped = segment[index + 1];
    if (escaped === "0") {
      output += "~";
      index += 1;
      continue;
    }

    if (escaped === "1") {
      output += "/";
      index += 1;
      continue;
    }

    return undefined;
  }

  return output;
}

export function isValidJsonPointer(pointer: string): boolean {
  if (pointer === "") {
    return true;
  }

  if (!pointer.startsWith("/")) {
    return false;
  }

  return pointer
    .slice(1)
    .split("/")
    .every((segment) => unescapeJsonPointerSegment(segment) !== undefined);
}

export function getJsonPointer(value: JsonValue, pointer: string): JsonValue | undefined {
  if (!isValidJsonPointer(pointer)) {
    return undefined;
  }

  if (pointer === "") {
    return value;
  }

  let current: JsonValue = value;

  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = unescapeJsonPointerSegment(rawSegment);
    if (segment === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        return undefined;
      }

      const index = Number(segment);
      const next = current[index];
      if (next === undefined) {
        return undefined;
      }
      current = next;
    } else if (isJsonObject(current)) {
      if (!Object.hasOwn(current, segment)) return undefined;
      const next = current[segment];
      if (next === undefined) {
        return undefined;
      }
      current = next;
    } else {
      return undefined;
    }
  }

  return current;
}

export function hasJsonPointer(value: JsonValue, pointer: string): boolean {
  if (!isValidJsonPointer(pointer)) {
    return false;
  }

  if (pointer === "") {
    return true;
  }

  let current: JsonValue = value;

  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = unescapeJsonPointerSegment(rawSegment);
    if (segment === undefined) {
      return false;
    }

    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        return false;
      }

      const index = Number(segment);
      if (index >= current.length) {
        return false;
      }

      current = current[index] as JsonValue;
      continue;
    }

    if (isJsonObject(current)) {
      if (!Object.hasOwn(current, segment)) {
        return false;
      }

      current = current[segment] as JsonValue;
      continue;
    }

    return false;
  }

  return true;
}

/**
 * Returns a cloned object with the property at a non-root JSON Pointer replaced.
 * DCS field pointers only traverse object properties, never array items.
 */
export function setJsonObjectPointer(
  root: JsonObject,
  pointer: string,
  value: JsonValue,
): JsonObject {
  const segments = parseObjectPointer(pointer);
  return setObjectPointer(root, segments, 0, value) as JsonObject;
}

/**
 * Returns a cloned object with a non-root JSON Pointer removed when it exists.
 * Missing paths are left unchanged semantically, but still returned as a clone.
 */
export function deleteJsonObjectPointer(root: JsonObject, pointer: string): JsonObject {
  const segments = parseObjectPointer(pointer);
  return deleteObjectPointer(root, segments, 0) as JsonObject;
}

function parseObjectPointer(pointer: string): readonly string[] {
  if (!isValidJsonPointer(pointer) || pointer === "") {
    throw new TypeError("Expected a valid non-root JSON Pointer.");
  }

  const segments = pointer.slice(1).split("/").map(unescapeJsonPointerSegment);
  if (segments.some((segment) => segment === undefined)) {
    throw new TypeError("Expected a valid JSON Pointer.");
  }

  return segments as string[];
}

function setObjectPointer(
  current: JsonValue,
  segments: readonly string[],
  index: number,
  value: JsonValue,
): JsonValue {
  if (!isJsonObject(current)) {
    throw new TypeError("DCS object-field pointer crosses a non-object value.");
  }

  const key = segments[index] as string;
  if (index === segments.length - 1) {
    return { ...current, [key]: cloneJsonValue(value) };
  }

  const existing = Object.hasOwn(current, key) ? current[key] : undefined;
  return { ...current, [key]: setObjectPointer(existing ?? {}, segments, index + 1, value) };
}

function deleteObjectPointer(
  current: JsonValue,
  segments: readonly string[],
  index: number,
): JsonValue {
  if (!isJsonObject(current)) {
    throw new TypeError("DCS object-field pointer crosses a non-object value.");
  }

  const key = segments[index] as string;
  if (!Object.hasOwn(current, key)) {
    return cloneJsonValue(current);
  }

  const clone: Record<string, JsonValue> = { ...current };
  if (index === segments.length - 1) {
    delete clone[key];
    return clone;
  }

  const existing = current[key];
  if (!isJsonObject(existing)) {
    throw new TypeError("DCS object-field pointer crosses a non-object value.");
  }

  return { ...current, [key]: deleteObjectPointer(existing, segments, index + 1) };
}
