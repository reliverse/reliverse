import type { PluginDiscoveryLoadedPlugin, RemptsJsonSchema } from "@reliverse/rempts";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export const RSE_CONFIG_FILE = "rse.config.json";
export const RSE_CONFIG_JSONC_FILE = "rse.config.jsonc";
export const RSE_CONFIG_FILES = [RSE_CONFIG_FILE, RSE_CONFIG_JSONC_FILE] as const;
export const RSE_SCHEMA_FILE = "rse.schema.json";

export type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSchemaObject(value: RemptsJsonSchema | undefined): value is JsonObject {
  return isObject(value);
}

export function deepMergeMissing(base: JsonObject, defaults: JsonObject): JsonObject {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in result)) {
      result[key] = value;
      continue;
    }

    if (isObject(result[key]) && isObject(value)) {
      result[key] = deepMergeMissing(result[key], value);
    }
  }

  return result;
}

function mergeRootSchema(target: JsonObject, schema: JsonObject): void {
  const targetProperties = isObject(target.properties) ? target.properties : {};
  const schemaProperties = isObject(schema.properties) ? schema.properties : {};

  target.properties = {
    ...targetProperties,
    ...schemaProperties,
  };

  if (Array.isArray(target.required) || Array.isArray(schema.required)) {
    const targetRequired = Array.isArray(target.required) ? target.required : [];
    const schemaRequired = Array.isArray(schema.required) ? schema.required : [];
    target.required = [...new Set([...targetRequired, ...schemaRequired])];
  }
}

export function createRseConfigSchema(
  plugins: readonly Pick<PluginDiscoveryLoadedPlugin, "config" | "packageName" | "pluginName">[],
): JsonObject {
  const schema: JsonObject = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Rse config",
    description: "Optional project-local configuration for the Rse CLI and loaded Rse plugins.",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: {
        type: "string",
        description: "JSON Schema URL for editor IntelliSense.",
      },
    },
  };

  for (const plugin of plugins) {
    if (isSchemaObject(plugin.config?.schema)) {
      mergeRootSchema(schema, plugin.config.schema);
    }
  }

  return schema;
}

export function createRseConfigDefaults(
  plugins: readonly Pick<PluginDiscoveryLoadedPlugin, "config">[],
): JsonObject {
  let defaults: JsonObject = {
    $schema: `./${RSE_SCHEMA_FILE}`,
  };

  for (const plugin of plugins) {
    if (isObject(plugin.config?.defaults)) {
      defaults = deepMergeMissing(defaults, plugin.config.defaults);
    }
  }

  return defaults;
}

export function parseJsonObject(raw: string, label: string): JsonObject {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed;
}

export function parseJsoncObject(raw: string, label: string): JsonObject {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true }) as unknown;

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`${label} contains invalid JSONC: ${details}`);
  }

  if (!isObject(parsed)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return parsed;
}

export function parseConfigObject(raw: string, label: string): JsonObject {
  return label.endsWith(".jsonc") ? parseJsoncObject(raw, label) : parseJsonObject(raw, label);
}

export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
