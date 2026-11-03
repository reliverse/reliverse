import { canonicalizeJson } from "./canonical";
import {
  escapeJsonPointerSegment,
  isJsonArray,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";

export type JsonSchema = JsonObject;

export interface JsonSchemaIssue {
  readonly message: string;
  readonly path: string;
}

export function validateJsonValueAgainstSchema(
  value: JsonValue,
  schema: JsonSchema,
  path = "",
): readonly JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];
  validate(value, schema, path, issues);
  return issues;
}

export function schemaAtJsonPointer(schema: JsonSchema, pointer: string): JsonSchema | undefined {
  if (pointer === "") {
    return schema;
  }

  if (!pointer.startsWith("/")) {
    return undefined;
  }

  let current: JsonSchema = schema;
  for (const segment of pointer.slice(1).split("/")) {
    const decoded = decodePointerSegment(segment);
    if (decoded === undefined || !isJsonObject(current.properties)) {
      return undefined;
    }

    const next = Object.hasOwn(current.properties, decoded)
      ? current.properties[decoded]
      : undefined;
    if (!isJsonObject(next)) {
      return undefined;
    }

    current = next;
  }

  return current;
}

export function collectSchemaPropertyPointers(schema: JsonSchema, path = ""): readonly string[] {
  if (!isJsonObject(schema.properties)) {
    return [];
  }

  const pointers: string[] = [];
  for (const key of Object.keys(schema.properties).sort()) {
    const child = schema.properties[key];
    if (!isJsonObject(child)) {
      continue;
    }

    const childPath = `${path}/${escapeJsonPointerSegment(key)}`;
    pointers.push(childPath, ...collectSchemaPropertyPointers(child, childPath));
  }

  return pointers;
}

export function isSchemaObject(schema: JsonSchema): boolean {
  return schemaHasType(schema, "object");
}

export function isSchemaArray(schema: JsonSchema): boolean {
  return schemaHasType(schema, "array");
}

function validate(
  value: JsonValue,
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  if (isJsonArray(schema.enum)) {
    const matchesEnum = schema.enum.some(
      (allowed) => canonicalizeJson(allowed) === canonicalizeJson(value),
    );

    if (!matchesEnum) {
      issues.push({
        path,
        message: "Value is not one of the schema enum values.",
      });
      return;
    }
  }

  const allowedTypes = readSchemaTypes(schema.type);
  if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(value, type))) {
    issues.push({
      path,
      message: `Expected ${allowedTypes.join(" or ")}, received ${describeJsonType(value)}.`,
    });
    return;
  }

  if (isJsonObject(value) && isSchemaObject(schema)) {
    validateObject(value, schema, path, issues);
  }

  if (typeof value === "string") {
    validateString(value, schema, path, issues);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push({ path, message: "Expected a finite JSON number." });
    if (typeof schema.minimum === "number" && value < schema.minimum)
      issues.push({ path, message: `Expected number >= ${schema.minimum}.` });
    if (typeof schema.maximum === "number" && value > schema.maximum)
      issues.push({ path, message: `Expected number <= ${schema.maximum}.` });
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
      issues.push({ path, message: `Expected number > ${schema.exclusiveMinimum}.` });
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      issues.push({ path, message: `Expected number < ${schema.exclusiveMaximum}.` });
  }

  if (isJsonArray(value) && isSchemaArray(schema)) {
    validateArray(value, schema, path, issues);
  }
}

function validateObject(
  value: JsonObject,
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const required = isJsonArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      issues.push({
        path: `${path}/${escapeJsonPointerSegment(key)}`,
        message: "Required property is missing.",
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    const childSchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    const childPath = `${path}/${escapeJsonPointerSegment(key)}`;

    if (!isJsonObject(childSchema)) {
      if (schema.additionalProperties === false) {
        issues.push({
          path: childPath,
          message: "Property is not declared by the schema.",
        });
        continue;
      }
      if (isJsonObject(schema.additionalProperties)) {
        validate(child, schema.additionalProperties, childPath, issues);
      }
      continue;
    }

    validate(child, childSchema, childPath, issues);
  }
}

function validateString(
  value: string,
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  if (
    typeof schema.minLength === "number" &&
    Number.isInteger(schema.minLength) &&
    value.length < schema.minLength
  ) {
    issues.push({ path, message: `Expected string length >= ${schema.minLength}.` });
  }
  if (typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        issues.push({ path, message: "String does not match the schema pattern." });
      }
    } catch {
      issues.push({ path, message: "Schema contains an invalid string pattern." });
    }
  }
}

function validateArray(
  value: readonly JsonValue[],
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  if (!isJsonObject(schema.items)) {
    return;
  }

  for (const [index, child] of value.entries()) {
    validate(child, schema.items, `${path}/${index}`, issues);
  }
}

function readSchemaTypes(value: JsonValue | undefined): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (isJsonArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function schemaHasType(schema: JsonSchema, type: string): boolean {
  return readSchemaTypes(schema.type).includes(type);
}

function matchesType(value: JsonValue, type: string): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number";
    case "object":
      return isJsonObject(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function describeJsonType(value: JsonValue): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function decodePointerSegment(segment: string): string | undefined {
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
