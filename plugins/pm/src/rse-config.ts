import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import { DEFAULT_SAFE_LATEST_POLICY, type SafeLatestPolicy } from "./safe/latest";

export const RSE_CONFIG_FILE = "rse.config.json";
export const RSE_CONFIG_JSONC_FILE = "rse.config.jsonc";
export const RSE_CONFIG_FILES = [RSE_CONFIG_FILE, RSE_CONFIG_JSONC_FILE] as const;

export interface PmRseConfig {
  readonly safeLatest?: Partial<SafeLatestPolicy> | undefined;
}

export interface RseConfig {
  readonly pm?: PmRseConfig | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean when provided.`);
  return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number when provided.`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${path} must be an array of strings when provided.`);
  }
  return value;
}

function optionalInstallScriptPolicy(
  value: unknown,
): SafeLatestPolicy["blockInstallScripts"] | undefined {
  if (value === undefined) return undefined;
  if (value === "always" || value === "unlessAllowlisted" || value === "warn") return value;
  throw new Error(
    'rse.config.json: pm.safeLatest.blockInstallScripts must be "always", "unlessAllowlisted", or "warn".',
  );
}

function parseSafeLatestConfig(value: unknown): Partial<SafeLatestPolicy> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw new Error("rse.config.json: pm.safeLatest must be an object when provided.");
  }

  const policy: {
    allowFreshScopes?: readonly string[];
    blockDeprecated?: boolean;
    blockInstallScripts?: SafeLatestPolicy["blockInstallScripts"];
    installScriptAllowlist?: readonly string[];
    maxFallbackDepth?: number;
    minimumReleaseAgeDays?: number;
  } = {};
  const allowFreshScopes = optionalStringArray(
    value.allowFreshScopes,
    "rse.config.json: pm.safeLatest.allowFreshScopes",
  );
  const blockDeprecated = optionalBoolean(
    value.blockDeprecated,
    "rse.config.json: pm.safeLatest.blockDeprecated",
  );
  const blockInstallScripts = optionalInstallScriptPolicy(value.blockInstallScripts);
  const installScriptAllowlist = optionalStringArray(
    value.installScriptAllowlist,
    "rse.config.json: pm.safeLatest.installScriptAllowlist",
  );
  const maxFallbackDepth = optionalNumber(
    value.maxFallbackDepth,
    "rse.config.json: pm.safeLatest.maxFallbackDepth",
  );
  const minimumReleaseAgeDays = optionalNumber(
    value.minimumReleaseAgeDays,
    "rse.config.json: pm.safeLatest.minimumReleaseAgeDays",
  );

  if (allowFreshScopes !== undefined) policy.allowFreshScopes = allowFreshScopes;
  if (blockDeprecated !== undefined) policy.blockDeprecated = blockDeprecated;
  if (blockInstallScripts !== undefined) policy.blockInstallScripts = blockInstallScripts;
  if (installScriptAllowlist !== undefined) policy.installScriptAllowlist = installScriptAllowlist;
  if (maxFallbackDepth !== undefined) policy.maxFallbackDepth = maxFallbackDepth;
  if (minimumReleaseAgeDays !== undefined) policy.minimumReleaseAgeDays = minimumReleaseAgeDays;

  return policy;
}

export function mergeSafeLatestPolicy(
  configPolicy: Partial<SafeLatestPolicy> | undefined,
  cliPolicy: Partial<SafeLatestPolicy>,
): SafeLatestPolicy {
  return {
    allowFreshScopes:
      cliPolicy.allowFreshScopes ??
      configPolicy?.allowFreshScopes ??
      DEFAULT_SAFE_LATEST_POLICY.allowFreshScopes,
    blockDeprecated:
      cliPolicy.blockDeprecated ??
      configPolicy?.blockDeprecated ??
      DEFAULT_SAFE_LATEST_POLICY.blockDeprecated,
    blockInstallScripts:
      cliPolicy.blockInstallScripts ??
      configPolicy?.blockInstallScripts ??
      DEFAULT_SAFE_LATEST_POLICY.blockInstallScripts,
    installScriptAllowlist:
      cliPolicy.installScriptAllowlist ??
      configPolicy?.installScriptAllowlist ??
      DEFAULT_SAFE_LATEST_POLICY.installScriptAllowlist,
    maxFallbackDepth:
      cliPolicy.maxFallbackDepth ??
      configPolicy?.maxFallbackDepth ??
      DEFAULT_SAFE_LATEST_POLICY.maxFallbackDepth,
    minimumReleaseAgeDays:
      cliPolicy.minimumReleaseAgeDays ??
      configPolicy?.minimumReleaseAgeDays ??
      DEFAULT_SAFE_LATEST_POLICY.minimumReleaseAgeDays,
  };
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

  const pm = parsed.pm;
  if (pm === undefined) return {};
  if (!isObject(pm)) {
    throw new Error(`${configFile}: pm must be an object when provided.`);
  }

  return {
    pm: {
      safeLatest: parseSafeLatestConfig(pm.safeLatest),
    },
  };
}
