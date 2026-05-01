import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { normalizeExtension } from "./config";
import { DEFAULT_OUTPUT_FILE } from "./constants";
import type {
  CliConfig,
  CollectResult,
  CollectState,
  InputInfo,
  InputType,
} from "./types";
import { isNodeError } from "./utils/errors";
import { isPathInside, isSamePath, normalizePathForDisplay, resolveUserPath } from "./utils/path";
import { looksBinary } from "./utils/text";

export async function collectFiles(config: CliConfig): Promise<CollectResult> {
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

export function hasFailedInputs(result: CollectResult): boolean {
  return result.inputs.some((input) => input.status === "failed");
}

export function getTotalIncludedBytes(result: CollectResult): number {
  return result.included.reduce((total, file) => total + file.sizeBytes, 0);
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
      return createFailedInput(baseInput, "unsupported", "symlink");
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

    return createFailedInput(baseInput, "unsupported", "unsupported file type");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return createFailedInput(baseInput, "missing", "missing input");
    }

    return createFailedInput(baseInput, "unsupported", "cannot read metadata");
  }
}

function createFailedInput(
  baseInput: Omit<InputInfo, "type" | "status" | "error">,
  type: Extract<InputType, "missing" | "unsupported">,
  error: string,
): InputInfo {
  return {
    ...baseInput,
    type,
    status: "failed",
    error,
  };
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