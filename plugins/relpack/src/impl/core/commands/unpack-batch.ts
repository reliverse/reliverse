import path from "node:path";

import { relpackError, RelpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import {
  cleanOutputDirectory,
  createOutputBackup,
  deleteExistingFile,
  rollbackOutputFromBackup,
} from "../fs";
import type {
  BatchOutputBackup,
  BatchUnpackItem,
  BatchUnpackItemResult,
  BatchUnpackRequest,
  BatchUnpackResult,
  CommandContext,
  PostCheckResult,
} from "../types";
import { unpackArchive, runPostCheck } from "./unpack";

export async function unpackArchiveBatch(
  request: BatchUnpackRequest,
  ctx: CommandContext,
): Promise<BatchUnpackResult> {
  validateBatchRequest(request);

  if (request.dryRun) {
    const items = await previewBatchUnpack(request, ctx);
    return {
      items,
      backups: [],
      backupCreated: false,
      rolledBack: false,
    };
  }

  const backups = request.backup === true ? await createBatchBackups(request) : [];
  let rolledBack = false;

  try {
    const items = await extractBatchItems(request, ctx);
    const postCheck = request.postCheckCommand
      ? await runPostCheck(request.postCheckCommand, ctx)
      : undefined;

    if (postCheck !== undefined && !postCheck.ok) {
      throw relpackError(
        "post-check-failed",
        `Post-check command failed with exit code ${postCheck.exitCode}: ${request.postCheckCommand}`,
        postCheck.stderr ||
          postCheck.stdout ||
          "Fix the extracted files or rerun with --rollback-on-fail to restore the backup automatically.",
      );
    }

    return {
      items,
      backups,
      backupCreated: backups.some((backup) => backup.backupPath !== undefined),
      rolledBack,
      ...(postCheck === undefined ? {} : { postCheck }),
    };
  } catch (error) {
    if (request.rollbackOnFail === true) {
      await rollbackBatchOutputs(request, backups);
      rolledBack = true;
    }

    if (error instanceof RelpackError && rolledBack) {
      throw relpackError(
        error.code,
        `${error.message}\nRollback: restored batch output directories from backup state.`,
        error.hint,
      );
    }

    throw error;
  }
}

export async function deleteBatchSourceArchives(
  items: readonly BatchUnpackItemResult[],
  cwd: string,
): Promise<readonly string[]> {
  const deleted: string[] = [];

  for (const item of items) {
    const archivePath = path.resolve(cwd, item.archive);
    await deleteExistingFile(archivePath);
    deleted.push(archivePath);
  }

  return deleted;
}

function validateBatchRequest(request: BatchUnpackRequest): void {
  if (request.items.length === 0) {
    throw relpackError(
      "missing-unpack-inputs",
      "Unpack command requires at least one archive path.",
    );
  }

  if (request.rollbackOnFail === true && request.backup !== true) {
    throw relpackError(
      "rollback-requires-backup",
      "--rollback-on-fail requires --backup so relpack has something to restore.",
    );
  }

  if (request.cleanOutput === true && request.overwrite !== "files") {
    throw relpackError(
      "clean-output-requires-overwrite",
      "--overwrite-mode clean requires overwrite mode because it intentionally deletes output directories before extraction.",
    );
  }

  const duplicateOutputs = findDuplicateOutputDirectories(request.cwd, request.items);
  if (request.cleanOutput === true && duplicateOutputs.length > 0) {
    throw relpackError(
      "batch-clean-output-duplicate-target",
      `Refusing batch clean because more than one archive targets the same output directory: ${duplicateOutputs.join(", ")}`,
      "Use unique -o/--output targets for --overwrite-mode clean, or unpack those archives one command at a time.",
    );
  }

  for (const item of request.items) {
    const outputDir = path.resolve(request.cwd, item.outputDir);
    const archivePath = path.resolve(request.cwd, item.archive);
    if (request.cleanOutput === true && archivePath.startsWith(`${outputDir}${path.sep}`)) {
      throw relpackError(
        "clean-output-archive-inside-output",
        `Refusing to clean output directory because it contains the source archive: ${archivePath}`,
        "Move the archive outside -o/--output before using --overwrite-mode clean.",
      );
    }
  }
}

async function previewBatchUnpack(
  request: BatchUnpackRequest,
  ctx: CommandContext,
): Promise<readonly BatchUnpackItemResult[]> {
  const items: BatchUnpackItemResult[] = [];

  for (const item of request.items) {
    const result = await unpackArchive(
      {
        cwd: request.cwd,
        archive: item.archive,
        outputDir: item.outputDir,
        ...(item.format === undefined ? {} : { format: item.format }),
        overwrite: request.overwrite,
        dryRun: true,
        cleanOutput: request.cleanOutput,
        backup: false,
        rollbackOnFail: false,
      },
      ctx,
    );

    items.push({
      archive: item.archive,
      outputDir: item.outputDir,
      format: normalizeArchiveFormat(item.format ?? detectArchiveFormat(item.archive)),
      result,
    });
  }

  return items;
}

async function createBatchBackups(
  request: BatchUnpackRequest,
): Promise<readonly BatchOutputBackup[]> {
  const outputs = uniqueOutputDirectories(request.cwd, request.items);
  const backups: BatchOutputBackup[] = [];

  for (const outputDir of outputs) {
    const backup = await createOutputBackup(outputDir, request.cwd);
    backups.push({
      outputDir,
      ...(backup.backupPath === undefined ? {} : { backupPath: backup.backupPath }),
      ...(backup.skippedReason === undefined ? {} : { skippedReason: backup.skippedReason }),
    });
  }

  return backups;
}

async function extractBatchItems(
  request: BatchUnpackRequest,
  ctx: CommandContext,
): Promise<readonly BatchUnpackItemResult[]> {
  const items: BatchUnpackItemResult[] = [];

  for (const item of request.items) {
    const result = await unpackArchive(
      {
        cwd: request.cwd,
        archive: item.archive,
        outputDir: item.outputDir,
        ...(item.format === undefined ? {} : { format: item.format }),
        overwrite: request.overwrite,
        dryRun: false,
        cleanOutput: request.cleanOutput,
        backup: false,
        rollbackOnFail: false,
      },
      ctx,
    );

    items.push({
      archive: item.archive,
      outputDir: item.outputDir,
      format: normalizeArchiveFormat(item.format ?? detectArchiveFormat(item.archive)),
      result,
    });
  }

  return items;
}

async function rollbackBatchOutputs(
  request: BatchUnpackRequest,
  backups: readonly BatchOutputBackup[],
): Promise<void> {
  const backupsByOutput = new Map(
    backups.map((backup) => [path.resolve(request.cwd, backup.outputDir), backup]),
  );

  for (const outputDir of uniqueOutputDirectories(request.cwd, request.items).reverse()) {
    const resolvedOutput = path.resolve(request.cwd, outputDir);
    const backup = backupsByOutput.get(resolvedOutput);

    if (backup?.backupPath !== undefined) {
      await rollbackOutputFromBackup(outputDir, backup.backupPath, request.cwd);
      continue;
    }

    await cleanOutputDirectory(outputDir, request.cwd).catch(() => undefined);
  }
}

function uniqueOutputDirectories(cwd: string, items: readonly BatchUnpackItem[]): string[] {
  const seen = new Set<string>();
  const outputs: string[] = [];

  for (const item of items) {
    const resolved = path.resolve(cwd, item.outputDir);
    if (seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    outputs.push(item.outputDir);
  }

  return outputs;
}

function findDuplicateOutputDirectories(cwd: string, items: readonly BatchUnpackItem[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    const resolved = path.resolve(cwd, item.outputDir);
    if (seen.has(resolved)) {
      duplicates.add(resolved);
      continue;
    }

    seen.add(resolved);
  }

  return [...duplicates];
}
