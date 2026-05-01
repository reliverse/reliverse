import {
  DEFAULT_IGNORED_NAMES,
  DEFAULT_MAX_SIZE_BYTES,
  DEFAULT_OUTPUT_FILE,
  DEFAULT_TEXT_EXTS,
  DEFAULT_TEXT_FILE_NAMES,
  SIZE_MULTIPLIERS,
} from "./constants";
import type { CliConfig, ExtMode, PtcOptions, SizeUnit } from "./types";

export function createPtcConfig(options: PtcOptions): CliConfig {
  const inputPaths = options.inputPaths.map((inputPath) => inputPath.trim()).filter(Boolean);
  const unpack = options.unpack === true;
  const outputPath = options.outputPath?.trim() || (unpack ? undefined : DEFAULT_OUTPUT_FILE);
  const extFilter = normalizeCsvInput(options.ext);
  const extMergeFilter = normalizeCsvInput(options.extMerge);
  const maxSizeBytes = normalizeMaxSize(options.maxSize);
  const includeHidden = options.includeHidden === true;
  const apply = options.apply === true;
  const overwrite = options.overwrite === true;
  const extraIgnoredNames = normalizeCsvInput(options.ignore) ?? [];

  if (inputPaths.length === 0) {
    throw new Error(
      "At least one input path is required. Example: rse ptc . -o packed-context.txt",
    );
  }

  if (unpack && inputPaths.length !== 1) {
    throw new Error(
      "Unpack mode expects exactly one packed context file. Example: rse ptc rempts-context.txt --unpack --apply",
    );
  }

  if (extFilter && extMergeFilter) {
    throw new Error("Use either --ext or --ext-merge, not both.");
  }

  const textRules = buildTextRules(extFilter, extMergeFilter);

  return {
    inputPaths,
    outputPath,
    apply,
    unpack,
    overwrite,
    allowedExts: textRules.allowedExts,
    allowedTextFileNames: textRules.allowedTextFileNames,
    ignoredNames: normalizeNameSet([...DEFAULT_IGNORED_NAMES, ...extraIgnoredNames]),
    maxSizeBytes,
    includeHidden,
    extMode: textRules.extMode,
  };
}

export function normalizeCsvInput(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const normalized = values.flatMap(splitCsv);

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNameSet(values: Iterable<string>): ReadonlySet<string> {
  return new Set([...values].map((name) => name.trim()).filter(Boolean));
}

function normalizeMaxSize(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_SIZE_BYTES;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid max size: ${value}.`);
    }

    return Math.floor(value);
  }

  return parseSizeToBytes(value);
}

function parseSizeToBytes(rawValue: string): number {
  const value = rawValue.trim().toLowerCase();

  if (value === "unlimited") {
    return Number.POSITIVE_INFINITY;
  }

  const match = value.match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/);

  if (!match) {
    throw new Error(
      `Invalid max size: ${rawValue}. Use values like 500kb, 1mb, 2000b, or unlimited.`,
    );
  }

  const rawAmount = match[1];
  const rawUnit = match[2] ?? "b";

  if (!rawAmount || !isSizeUnit(rawUnit)) {
    throw new Error(`Invalid max size: ${rawValue}.`);
  }

  const amount = Number(rawAmount);
  const multiplier = SIZE_MULTIPLIERS[rawUnit];

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid max size: ${rawValue}.`);
  }

  return Math.floor(amount * multiplier);
}

function buildTextRules(
  extFilter: string[] | undefined,
  extMergeFilter: string[] | undefined,
): {
  allowedExts: ReadonlySet<string>;
  allowedTextFileNames: ReadonlySet<string>;
  extMode: ExtMode;
} {
  if (extFilter) {
    return {
      allowedExts: buildAllowedExts(extFilter, "--ext", "exact"),
      allowedTextFileNames: new Set(),
      extMode: "exact",
    };
  }

  if (extMergeFilter) {
    return {
      allowedExts: buildAllowedExts(extMergeFilter, "--ext-merge", "merge"),
      allowedTextFileNames: DEFAULT_TEXT_FILE_NAMES,
      extMode: "merge",
    };
  }

  return {
    allowedExts: DEFAULT_TEXT_EXTS,
    allowedTextFileNames: DEFAULT_TEXT_FILE_NAMES,
    extMode: "default",
  };
}

function buildAllowedExts(
  rawExts: string[],
  optionName: string,
  mode: "exact" | "merge",
): ReadonlySet<string> {
  const allowedExts = mode === "merge" ? new Set(DEFAULT_TEXT_EXTS) : new Set<string>();
  const unsupported = new Set<string>();

  for (const rawExt of rawExts) {
    const ext = normalizeExtension(rawExt);

    if (!ext) {
      continue;
    }

    if (!DEFAULT_TEXT_EXTS.has(ext)) {
      unsupported.add(ext);
      continue;
    }

    allowedExts.add(ext);
  }

  if (unsupported.size > 0) {
    throw new Error(
      `Unsupported extension from ${optionName}: ${[...unsupported].sort().join(", ")}. Only safe text extensions are allowed.`,
    );
  }

  if (allowedExts.size === 0) {
    throw new Error(`${optionName} did not include any supported text extensions.`);
  }

  return allowedExts;
}

function isSizeUnit(value: string): value is SizeUnit {
  return value in SIZE_MULTIPLIERS;
}
