import { resolve } from "node:path";

import { listGtbAliases, resolveGtbAlias } from "./aliases";
import type { GtbOptionalMode, GtbOptions, GtbRawOptionsInput } from "./types";

const OPTIONAL_MODES = new Set<GtbOptionalMode>(["matching", "all", "none"]);

export function normalizeGtbOptions(input: GtbRawOptionsInput): GtbOptions {
  const positionalPackage = getFirstPositionalArg(input.args);
  const flaggedPackage = toOptionalString(input.options.package);
  const inputPackageName = flaggedPackage ?? positionalPackage;

  if (!inputPackageName) {
    throw new Error(
      "Package name is required. Pass it as a positional argument or with --package.",
    );
  }

  if (inputPackageName.includes(" ")) {
    throw new Error("Package name must not contain whitespace.");
  }

  const aliased = input.options.aliased === true;
  const resolvedAlias = aliased ? resolveGtbAlias(inputPackageName) : undefined;

  if (aliased && !resolvedAlias) {
    const aliases = listGtbAliases()
      .map((alias) => alias.name)
      .join(", ");

    throw new Error(`Unknown gtb alias: ${inputPackageName}. Known aliases: ${aliases || "none"}.`);
  }

  const packageName = resolvedAlias?.packageName ?? inputPackageName;

  const rawTag = toOptionalString(input.options.tag);
  const tag = rawTag ?? resolvedAlias?.defaultTag ?? "latest";
  const version = toOptionalString(input.options.version);
  const os = normalizeOs(toOptionalString(input.options.os) ?? process.platform);
  const arch = normalizeArch(toOptionalString(input.options.arch) ?? process.arch);
  const outputDir = resolve(toOptionalString(input.options.output) ?? ".");
  const npmBin = toOptionalString(input.options.npmBin) ?? "npm";
  const includeOptional = toOptionalBoolean(input.options.includeOptional, true);
  const optionalMode = normalizeOptionalMode(
    toOptionalString(input.options.optionalMode) ?? "matching",
  );
  const overwrite = input.options.overwrite === true;
  const json = input.options.json === true;

  if (version && rawTag) {
    throw new Error("Use either --version or --tag, not both.");
  }

  if (optionalMode !== "none" && !includeOptional) {
    throw new Error("Use either --include-optional false or --optional-mode none, not both.");
  }

  return {
    packageName,
    inputPackageName,
    tag,
    ...(version ? { version } : {}),
    os,
    arch,
    outputDir,
    includeOptional,
    optionalMode: includeOptional ? optionalMode : "none",
    npmBin,
    overwrite,
    aliased,
    ...(resolvedAlias
      ? {
          alias: {
            inputPackageName,
            packageName: resolvedAlias.packageName,
            aliasName: resolvedAlias.name,
            description: resolvedAlias.description,
          },
        }
      : {}),
    apply: input.apply,
    json,
  };
}

export function isGtbUsageErrorMessage(message: string): boolean {
  return (
    message.includes("Package name is required") ||
    message.includes("Package name must not contain whitespace") ||
    message.includes("Use either --version or --tag, not both") ||
    message.includes("Invalid --optional-mode") ||
    message.includes("Invalid --include-optional") ||
    message.includes("Unknown gtb alias") ||
    message.includes("already exists") ||
    message.includes("Unsupported OS") ||
    message.includes("Unsupported architecture")
  );
}

function getFirstPositionalArg(args: unknown): string | undefined {
  if (!Array.isArray(args)) {
    return undefined;
  }

  return args
    .map(String)
    .map((arg) => arg.trim())
    .find(Boolean);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function toOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid --include-optional value: ${value}`);
  }

  return fallback;
}

function normalizeOptionalMode(value: string): GtbOptionalMode {
  const normalized = value.trim().toLowerCase();

  if (OPTIONAL_MODES.has(normalized as GtbOptionalMode)) {
    return normalized as GtbOptionalMode;
  }

  throw new Error(`Invalid --optional-mode value: ${value}. Expected matching, all, or none.`);
}

function normalizeOs(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (["linux", "darwin", "win32"].includes(normalized)) {
    return normalized;
  }

  if (normalized === "macos" || normalized === "mac") {
    return "darwin";
  }

  if (normalized === "windows" || normalized === "win") {
    return "win32";
  }

  throw new Error(`Unsupported OS: ${value}`);
}

function normalizeArch(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (["x64", "arm64", "ia32", "arm"].includes(normalized)) {
    return normalized;
  }

  if (normalized === "amd64") {
    return "x64";
  }

  if (normalized === "aarch64") {
    return "arm64";
  }

  throw new Error(`Unsupported architecture: ${value}`);
}
