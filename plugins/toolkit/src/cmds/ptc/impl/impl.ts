import { lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export type PtcOptions = {
  inputPaths: string[];
  outputPath?: string | undefined;
  apply?: boolean | undefined;
  unpack?: boolean | undefined;
  overwrite?: boolean | undefined;
  ext?: string | string[] | undefined;
  extMerge?: string | string[] | undefined;
  ignore?: string | string[] | undefined;
  maxSize?: string | number | undefined;
  includeHidden?: boolean | undefined;
};

type CliConfig = {
  inputPaths: string[];
  outputPath: string | undefined;
  apply: boolean;
  unpack: boolean;
  overwrite: boolean;
  allowedExts: ReadonlySet<string>;
  allowedTextFileNames: ReadonlySet<string>;
  ignoredNames: ReadonlySet<string>;
  maxSizeBytes: number;
  includeHidden: boolean;
  extMode: ExtMode;
};

type PtcPackRunResult = {
  mode: "pack";
  config: CliConfig;
  result: CollectResult;
  outputInfo: OutputInfo;
  bytesWritten?: number | undefined;
};

type PtcUnpackRunResult = {
  mode: "unpack";
  config: CliConfig;
  unpack: UnpackResult;
  bytesWritten?: number | undefined;
};

export type PtcRunResult = PtcPackRunResult | PtcUnpackRunResult;

type ExtMode = "default" | "exact" | "merge";

type InputType = "file" | "directory" | "missing" | "unsupported";

type InputStatus = "ok" | "failed";

type InputInfo = {
  index: number;
  userPath: string;
  absPath: string;
  label: string;
  type: InputType;
  status: InputStatus;
  error: string | null;
  includedCount: number;
  skippedCount: number;
};

type CollectedFile = {
  absPath: string;
  relPath: string;
  displayPath: string;
  inputIndex: number;
  inputLabel: string;
  sizeBytes: number;
};

type SkippedFile = {
  absPath: string | null;
  relPath: string;
  displayPath: string;
  inputIndex: number;
  inputLabel: string;
  reason: string;
};

type CollectResult = {
  inputs: InputInfo[];
  included: CollectedFile[];
  skipped: SkippedFile[];
  warnings: string[];
  recommendations: string[];
  outputAbsPath: string;
  hasMultipleInputs: boolean;
};

type CollectState = {
  included: CollectedFile[];
  skipped: SkippedFile[];
  seenFiles: Set<string>;
  outputAbsPath: string;
  hasMultipleInputs: boolean;
};

type OutputInfo = {
  exists: boolean;
  isFile: boolean;
};

type PackedInputRoot = {
  index: number;
  label: string;
  resolvedPath: string;
  relativeRoot: string;
};

type UnpackFile = {
  packedPath: string;
  relativeTargetPath: string;
  targetAbsPath: string;
  inputLabel: string;
  expectedSizeBytes: number;
  contentBytes: number;
  content: string;
  exists: boolean;
  action: "write" | "overwrite";
  skippedReason: string | null;
};

type UnpackResult = {
  inputAbsPath: string;
  packedProjectRoot: string;
  baseAbsPath: string;
  baseProvidedBy: "cwd" | "output";
  inputRoots: PackedInputRoot[];
  files: UnpackFile[];
  warnings: string[];
  recommendations: string[];
};

type PackedBlockHeader = {
  index: number;
  contentStart: number;
  filePath: string;
  inputLabel: string;
  sizeBytes: number;
};

class PackedPathError extends Error {}

type OutputWriter = {
  write: (chunk: string) => Promise<void>;
  end: () => Promise<void>;
  bytesWritten: () => number;
};

type NodeError = Error & {
  code?: string;
};

type SizeUnit = "b" | "kb" | "kib" | "mb" | "mib" | "gb" | "gib";

const DEFAULT_OUTPUT_FILE = "packed-context.txt";
const DEFAULT_MAX_SIZE_BYTES = 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8192;
const PACKED_BLOCK_SEPARATOR =
  "================================================================================";

const SIZE_MULTIPLIERS: Record<SizeUnit, number> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

const DEFAULT_IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".idea",
  ".vscode",
  ".history",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".output",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  ".vitest",
  ".pytest_cache",
  "__pycache__",
  "tmp",
  "temp",
  "logs",
  "log",
  ".pnpm-store",
  ".yarn",
  ".bun",
]);

const DEFAULT_TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".ini",
  ".env",
  ".example",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sql",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".inc",
  ".pwn",
]);

const DEFAULT_TEXT_FILE_NAMES = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "procfile",
  "license",
  "notice",
  "readme",
  "changelog",
  "contributing",
]);

export async function runPtc(options: PtcOptions): Promise<PtcRunResult> {
  const config = createPtcConfig(options);

  if (config.unpack) {
    return runPtcUnpack(config);
  }

  return runPtcPack(config);
}

