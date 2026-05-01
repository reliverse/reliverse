import { mkdir } from "node:fs/promises";
import path from "node:path";

import { readCreateOptions, logInfo } from "./context";
import { assertCanWriteOutput, assertDirectory, copyDirectorySafe, writeTextFile } from "./files";
import { createTeamTargetPath, isPathInside, toSafeName } from "./paths";
import { createRspaceState } from "./state";
import { createGeneratedFiles } from "./templates";
import type { RspaceCreateOptions, RspaceCreatePlan, RspaceImportedSource } from "./types";

export async function runRspaceCreateCommand(ctx: unknown): Promise<string> {
  const options = readCreateOptions(ctx);
  const plan = await createCreatePlan(options);

  if (!options.apply) {
    const preview = formatCreatePreview(plan);
    logInfo(ctx, preview);
    return preview;
  }

  await writeRspace(plan);

  const message = `Created Rspace workspace: ${plan.workspacePath}`;
  logInfo(ctx, message);

  return message;
}

async function createCreatePlan(options: RspaceCreateOptions): Promise<RspaceCreatePlan> {
  if (options.input && isPathInside(options.input, options.output)) {
    throw new Error(
      "Output directory cannot be inside the input directory. Choose an output path outside --input.",
    );
  }

  const source = await createSourcePlan(options);
  const state = createRspaceState({
    name: options.name,
    team: options.team,
    entryFile: options.entryFile,
    platform: options.platform,
    source,
    copiedSourceFiles: [],
    now: new Date(),
  });

  return {
    options,
    workspacePath: options.output,
    source,
    generatedFiles: createGeneratedFiles(state),
  };
}

async function writeRspace(plan: RspaceCreatePlan): Promise<void> {
  await assertCanWriteOutput(plan.workspacePath, plan.options.overwrite);

  await mkdir(plan.workspacePath, {
    recursive: true,
  });

  const copiedSourceFiles = await copySourceIfNeeded(plan);
  const state = createRspaceState({
    name: plan.options.name,
    team: plan.options.team,
    entryFile: plan.options.entryFile,
    platform: plan.options.platform,
    source: {
      ...plan.source,
      fileCount: copiedSourceFiles.length,
    },
    copiedSourceFiles,
    now: new Date(),
  });

  for (const [filePath, content] of createGeneratedFiles(state)) {
    await writeTextFile(plan.workspacePath, filePath, content);
  }
}

async function createSourcePlan(options: RspaceCreateOptions): Promise<RspaceImportedSource> {
  const targetPath = options.customPath ?? createTeamTargetPath({
    team: options.team ?? "default",
    name: options.name,
  });

  if (!options.input) {
    return {
      kind: "none",
      name: options.name,
      team: options.team,
      customPath: options.customPath,
      targetPath,
      fileCount: 0,
    };
  }

  await assertDirectory(options.input, "Input");

  return {
    kind: "directory",
    name: toSafeName(path.basename(options.input) || options.name),
    originalPath: options.input,
    targetPath,
    team: options.team,
    customPath: options.customPath,
    fileCount: 0,
  };
}

async function copySourceIfNeeded(plan: RspaceCreatePlan): Promise<string[]> {
  if (plan.source.kind !== "directory" || !plan.source.originalPath || !plan.source.targetPath) {
    return [];
  }

  const targetPath = path.join(plan.workspacePath, plan.source.targetPath);

  return await copyDirectorySafe({
    from: plan.source.originalPath,
    to: targetPath,
  });
}

function formatCreatePreview(plan: RspaceCreatePlan): string {
  const lines = [
    "Rspace create preview",
    "",
    `Name: ${plan.options.name}`,
    `Team: ${plan.options.team ?? "custom-path"}`,
    `Platform: ${plan.options.platform}`,
    `Entry file: ${plan.options.entryFile}`,
    `Output: ${plan.workspacePath}`,
    `Overwrite: ${plan.options.overwrite ? "yes" : "no"}`,
    `Input: ${plan.source.originalPath ?? "none"}`,
    `Import target: ${plan.source.targetPath ?? "none"}`,
    "",
    "Generated files:",
    ...[...plan.generatedFiles.keys()].sort((a, b) => a.localeCompare(b)).map((file) => `- ${file}`),
    "",
    "No files were written. Pass --apply to create the Rspace.",
  ];

  return lines.join("\n");
}
