import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import pMap from "p-map";

import {
  createEscapedModuleContent,
  extractContentFromEscapedModule,
  unescapeContent,
} from "./content";
import {
  findConvertibleFiles,
  findEscapedFiles,
  parseMap,
  readOptionalTextFile,
  readTextFile,
  writeTextFile,
} from "./files";
import { getEscapeOutputPath, getUnescapeOutputPath } from "./paths";
import { buildEscapeSummary } from "./summary";
import type {
  EscapeAction,
  EscapeFileResult,
  EscapeKind,
  EscapeRunOptions,
  EscapeRunResult,
} from "./types";

const DEFAULT_CONCURRENCY = 8;

export async function runEscape(options: EscapeRunOptions): Promise<EscapeRunResult> {
  const inputPath = resolve(options.inputPath);
  const inputStat = await stat(inputPath).catch(() => {
    throw new Error(`Input path does not exist: ${inputPath}`);
  });
  const isDirectory = inputStat.isDirectory();
  const kind: EscapeKind = options.unescape ? "unescape" : "convert";
  const mappings = options.map ? parseMap(options.map) : null;

  if (options.unescape && options.map) {
    throw new Error("--map can only be used when converting files, not when unescaping.");
  }

  const files = options.unescape
    ? await findEscapedFiles(inputPath, options.recursive)
    : await findConvertibleFiles(inputPath, mappings, options.recursive);

  if (files.length === 0) {
    throw new Error(
      options.unescape ? "No escaped files found to process." : "No files found to process.",
    );
  }

  const fileResults = await pMap(
    files,
    (filePath) =>
      processFile({
        apply: options.apply,
        filePath,
        inputPath,
        isDirectory,
        kind,
        overwrite: options.overwrite,
      }),
    { concurrency: options.concurrency ?? DEFAULT_CONCURRENCY },
  );

  const actions = fileResults.map((result) => result.action);
  const summary = buildEscapeSummary(actions);

  return {
    ...summary,
    command: "escape",
    apply: options.apply,
    preview: !options.apply,
    overwrite: options.overwrite,
    kind,
    inputPath,
    fileCount: files.length,
  };
}

export function formatEscapeActionMessage(action: EscapeAction): string {
  if (action.action === "noop") {
    return `No-op: ${action.outputPath} is already up to date`;
  }

  if (action.action === "blocked") {
    return `Blocked: ${action.outputPath} already exists. Re-run with --overwrite to overwrite.`;
  }

  if (action.action === "planned") {
    return action.reason === "would overwrite output file"
      ? `Preview: would overwrite ${action.outputPath}`
      : `Preview: would write ${action.outputPath}`;
  }

  return action.kind === "unescape"
    ? `Unescaped: ${action.inputPath} -> ${action.outputPath}`
    : `Converted: ${action.inputPath} -> ${action.outputPath}`;
}

async function processFile(options: {
  apply: boolean;
  filePath: string;
  inputPath: string;
  isDirectory: boolean;
  kind: EscapeKind;
  overwrite: boolean;
}): Promise<EscapeFileResult> {
  const outputPath =
    options.kind === "unescape"
      ? getUnescapeOutputPath(options.inputPath, options.filePath, options.isDirectory)
      : getEscapeOutputPath(options.inputPath, options.filePath, options.isDirectory);
  const nextContent =
    options.kind === "unescape"
      ? await buildUnescapedFileContent(options.filePath)
      : await buildEscapedFileContent(options.filePath);
  const existingOutput = await readOptionalTextFile(outputPath);
  const action = createAction({
    existingOutput,
    inputPath: options.filePath,
    kind: options.kind,
    nextContent,
    outputPath,
    overwrite: options.overwrite,
    preview: !options.apply,
  });

  if (action.action === "written") {
    await writeTextFile(outputPath, nextContent);
  }

  return {
    action,
    message: formatEscapeActionMessage(action),
  };
}

async function buildEscapedFileContent(inputPath: string): Promise<string> {
  const content = await readTextFile(inputPath);
  return createEscapedModuleContent(content);
}

async function buildUnescapedFileContent(inputPath: string): Promise<string> {
  const moduleContent = await readTextFile(inputPath);
  const escapedContent = extractContentFromEscapedModule(moduleContent);

  return unescapeContent(escapedContent);
}

function createAction(options: {
  existingOutput: string | undefined;
  inputPath: string;
  kind: EscapeKind;
  nextContent: string;
  outputPath: string;
  overwrite: boolean;
  preview: boolean;
}): EscapeAction {
  if (options.existingOutput === options.nextContent) {
    return {
      action: "noop",
      inputPath: options.inputPath,
      kind: options.kind,
      outputPath: options.outputPath,
      reason: "output already up to date",
    };
  }

  if (options.existingOutput !== undefined && !options.overwrite) {
    return {
      action: "blocked",
      inputPath: options.inputPath,
      kind: options.kind,
      outputPath: options.outputPath,
      reason: "existing output differs; re-run with --overwrite to overwrite",
    };
  }

  if (options.preview) {
    return {
      action: "planned",
      inputPath: options.inputPath,
      kind: options.kind,
      outputPath: options.outputPath,
      reason:
        options.existingOutput === undefined
          ? "would create output file"
          : "would overwrite output file",
    };
  }

  return {
    action: "written",
    inputPath: options.inputPath,
    kind: options.kind,
    outputPath: options.outputPath,
    reason:
      options.existingOutput === undefined
        ? "created output file"
        : "overwrote existing output file",
  };
}
