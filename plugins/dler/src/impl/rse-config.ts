import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export const RSE_CONFIG_FILE = "rse.config.json";
export const RSE_CONFIG_JSONC_FILE = "rse.config.jsonc";
export const RSE_CONFIG_FILES = [RSE_CONFIG_FILE, RSE_CONFIG_JSONC_FILE] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface DlerRseConfig {
  readonly publishOrder: readonly string[];
}

export interface RseConfig {
  readonly dler?: DlerRseConfig | undefined;
}

export async function readOptionalRseConfig(cwd: string): Promise<RseConfig | undefined> {
  const existingConfigs: Array<{ file: string; raw: string }> = [];

  for (const file of RSE_CONFIG_FILES) {
    try {
      existingConfigs.push({ file, raw: await readFile(resolve(cwd, file), "utf8") });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  if (existingConfigs.length > 1) {
    throw new Error(`Found both ${RSE_CONFIG_FILES.join(" and ")}. Keep only one Rse config file.`);
  }

  const config = existingConfigs[0];
  if (!config) return undefined;

  const { file: configFile, raw } = config;
  if (raw.trim().length === 0) return {};

  const parsed = (() => {
    if (configFile.endsWith(".jsonc")) {
      const errors: ParseError[] = [];
      const value = parse(raw, errors, { allowTrailingComma: true }) as unknown;
      if (errors.length > 0) {
        const details = errors
          .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
          .join(", ");
        throw new Error(`${configFile} contains invalid JSONC: ${details}`);
      }
      return value;
    }

    return JSON.parse(raw) as unknown;
  })();

  if (!isObject(parsed)) {
    throw new Error(`${configFile} must contain a JSON object.`);
  }

  const dler = parsed.dler;
  if (dler === undefined) return {};
  if (!isObject(dler)) {
    throw new Error(`${configFile}: dler must be an object when provided.`);
  }

  const publishOrder = dler.publishOrder;
  if (publishOrder === undefined) return { dler: { publishOrder: [] } };
  if (!Array.isArray(publishOrder) || !publishOrder.every((item) => typeof item === "string")) {
    throw new Error(`${configFile}: dler.publishOrder must be an array of strings.`);
  }

  return { dler: { publishOrder } };
}
