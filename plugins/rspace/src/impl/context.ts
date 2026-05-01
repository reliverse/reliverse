import { DEFAULT_ENTRY_FILE, SUPPORTED_PLATFORMS } from "./constants";
import {
  createDefaultCustomTargetPath,
  createDefaultOutputPath,
  normalizeRelativeRspacePath,
  resolveUserPath,
  toSafeName,
} from "./paths";
import type {
  RspaceCommandContext,
  RspaceCreateOptions,
  RspacePackOptions,
  RspacePlatform,
  RspaceVerifyOptions,
} from "./types";

export function readCreateOptions(ctx: unknown): RspaceCreateOptions {
  const cwd = getCurrentDirectory(ctx);
  const source = collectOptionSources(ctx);

  const rawName = readRequiredString(source, "name", "Pass --name <agent-name>.");
  const name = toSafeName(rawName);
  const rawTeam = readOptionalString(source, "team");
  const team = rawTeam ? toSafeName(rawTeam) : undefined;
  const customPath = readCustomPath(source, name);
  const input = readOptionalString(source, "input");

  if (!team && !customPath) {
    throw new Error("Pass --team <team-name> or --custom-path <relative-target-path>.");
  }

  if (team && customPath) {
    throw new Error("Use either --team or --custom-path, not both.");
  }

  const output = readOptionalString(source, "output")
    ? resolveUserPath(readRequiredString(source, "output"), cwd)
    : createDefaultOutputPath({ cwd, name });

  const platformInput =
    readOptionalString(source, "platform") ??
    readOptionalString(source, "optimize-for-platform") ??
    "generic";

  const entryFile = normalizeRelativeRspacePath(
    readOptionalString(source, "entry-file") ?? DEFAULT_ENTRY_FILE,
    "--entry-file",
  );

  return {
    ...(input ? { input: resolveUserPath(input, cwd) } : {}),
    output,
    name,
    ...(team ? { team } : {}),
    ...(customPath ? { customPath } : {}),
    entryFile,
    platform: normalizePlatform(platformInput),
    overwrite: readBoolean(source, "overwrite"),
    apply: readApply(source),
  };
}

export function readPackOptions(ctx: unknown): RspacePackOptions {
  const cwd = getCurrentDirectory(ctx);
  const source = collectOptionSources(ctx);

  return {
    input: resolveUserPath(readRequiredString(source, "input", "Pass --input <rspace-dir>."), cwd),
    output: resolveUserPath(
      readRequiredString(source, "output", "Pass --output <archive.tar.gz>."),
      cwd,
    ),
    overwrite: readBoolean(source, "overwrite"),
    apply: readApply(source),
  };
}

export function readVerifyOptions(ctx: unknown): RspaceVerifyOptions {
  const cwd = getCurrentDirectory(ctx);
  const source = collectOptionSources(ctx);

  return {
    input: resolveUserPath(
      readRequiredString(source, "input", "Pass --input <rspace-dir-or-archive>."),
      cwd,
    ),
  };
}

export function getCurrentDirectory(ctx: unknown): string {
  const typed = ctx as RspaceCommandContext | undefined;

  if (typeof typed?.cwd === "function") {
    return typed.cwd();
  }

  if (typeof typed?.cwd === "string" && typed.cwd.length > 0) {
    return typed.cwd;
  }

  return process.cwd();
}

export function logInfo(ctx: unknown, message: string): void {
  const typed = ctx as RspaceCommandContext | undefined;

  if (typed?.log?.info) {
    typed.log.info(message);
    return;
  }

  console.log(message);
}

export function logWarn(ctx: unknown, message: string): void {
  const typed = ctx as RspaceCommandContext | undefined;

  if (typed?.log?.warn) {
    typed.log.warn(message);
    return;
  }

  console.warn(message);
}

export function collectOptionSources(ctx: unknown): Record<string, unknown> {
  const typed = ctx as RspaceCommandContext | undefined;

  return {
    ...typed?.parsed?.values,
    ...typed?.parsed?.options,
    ...typed?.parsed?.args,
    ...typed?.values,
    ...typed?.options,
    ...typed?.flags,
    ...typed?.argv,
    ...typed?.args,
  };
}

function readCustomPath(source: Record<string, unknown>, name: string): string | undefined {
  const raw = source["custom-path"];

  if (raw === true) {
    return createDefaultCustomTargetPath(name);
  }

  if (typeof raw !== "string") {
    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return createDefaultCustomTargetPath(name);
  }

  return normalizeRelativeRspacePath(trimmed, "--custom-path");
}

function readRequiredString(
  source: Record<string, unknown>,
  key: string,
  help = `Pass --${key} <value>.`,
): string {
  const value = readOptionalString(source, key);

  if (!value) {
    throw new Error(`Missing required option --${key}. ${help}`);
  }

  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
  }

  return false;
}

function readApply(source: Record<string, unknown>): boolean {
  return readBoolean(source, "apply") || readBoolean(source, "$apply");
}

function normalizePlatform(value: string): RspacePlatform {
  if (SUPPORTED_PLATFORMS.includes(value as RspacePlatform)) {
    return value as RspacePlatform;
  }

  throw new Error(
    `Unsupported platform "${value}". Expected one of: ${SUPPORTED_PLATFORMS.join(", ")}.`,
  );
}