async function runPtcPack(config: CliConfig): Promise<PtcPackRunResult> {
  const result = await collectFiles(config);
  const outputInfo = await inspectOutputPath(result);

  addOutputWarnings(config, result, outputInfo);

  if (!config.apply) {
    return { mode: "pack", config, result, outputInfo };
  }

  if (hasFailedInputs(result)) {
    throw new Error("Apply aborted because one or more input paths failed.");
  }

  if (outputInfo.exists && !config.overwrite) {
    throw new Error(
      `Output file already exists: ${result.outputAbsPath}. Pass --overwrite to replace it.`,
    );
  }

  await prepareOutputFile(result.outputAbsPath);

  const writer = createOutputWriter(result.outputAbsPath);
  let writeFailed = false;

  try {
    await writeOutput(writer, config, result, outputInfo);
  } catch (error) {
    writeFailed = true;
    throw error;
  } finally {
    try {
      await writer.end();
    } catch (error) {
      if (!writeFailed) {
        throw error;
      }
    }
  }

  return {
    mode: "pack",
    config,
    result,
    outputInfo,
    bytesWritten: writer.bytesWritten(),
  };
}

async function runPtcUnpack(config: CliConfig): Promise<PtcUnpackRunResult> {
  const inputAbsPath = resolveUserPath(config.inputPaths[0] ?? "");
  const inputStats = await lstat(inputAbsPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Packed context file does not exist: ${inputAbsPath}`);
    }

    throw error;
  });

  if (!inputStats.isFile()) {
    throw new Error(`Packed context input must be a file: ${inputAbsPath}`);
  }

  const packedText = await readTextFile(inputAbsPath);
  const unpack = await createUnpackPlan({
    configuredBasePath: config.outputPath,
    inputAbsPath,
    overwrite: config.overwrite,
    packedText,
  });

  if (!config.apply) {
    return { mode: "unpack", config, unpack };
  }

  let bytesWritten = 0;

  for (const file of unpack.files) {
    if (file.skippedReason) {
      continue;
    }

    await mkdir(path.dirname(file.targetAbsPath), { recursive: true });
    await Bun.write(file.targetAbsPath, file.content);
    bytesWritten += file.contentBytes;
  }

  return { mode: "unpack", config, unpack, bytesWritten };
}

function createPtcConfig(options: PtcOptions): CliConfig {
  const inputPaths = options.inputPaths.map((inputPath) => inputPath.trim()).filter(Boolean);
  const unpack = options.unpack === true;
  const outputPath = options.outputPath?.trim() || (unpack ? undefined : DEFAULT_OUTPUT_FILE);
  const extFilter = normalizeCsvInput(options.ext);
  const extMergeFilter = normalizeCsvInput(options.extMerge);
  const maxSizeBytes = normalizeMaxSize(options.maxSize);
  const includeHidden = options.includeHidden === true;
  const apply = options.apply === true;
  const overwrite = options.overwrite === true;
  const extraIgnoredNames = new Set(normalizeCsvInput(options.ignore));

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
    ignoredNames: new Set(
      [...DEFAULT_IGNORED_NAMES, ...extraIgnoredNames].map((name) => name.trim()).filter(Boolean),
    ),
    maxSizeBytes,
    includeHidden,
    extMode: textRules.extMode,
  };
}

function normalizeCsvInput(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const normalized = values.flatMap(splitCsv);

  return normalized.length > 0 ? normalized : undefined;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizePathForDisplay(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveUserPath(userPath: string): string {
  return path.normalize(path.resolve(process.cwd(), userPath));
}

async function collectFiles(config: CliConfig): Promise<CollectResult> {
  const outputAbsPath = resolveUserPath(config.outputPath ?? DEFAULT_OUTPUT_FILE);
  const inputs = await inspectInputPaths(config.inputPaths);
  assignInputLabels(inputs);

  const state: CollectState = {
    included: [],
    skipped: [],
    seenFiles: new Set(),
    outputAbsPath,
    hasMultipleInputs: inputs.length > 1,
  };

  const result: CollectResult = {
    inputs,
    included: state.included,
    skipped: state.skipped,
    warnings: detectInputWarnings(inputs),
    recommendations: [],
    outputAbsPath,
    hasMultipleInputs: state.hasMultipleInputs,
  };

  if (result.warnings.some((warning) => warning.includes("Overlapping inputs"))) {
    result.recommendations.push(
      "Remove overlapping input paths if you want a shorter summary and fewer duplicate-skip entries.",
    );
  }

  for (const input of inputs) {
    if (input.type === "missing") {
      addInputLevelSkipped(input, state, "missing input");
      continue;
    }

    if (input.type === "unsupported") {
      addInputLevelSkipped(input, state, input.error ?? "unsupported file type");
      continue;
    }

    if (input.type === "file") {
      await collectSingleFile({
        absPath: input.absPath,
        rootPath: path.dirname(input.absPath),
        input,
        config,
        state,
        skipHidden: false,
      });
      continue;
    }

    await walkDirectory(input.absPath, input.absPath, input, config, state);
  }

  state.included.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
  state.skipped.sort(
    (left, right) =>
      left.displayPath.localeCompare(right.displayPath) || left.reason.localeCompare(right.reason),
  );

  return result;
}

async function inspectInputPaths(userPaths: string[]): Promise<InputInfo[]> {
  const inputs: InputInfo[] = [];

  for (let index = 0; index < userPaths.length; index += 1) {
    const userPath = userPaths[index] ?? "";
    inputs.push(await inspectInputPath(userPath, index));
  }

  return inputs;
}

async function inspectInputPath(userPath: string, index: number): Promise<InputInfo> {
  const absPath = resolveUserPath(userPath);
  const baseInput = {
    index,
    userPath,
    absPath,
    label: "",
    includedCount: 0,
    skippedCount: 0,
  };

  try {
    const inputStats = await lstat(absPath);

    if (inputStats.isSymbolicLink()) {
      return {
        ...baseInput,
        type: "unsupported",
        status: "failed",
        error: "symlink",
      };
    }

    if (inputStats.isFile()) {
      return {
        ...baseInput,
        type: "file",
        status: "ok",
        error: null,
      };
    }

    if (inputStats.isDirectory()) {
      return {
        ...baseInput,
        type: "directory",
        status: "ok",
        error: null,
      };
    }

    return {
      ...baseInput,
      type: "unsupported",
      status: "failed",
      error: "unsupported file type",
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ...baseInput,
        type: "missing",
        status: "failed",
        error: "missing input",
      };
    }

    return {
      ...baseInput,
      type: "unsupported",
      status: "failed",
      error: "cannot read metadata",
    };
  }
}

function assignInputLabels(inputs: InputInfo[]) {
  const usedLabels = new Map<string, number>();

  for (const input of inputs) {
    const baseLabel = getInputBaseLabel(input);
    const labelKey = baseLabel.toLowerCase();
    const nextCount = (usedLabels.get(labelKey) ?? 0) + 1;
    usedLabels.set(labelKey, nextCount);
    input.label = nextCount === 1 ? baseLabel : `${baseLabel}~${nextCount}`;
  }
}

function getInputBaseLabel(input: InputInfo): string {
  const baseName = path.basename(input.absPath);

  if (baseName) {
    return normalizePathForDisplay(baseName);
  }

  return `input-${input.index + 1}`;
}

function detectInputWarnings(inputs: InputInfo[]): string[] {
  const warnings: string[] = [];
  const okInputs = inputs.filter((input) => input.status === "ok");

  for (let leftIndex = 0; leftIndex < okInputs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < okInputs.length; rightIndex += 1) {
      const left = okInputs[leftIndex];
      const right = okInputs[rightIndex];

      if (!left || !right) {
        continue;
      }

      if (isSamePath(left.absPath, right.absPath)) {
        warnings.push(
          `Duplicate input path detected: ${left.userPath} and ${right.userPath}. Files will be included once.`,
        );
        continue;
      }

      if (left.type === "directory" && isPathInside(left.absPath, right.absPath)) {
        warnings.push(
          `Overlapping inputs detected: ${left.userPath} contains ${right.userPath}. Duplicate files will be skipped.`,
        );
        continue;
      }

      if (right.type === "directory" && isPathInside(right.absPath, left.absPath)) {
        warnings.push(
          `Overlapping inputs detected: ${right.userPath} contains ${left.userPath}. Duplicate files will be skipped.`,
        );
      }
    }
  }

  return warnings;
}

async function collectSingleFile(options: {
  absPath: string;
  rootPath: string;
  input: InputInfo;
  config: CliConfig;
  state: CollectState;
  skipHidden: boolean;
}) {
  const { absPath, rootPath, input, config, state, skipHidden } = options;
  const name = path.basename(absPath);
  const relPath = normalizePathForDisplay(path.relative(rootPath, absPath) || name);

  if (isSamePath(absPath, state.outputAbsPath)) {
    addSkipped(input, state, relPath, "output file", absPath);
    return;
  }

  const nameSkipReason = getNameSkipReason(name, config, { skipHidden });

  if (nameSkipReason) {
    addSkipped(input, state, relPath, nameSkipReason, absPath);
    return;
  }

  const textPathSkipReason = getTextPathSkipReason(absPath, config);

  if (textPathSkipReason) {
    addSkipped(input, state, relPath, textPathSkipReason, absPath);
    return;
  }

  let fileStats;

  try {
    fileStats = await lstat(absPath);
  } catch {
    addSkipped(input, state, relPath, "cannot read metadata", absPath);
    return;
  }

  if (fileStats.isSymbolicLink()) {
    addSkipped(input, state, relPath, "symlink", absPath);
    return;
  }

  if (!fileStats.isFile()) {
    addSkipped(input, state, relPath, "unsupported file type", absPath);
    return;
  }

  if (fileStats.size > config.maxSizeBytes) {
    addSkipped(input, state, relPath, "larger than max size", absPath);
    return;
  }

  const normalizedAbsPath = path.normalize(path.resolve(absPath));

  if (state.seenFiles.has(normalizedAbsPath)) {
    addSkipped(input, state, relPath, "duplicate file from overlapping input", absPath);
    return;
  }

  if (await looksBinary(absPath)) {
    addSkipped(input, state, relPath, "binary content", absPath);
    return;
  }

  state.seenFiles.add(normalizedAbsPath);
  input.includedCount += 1;

  state.included.push({
    absPath,
    relPath,
    displayPath: makeDisplayPath(input, relPath, state.hasMultipleInputs),
    inputIndex: input.index,
    inputLabel: input.label,
    sizeBytes: fileStats.size,
  });
}

async function walkDirectory(
  dirAbsPath: string,
  rootPath: string,
  input: InputInfo,
  config: CliConfig,
  state: CollectState,
) {
  let entries;

  try {
    entries = await readdir(dirAbsPath, { withFileTypes: true });
  } catch {
    const relPath = normalizePathForDisplay(path.relative(rootPath, dirAbsPath) || ".");
    addSkipped(input, state, relPath, "cannot read directory", dirAbsPath);
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryAbsPath = path.normalize(path.join(dirAbsPath, entry.name));
    const relPath = normalizePathForDisplay(path.relative(rootPath, entryAbsPath));

    if (isSamePath(entryAbsPath, state.outputAbsPath)) {
      addSkipped(input, state, relPath, "output file", entryAbsPath);
      continue;
    }

    const nameSkipReason = getNameSkipReason(entry.name, config, {
      skipHidden: true,
    });

    if (nameSkipReason) {
      addSkipped(input, state, relPath, nameSkipReason, entryAbsPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      addSkipped(input, state, relPath, "symlink", entryAbsPath);
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(entryAbsPath, rootPath, input, config, state);
      continue;
    }

    if (entry.isFile()) {
      await collectSingleFile({
        absPath: entryAbsPath,
        rootPath,
        input,
        config,
        state,
        skipHidden: true,
      });
      continue;
    }

    addSkipped(input, state, relPath, "unsupported file type", entryAbsPath);
  }
}

function addSkipped(
  input: InputInfo,
  state: CollectState,
  relPath: string,
  reason: string,
  absPath: string | null,
) {
  input.skippedCount += 1;

  state.skipped.push({
    absPath,
    relPath,
    displayPath: makeDisplayPath(input, relPath, state.hasMultipleInputs),
    inputIndex: input.index,
    inputLabel: input.label,
    reason,
  });
}

function addInputLevelSkipped(input: InputInfo, state: CollectState, reason: string) {
  input.skippedCount += 1;

  state.skipped.push({
    absPath: input.absPath,
    relPath: input.label,
    displayPath: input.label,
    inputIndex: input.index,
    inputLabel: input.label,
    reason,
  });
}

function makeDisplayPath(input: InputInfo, relPath: string, hasMultipleInputs: boolean): string {
  const cleanRelPath = relPath === "." ? input.label : relPath;

  if (!hasMultipleInputs) {
    return cleanRelPath;
  }

  if (input.type === "file") {
    return input.label;
  }

  return normalizePathForDisplay(path.posix.join(input.label, cleanRelPath));
}

function getNameSkipReason(
  name: string,
  config: CliConfig,
  options: { skipHidden: boolean },
): string | null {
  if (config.ignoredNames.has(name)) {
    return "ignored name";
  }

  if (options.skipHidden && !config.includeHidden && name.startsWith(".")) {
    return "hidden path";
  }

  return null;
}

function getTextPathSkipReason(filePath: string, config: CliConfig): string | null {
  if (isTextPathAllowed(filePath, config)) {
    return null;
  }

  return "extension not allowed";
}

function isTextPathAllowed(filePath: string, config: CliConfig): boolean {
  const baseName = path.basename(filePath).toLowerCase();

  if (config.allowedTextFileNames.has(baseName)) {
    return true;
  }

  if (config.allowedExts.has(baseName)) {
    return true;
  }

  const ext = normalizeExtension(path.extname(baseName));

  return Boolean(ext) && config.allowedExts.has(ext);
}

function isSamePath(leftPath: string, rightPath: string): boolean {
  return path.normalize(path.resolve(leftPath)) === path.normalize(path.resolve(rightPath));
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = path.relative(parentPath, childPath);
  return Boolean(relPath) && !relPath.startsWith("..") && !path.isAbsolute(relPath);
}

async function looksBinary(filePath: string): Promise<boolean> {
  try {
    const absPath = path.normalize(path.resolve(filePath));
    const sample = new Uint8Array(
      await Bun.file(absPath).slice(0, BINARY_SAMPLE_BYTES).arrayBuffer(),
    );

    if (sample.length === 0) {
      return false;
    }

    for (const byte of sample) {
      if (byte === 0) {
        return true;
      }
    }

    const decoded = new TextDecoder("utf-8").decode(sample);
    let replacementChars = 0;

    for (const char of decoded) {
      if (char === "\uFFFD") {
        replacementChars += 1;
      }
    }

    return replacementChars >= 8 || replacementChars / Math.max(decoded.length, 1) > 0.01;
  } catch {
    return true;
  }
}

async function readTextFile(filePath: string): Promise<string> {
  return Bun.file(path.normalize(path.resolve(filePath))).text();
}

async function inspectOutputPath(result: CollectResult): Promise<OutputInfo> {
  for (const input of result.inputs) {
    if (input.type === "file" && isSamePath(input.absPath, result.outputAbsPath)) {
      throw new Error(`Output file must be different from input file: ${result.outputAbsPath}`);
    }
  }

  try {
    const outputStats = await lstat(result.outputAbsPath);

    if (outputStats.isDirectory()) {
      throw new Error(`Output path is a directory, expected a file path: ${result.outputAbsPath}`);
    }

    return {
      exists: true,
      isFile: outputStats.isFile(),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        exists: false,
        isFile: false,
      };
    }

    throw error;
  }
}

function addOutputWarnings(config: CliConfig, result: CollectResult, outputInfo: OutputInfo) {
  if (!outputInfo.exists) {
    return;
  }

  if (config.overwrite) {
    result.warnings.push(
      `Output file already exists and will be overwritten because --overwrite is enabled: ${result.outputAbsPath}`,
    );
    return;
  }

  if (config.apply) {
    result.warnings.push(
      `Output file already exists and apply will fail without --overwrite: ${result.outputAbsPath}`,
    );
    return;
  }

  result.warnings.push(
    `Output file already exists: ${result.outputAbsPath}. Pass --overwrite with --apply to replace it.`,
  );
}

async function createUnpackPlan(options: {
  configuredBasePath: string | undefined;
  inputAbsPath: string;
  overwrite: boolean;
  packedText: string;
}): Promise<UnpackResult> {
  const packedProjectRoot = parsePackedProjectRoot(options.packedText);
  const baseAbsPath = options.configuredBasePath
    ? resolveUserPath(options.configuredBasePath)
    : path.normalize(process.cwd());
  const baseProvidedBy = options.configuredBasePath ? "output" : "cwd";

  if (!isSamePath(baseAbsPath, packedProjectRoot)) {
    throw new Error(
      [
        "Unpack base path does not match the original packed project root.",
        `Expected: ${packedProjectRoot}`,
        `Actual: ${baseAbsPath}`,
        "Fix: run the command from the original project root, or pass that exact path with -o.",
      ].join("\n"),
    );
  }

  const inputRoots = parsePackedInputRoots(options.packedText, packedProjectRoot);
  const headers = parsePackedBlockHeaders(options.packedText);

  if (headers.length === 0) {
    throw new Error("No packed file blocks found. Expected a PTC file generated by `rse ptc`.");
  }

  const inputRootsByLabel = new Map(inputRoots.map((root) => [root.label, root]));
  const files: UnpackFile[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const seenTargets = new Set<string>();

  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const nextHeader = headers[index + 1];

    if (!header) {
      continue;
    }

    const rawContent = options.packedText.slice(
      header.contentStart,
      nextHeader ? nextHeader.index : options.packedText.length,
    );
    const content = normalizeUnpackedContent(rawContent, header.sizeBytes);
    const contentBytes = getUtf8ByteLength(content);
    const inputRoot = inputRootsByLabel.get(header.inputLabel);
    let targetAbsPath = "";
    let relativeTargetPath = header.filePath;
    let exists = false;
    let skippedReason: string | null = null;

    if (contentBytes !== header.sizeBytes) {
      skippedReason = `content bytes do not match metadata: expected ${header.sizeBytes}, got ${contentBytes}`;
    }

    if (!inputRoot) {
      skippedReason = skippedReason ?? `unknown input label: ${header.inputLabel}`;
    }

    if (inputRoot) {
      try {
        const resolvedTarget = resolvePackedOutputPath(
          baseAbsPath,
          inputRoot.relativeRoot,
          header.filePath,
        );
        targetAbsPath = resolvedTarget.targetAbsPath;
        relativeTargetPath = resolvedTarget.relativeTargetPath;
      } catch (error) {
        if (error instanceof PackedPathError) {
          skippedReason = skippedReason ?? error.message;
        } else {
          throw error;
        }
      }
    }

    if (targetAbsPath) {
      if (seenTargets.has(targetAbsPath)) {
        skippedReason = skippedReason ?? "duplicate target path in packed context";
      }

      seenTargets.add(targetAbsPath);

      try {
        const targetStats = await lstat(targetAbsPath);
        exists = true;

        if (targetStats.isDirectory()) {
          skippedReason = skippedReason ?? "target path is a directory";
        } else if (targetStats.isSymbolicLink()) {
          skippedReason = skippedReason ?? "target path is a symlink";
        } else if (!targetStats.isFile()) {
          skippedReason = skippedReason ?? "target path is not a regular file";
        } else if (!options.overwrite) {
          skippedReason = skippedReason ?? "target file already exists";
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          skippedReason = skippedReason ?? "cannot inspect target path";
        }
      }
    }

    files.push({
      packedPath: header.filePath,
      relativeTargetPath,
      targetAbsPath,
      inputLabel: header.inputLabel,
      expectedSizeBytes: header.sizeBytes,
      contentBytes,
      content,
      exists,
      action: exists ? "overwrite" : "write",
      skippedReason,
    });
  }

  const skippedFiles = files.filter((file) => file.skippedReason);

  if (skippedFiles.length > 0) {
    warnings.push(
      `${skippedFiles.length} file(s) will be skipped. See the skipped file list above.`,
    );
  }

  if (!options.overwrite && files.some((file) => file.exists)) {
    recommendations.push(
      "Re-run with --overwrite --apply if replacing existing target files is intentional.",
    );
  }

  return {
    inputAbsPath: options.inputAbsPath,
    packedProjectRoot,
    baseAbsPath,
    baseProvidedBy,
    inputRoots,
    files,
    warnings,
    recommendations,
  };
}

function parsePackedProjectRoot(packedText: string): string {
  const outputFileMatch = packedText.match(/^- Output file: (.+)$/m);

  if (!outputFileMatch?.[1]) {
    throw new Error(
      "Packed context is missing `Output file` metadata, so the original project root cannot be verified.",
    );
  }

  return path.normalize(path.dirname(outputFileMatch[1].trim()));
}

function parsePackedInputRoots(packedText: string, packedProjectRoot: string): PackedInputRoot[] {
  const lines = packedText.split(/\r?\n/);
  const roots: PackedInputRoot[] = [];
  let current: (Partial<PackedInputRoot> & { index: number }) | null = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    if (!current.label || !current.resolvedPath) {
      current = null;
      return;
    }

    const resolvedPath = path.normalize(current.resolvedPath);

    if (
      !isSamePath(resolvedPath, packedProjectRoot) &&
      !isPathInside(packedProjectRoot, resolvedPath)
    ) {
      throw new Error(
        `Packed input root is outside the original project root: ${resolvedPath}. Refusing to unpack absolute paths outside the project tree.`,
      );
    }

    roots.push({
      index: current.index,
      label: current.label,
      resolvedPath,
      relativeRoot: normalizePathForDisplay(path.relative(packedProjectRoot, resolvedPath)),
    });
    current = null;
  };

  for (const line of lines) {
    const inputMatch = line.match(/^- Input (\d+): /);

    if (inputMatch) {
      pushCurrent();
      current = { index: Number(inputMatch[1]) - 1 };
      continue;
    }

    if (!current) {
      continue;
    }

    const labelMatch = line.match(/^  - Label: (.+)$/);

    if (labelMatch?.[1]) {
      current.label = labelMatch[1].trim();
      continue;
    }

    const resolvedMatch = line.match(/^  - Resolved: (.+)$/);

    if (resolvedMatch?.[1]) {
      current.resolvedPath = resolvedMatch[1].trim();
    }
  }

  pushCurrent();

  if (roots.length === 0) {
    throw new Error("Packed context is missing input root metadata.");
  }

  return roots;
}

function parsePackedBlockHeaders(packedText: string): PackedBlockHeader[] {
  const headerPattern = new RegExp(
    String.raw`^${escapeRegExp(PACKED_BLOCK_SEPARATOR)}\nFILE: ([^\n]+)\nINPUT: ([^\n]*)\nSIZE: (\d+) bytes\n${escapeRegExp(PACKED_BLOCK_SEPARATOR)}\n`,
    "gm",
  );
  const headers: PackedBlockHeader[] = [];

  for (const match of packedText.matchAll(headerPattern)) {
    const filePath = match[1];
    const inputLabel = match[2] ?? "";
    const rawSizeBytes = match[3];

    if (!filePath || !rawSizeBytes) {
      continue;
    }

    headers.push({
      index: match.index,
      contentStart: match.index + match[0].length,
      filePath,
      inputLabel,
      sizeBytes: Number(rawSizeBytes),
    });
  }

  return headers;
}

function normalizeUnpackedContent(rawContent: string, expectedSizeBytes: number): string {
  let content = rawContent;

  while (
    content.length > 0 &&
    content.endsWith("\n") &&
    getUtf8ByteLength(content) > expectedSizeBytes
  ) {
    content = content.slice(0, -1);
  }

  return content;
}

function resolvePackedOutputPath(
  baseAbsPath: string,
  relativeInputRoot: string,
  packedPath: string,
): { relativeTargetPath: string; targetAbsPath: string } {
  const normalizedPackedPath = packedPath.replaceAll("\\", "/");

  if (path.posix.isAbsolute(normalizedPackedPath) || path.win32.isAbsolute(normalizedPackedPath)) {
    throw new PackedPathError(`Packed file path must be relative: ${packedPath}`);
  }

  const normalizedRelativeFilePath = path.posix.normalize(normalizedPackedPath);

  if (
    normalizedRelativeFilePath === "." ||
    normalizedRelativeFilePath === ".." ||
    normalizedRelativeFilePath.startsWith("../")
  ) {
    throw new PackedPathError(`Packed file path escapes the input root: ${packedPath}`);
  }

  const normalizedRelativeInputRoot = relativeInputRoot === "." ? "" : relativeInputRoot;
  const relativeTargetPath = normalizePathForDisplay(
    path.posix.normalize(path.posix.join(normalizedRelativeInputRoot, normalizedRelativeFilePath)),
  );

  if (
    relativeTargetPath === "." ||
    relativeTargetPath === ".." ||
    relativeTargetPath.startsWith("../")
  ) {
    throw new PackedPathError(`Packed target path escapes the output directory: ${packedPath}`);
  }

  const targetAbsPath = path.normalize(path.resolve(baseAbsPath, relativeTargetPath));

  if (!isSamePath(targetAbsPath, baseAbsPath) && !isPathInside(baseAbsPath, targetAbsPath)) {
    throw new PackedPathError(`Packed file path escapes the output directory: ${packedPath}`);
  }

  return { relativeTargetPath, targetAbsPath };
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasFailedInputs(result: CollectResult): boolean {
  return result.inputs.some((input) => input.status === "failed");
}

async function prepareOutputFile(outputPath: string) {
  await mkdir(path.dirname(outputPath), { recursive: true });
}

function createOutputWriter(outputPath: string): OutputWriter {
  const sink = Bun.file(outputPath).writer();
  const encoder = new TextEncoder();
  let writtenBytes = 0;

  return {
    async write(chunk: string) {
      const writeResult = await sink.write(chunk);
      writtenBytes +=
        typeof writeResult === "number" && Number.isFinite(writeResult)
          ? writeResult
          : encoder.encode(chunk).byteLength;
    },
    async end() {
      await sink.end();
    },
    bytesWritten() {
      return writtenBytes;
    },
  };
}

async function writeOutput(
  writer: OutputWriter,
  config: CliConfig,
  result: CollectResult,
  outputInfo: OutputInfo,
) {
  await writeSummary(writer, config, result, outputInfo);
  await writer.write("\n## Content\n");

  for (const file of result.included) {
    const content = await readTextFile(file.absPath);
    await writeFileBlock(writer, file, content);
  }
}

async function writeSummary(
  writer: OutputWriter,
  config: CliConfig,
  result: CollectResult,
  outputInfo: OutputInfo,
) {
  const totalIncludedBytes = getTotalIncludedBytes(result);

  await writer.write("# Packed Text Context\n\n");
  await writer.write("## Summary\n\n");
  await writer.write("- Mode: apply\n");
  await writer.write(`- Output file: ${normalizePathForDisplay(result.outputAbsPath)}\n`);
  await writer.write(`- Output action: ${outputInfo.exists ? "overwritten" : "written"}\n`);
  await writer.write(`- Generated timestamp: ${new Date().toISOString()}\n`);
  await writer.write(`- Input count: ${result.inputs.length}\n`);
  await writer.write(`- Included files: ${result.included.length}\n`);
  await writer.write(`- Skipped files: ${result.skipped.length}\n`);
  await writer.write(`- Total included bytes: ${totalIncludedBytes}\n`);
  await writer.write(
    `- Max file size: ${Number.isFinite(config.maxSizeBytes) ? `${config.maxSizeBytes} bytes` : "unlimited"}\n`,
  );
  await writer.write(`- Hidden files included: ${config.includeHidden ? "yes" : "no"}\n`);
  await writer.write(`- Extension mode: ${config.extMode}\n\n`);

  await writer.write("## Inputs\n\n");

  for (const input of result.inputs) {
    await writer.write(`- Input ${input.index + 1}: ${input.userPath}\n`);
    await writer.write(`  - Label: ${input.label}\n`);
    await writer.write(`  - Resolved: ${normalizePathForDisplay(input.absPath)}\n`);
    await writer.write(`  - Type: ${input.type}\n`);
    await writer.write(`  - Status: ${input.status}\n`);
    await writer.write(`  - Included files: ${input.includedCount}\n`);
    await writer.write(`  - Skipped files: ${input.skippedCount}\n`);

    if (input.error) {
      await writer.write(`  - Error: ${input.error}\n`);
    }
  }

  await writer.write("\n## Warnings\n\n");
  await writeStringList(writer, result.warnings);

  await writer.write("\n## Recommendations\n\n");
  await writeStringList(writer, result.recommendations);

  await writer.write("\n## Included Files\n\n");

  if (result.included.length === 0) {
    await writer.write("- None\n");
  } else {
    for (const file of result.included) {
      await writer.write(
        `- ${file.displayPath} (${file.sizeBytes} bytes, input: ${file.inputLabel})\n`,
      );
    }
  }

  await writer.write("\n## Skipped Files\n\n");

  if (result.skipped.length === 0) {
    await writer.write("- None\n");
  } else {
    for (const skipped of result.skipped) {
      await writer.write(
        `- ${skipped.displayPath} — ${skipped.reason} (input: ${skipped.inputLabel})\n`,
      );
    }
  }
}

async function writeStringList(writer: OutputWriter, values: string[]) {
  if (values.length === 0) {
    await writer.write("- None\n");
    return;
  }

  for (const value of values) {
    await writer.write(`- ${value}\n`);
  }
}

async function writeFileBlock(writer: OutputWriter, file: CollectedFile, content: string) {
  await writer.write(
    "\n================================================================================\n",
  );
  await writer.write(`FILE: ${file.displayPath}\n`);
  await writer.write(`INPUT: ${file.inputLabel}\n`);
  await writer.write(`SIZE: ${file.sizeBytes} bytes\n`);
  await writer.write(
    "================================================================================\n",
  );
  await writer.write(content);

  if (!content.endsWith("\n")) {
    await writer.write("\n");
  }
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

export function formatPtcSummary(run: PtcRunResult): string {
  if (run.mode === "unpack") {
    return formatPtcUnpackSummary(run);
  }

  return formatPtcPackSummary(run);
}

function formatPtcPackSummary(run: PtcPackRunResult): string {
  const { config, result, outputInfo, bytesWritten } = run;
  const lines: string[] = [];

  lines.push(`Mode: ${config.apply ? "apply" : "summary-only"}`);
  lines.push("Operation: pack");
  lines.push(`Input count: ${result.inputs.length}`);
  lines.push(`Output file: ${result.outputAbsPath}`);
  lines.push(`Overwrite enabled: ${config.overwrite ? "yes" : "no"}`);
  lines.push(`Included files: ${result.included.length}`);
  lines.push(`Skipped files: ${result.skipped.length}`);
  lines.push(`Total included bytes: ${getTotalIncludedBytes(result)}`);

  if (typeof bytesWritten === "number") {
    lines.push(`Bytes written: ${bytesWritten}`);
    lines.push(`Output action: ${outputInfo.exists ? "overwritten" : "written"}`);
  }

  lines.push("");
  lines.push("Inputs:");

  for (const input of result.inputs) {
    const parts = [
      `  ${input.index + 1}. ${input.userPath}`,
      `type=${input.type}`,
      `status=${input.status}`,
      `included=${input.includedCount}`,
      `skipped=${input.skippedCount}`,
    ];

    lines.push(parts.join(" · "));
    lines.push(`     resolved=${input.absPath}`);

    if (input.error) {
      lines.push(`     error=${input.error}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");

    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (result.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");

    for (const recommendation of result.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  if (!config.apply) {
    lines.push("");
    lines.push("No output file was written. Re-run with --apply to create the context file.");
  }

  return lines.join("\n");
}

function formatPtcUnpackSummary(run: PtcUnpackRunResult): string {
  const { config, unpack, bytesWritten } = run;
  const lines: string[] = [];
  const skippedFiles = unpack.files.filter((file) => file.skippedReason);
  const writeFiles = unpack.files.filter((file) => file.action === "write" && !file.skippedReason);
  const overwriteFiles = unpack.files.filter(
    (file) => file.action === "overwrite" && !file.skippedReason,
  );

  lines.push(`Mode: ${config.apply ? "apply" : "summary-only"}`);
  lines.push("Operation: unpack");
  lines.push(`Input file: ${unpack.inputAbsPath}`);
  lines.push(`Original project root: ${unpack.packedProjectRoot}`);
  lines.push(`Base path: ${unpack.baseAbsPath}`);
  lines.push(`Base provided by: ${unpack.baseProvidedBy}`);
  lines.push(`Overwrite enabled: ${config.overwrite ? "yes" : "no"}`);
  lines.push(`Packed files: ${unpack.files.length}`);
  lines.push(`Files to write: ${writeFiles.length}`);
  lines.push(`Files to overwrite: ${overwriteFiles.length}`);
  lines.push(`Files skipped: ${skippedFiles.length}`);

  if (typeof bytesWritten === "number") {
    lines.push(`Bytes written: ${bytesWritten}`);
  }

  lines.push("");
  lines.push("Input roots:");

  for (const root of unpack.inputRoots) {
    lines.push(`  - ${root.label}: ${root.resolvedPath}`);
  }

  if (writeFiles.length > 0) {
    lines.push("");
    lines.push("Files to write:");

    for (const file of writeFiles) {
      lines.push(`- ${file.relativeTargetPath}`);
    }
  }

  if (overwriteFiles.length > 0) {
    lines.push("");
    lines.push("Files to overwrite:");

    for (const file of overwriteFiles) {
      lines.push(`- ${file.relativeTargetPath}`);
    }
  }

  if (skippedFiles.length > 0) {
    lines.push("");
    lines.push("Skipped files:");

    for (const file of skippedFiles) {
      lines.push(`- ${file.relativeTargetPath} — ${file.skippedReason}`);
    }
  }

  if (unpack.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");

    for (const warning of unpack.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (unpack.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");

    for (const recommendation of unpack.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  if (!config.apply) {
    lines.push("");
    lines.push("No files were written. Re-run with --apply to unpack the context file.");
  }

  return lines.join("\n");
}

function getTotalIncludedBytes(result: CollectResult): number {
  return result.included.reduce((total, file) => total + file.sizeBytes, 0);
}

function isSizeUnit(value: string): value is SizeUnit {
  return value in SIZE_MULTIPLIERS;
}

function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}
