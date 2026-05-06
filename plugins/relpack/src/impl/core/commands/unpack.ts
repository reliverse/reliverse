import path from "node:path";

import { getAdapterForFormat } from "../adapters/registry";
import { RelpackError, relpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import {
  assertExtractionWillNotCollide,
  cleanOutputDirectory,
  createOutputBackup,
  ensureDirectory,
  rollbackOutputFromBackup,
} from "../fs";
import { isPathInside, resolveInside } from "../path-safety";
import { runProcess } from "../spawn";
import type { CommandContext, PostCheckResult, UnpackRequest, UnpackResult } from "../types";
import { listArchive } from "./list";

export async function unpackArchive(
  request: UnpackRequest,
  ctx: CommandContext,
): Promise<UnpackResult> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const adapter = await getAdapterForFormat(format, ctx);

  if (!adapter.canUnpack || adapter.unpack === undefined) {
    throw relpackError("unpack-unsupported", `Unpacking is not supported for format: ${format}`);
  }

  if (request.cleanOutput === true && request.overwrite !== "files") {
    throw relpackError(
      "clean-output-requires-overwrite",
      "--clean-output requires --overwrite or --overwrite-mode clean because it intentionally deletes the output directory before extraction.",
    );
  }

  if (request.rollbackOnFail === true && request.backup !== true) {
    throw relpackError(
      "rollback-requires-backup",
      "--rollback-on-fail requires --backup so relpack has something to restore.",
    );
  }

  const outputDir = path.resolve(request.cwd, request.outputDir);
  const archivePath = path.resolve(request.cwd, request.archive);

  if (request.cleanOutput === true && isPathInside(outputDir, archivePath)) {
    throw relpackError(
      "clean-output-archive-inside-output",
      `Refusing to clean output directory because it contains the source archive: ${archivePath}`,
      "Move the archive outside -o/--output before using --clean-output.",
    );
  }

  const entries = await listArchive({ cwd: request.cwd, archive: request.archive, format }, ctx);
  for (const entry of entries) {
    resolveInside(outputDir, entry.path);
  }

  if (request.dryRun) {
    const result = await adapter.unpack({ ...request, format, outputDir }, ctx);
    return {
      ...result,
      backupCreated: false,
      backupSkippedReason: request.backup === true ? "preview mode" : undefined,
      rolledBack: false,
    };
  }

  let backupPath: string | undefined;
  let backupSkippedReason: string | undefined;
  let rolledBack = false;

  if (request.backup === true) {
    const backup = await createOutputBackup(outputDir, request.cwd);
    backupPath = backup.backupPath;
    backupSkippedReason = backup.skippedReason;
  }

  try {
    if (request.cleanOutput === true) {
      await cleanOutputDirectory(outputDir, request.cwd);
      await ensureDirectory(outputDir);
    } else {
      await ensureDirectory(outputDir);
      await assertExtractionWillNotCollide(outputDir, entries, request.overwrite);
    }

    const result = await adapter.unpack({ ...request, format, outputDir }, ctx);
    if (result.exitCode !== 0) {
      throw relpackError(
        "unpack-failed",
        result.stderr || `Unpack backend failed with exit code ${result.exitCode}.`,
      );
    }

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
      ...result,
      backupPath,
      backupCreated: backupPath !== undefined,
      backupSkippedReason,
      rolledBack,
      ...(postCheck === undefined ? {} : { postCheck }),
    };
  } catch (error) {
    if (request.rollbackOnFail === true && backupPath !== undefined) {
      await rollbackOutputFromBackup(outputDir, backupPath, request.cwd);
      rolledBack = true;
    }

    if (error instanceof RelpackError && rolledBack) {
      throw relpackError(
        error.code,
        `${error.message}\nRollback: restored output directory from backup: ${backupPath}`,
        error.hint,
      );
    }

    throw error;
  }
}

export async function runPostCheck(command: string, ctx: CommandContext): Promise<PostCheckResult> {
  const shell = process.platform === "win32" ? "cmd" : "bash";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  const result = await runProcess(shell, args, { cwd: ctx.cwd, env: ctx.env });
  return { ...result, ok: result.exitCode === 0 };
}
