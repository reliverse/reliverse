import { access, cp, lstat, mkdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { RelpackError, relpackError } from "./error";
import { resolveInside } from "./path-safety";
import type { ArchiveEntry, OverwritePolicy } from "./types";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteExistingFile(filePath: string): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw relpackError(
        "delete-source-not-file",
        `Refusing to delete source archive because it is not a file: ${filePath}`,
      );
    }

    await unlink(filePath);
  } catch (error) {
    if (error instanceof RelpackError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw relpackError(
      "delete-source-failed",
      `Archive extracted, but relpack could not delete source archive: ${filePath}`,
      message,
    );
  }
}

export async function cleanOutputDirectory(outputDir: string, cwd: string): Promise<void> {
  const resolvedOutputDir = path.resolve(cwd, outputDir);
  assertSafeOutputDirectoryForCleaning(resolvedOutputDir, path.resolve(cwd));

  let info;
  try {
    info = await lstat(resolvedOutputDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw relpackError(
      "clean-output-failed",
      `Could not inspect output directory before cleaning: ${resolvedOutputDir}`,
      message,
    );
  }

  if (info.isSymbolicLink()) {
    throw relpackError(
      "clean-output-symlink",
      `Refusing to clean output directory because it is a symbolic link: ${resolvedOutputDir}`,
      "Pass a real directory path with -o/--output before using --clean-output.",
    );
  }

  if (!info.isDirectory()) {
    throw relpackError(
      "clean-output-not-directory",
      `Refusing to clean output path because it is not a directory: ${resolvedOutputDir}`,
      "--clean-output only deletes directories, not regular files or special paths.",
    );
  }

  try {
    await rm(resolvedOutputDir, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw relpackError(
      "clean-output-failed",
      `Could not clean output directory before extraction: ${resolvedOutputDir}`,
      message,
    );
  }
}

export async function createOutputBackup(outputDir: string, cwd: string): Promise<{
  readonly backupPath?: string;
  readonly skippedReason?: string;
}> {
  const resolvedOutputDir = path.resolve(cwd, outputDir);
  assertSafeOutputDirectoryForCleaning(resolvedOutputDir, path.resolve(cwd));

  let info;
  try {
    info = await lstat(resolvedOutputDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { skippedReason: "output directory does not exist yet" };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw relpackError("backup-output-failed", `Could not inspect output before backup: ${resolvedOutputDir}`, message);
  }

  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw relpackError(
      "backup-output-unsafe-target",
      `Refusing to backup output because it is not a real directory: ${resolvedOutputDir}`,
      "Use a real output directory when enabling --backup.",
    );
  }

  const backupPath = createBackupPath(resolvedOutputDir);
  await cp(resolvedOutputDir, backupPath, { recursive: true, verbatimSymlinks: true });
  return { backupPath };
}

export async function rollbackOutputFromBackup(
  outputDir: string,
  backupPath: string,
  cwd: string,
): Promise<void> {
  const resolvedOutputDir = path.resolve(cwd, outputDir);
  assertSafeOutputDirectoryForCleaning(resolvedOutputDir, path.resolve(cwd));

  await rm(resolvedOutputDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.dirname(resolvedOutputDir), { recursive: true });
  await cp(backupPath, resolvedOutputDir, { recursive: true, verbatimSymlinks: true });
}

function createBackupPath(resolvedOutputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${resolvedOutputDir}.relpack-backup-${timestamp}`;
}

function assertSafeOutputDirectoryForCleaning(resolvedOutputDir: string, resolvedCwd: string): void {
  const root = path.parse(resolvedOutputDir).root;
  const home = process.env.HOME ? path.resolve(process.env.HOME) : undefined;

  if (resolvedOutputDir === root) {
    throw relpackError(
      "clean-output-unsafe-target",
      "Refusing to clean filesystem root.",
      "Pass a specific child directory with -o/--output.",
    );
  }

  if (resolvedOutputDir === resolvedCwd) {
    throw relpackError(
      "clean-output-unsafe-target",
      `Refusing to clean the current working directory: ${resolvedOutputDir}`,
      "Pass a specific child directory with -o/--output, for example ./plugins/relpack.",
    );
  }

  if (home !== undefined && resolvedOutputDir === home) {
    throw relpackError(
      "clean-output-unsafe-target",
      `Refusing to clean the home directory: ${resolvedOutputDir}`,
      "Pass a specific child directory with -o/--output.",
    );
  }

  const relative = path.relative(resolvedCwd, resolvedOutputDir);
  if (relative === "" || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw relpackError(
      "clean-output-outside-cwd",
      `Refusing to clean output directory outside the current workspace: ${resolvedOutputDir}`,
      "Use a path inside the current working directory when using --clean-output/--backup.",
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function assertOutputArchiveCanBeWritten(
  outputPath: string,
  overwrite: OverwritePolicy,
  options: { readonly createParentDirectory?: boolean } = {},
): Promise<void> {
  if (overwrite === "never" && (await pathExists(outputPath))) {
    throw relpackError(
      "output-exists",
      `Output archive already exists: ${outputPath}`,
      "Pass --overwrite when replacing an existing archive is intentional.",
    );
  }

  if (options.createParentDirectory !== false) {
    await ensureDirectory(path.dirname(outputPath));
  }
}

export async function assertInputsExist(inputPaths: readonly string[]): Promise<void> {
  for (const inputPath of inputPaths) {
    try {
      await stat(inputPath);
    } catch {
      throw relpackError("missing-input", `Input path does not exist: ${inputPath}`);
    }
  }
}

export async function assertExtractionWillNotCollide(
  outputDir: string,
  entries: readonly ArchiveEntry[],
  overwrite: OverwritePolicy,
): Promise<void> {
  if (overwrite === "files") return;

  for (const entry of entries) {
    const destination = resolveInside(outputDir, entry.path);
    if (await pathExists(destination)) {
      throw relpackError(
        "extract-collision",
        `Extraction would overwrite an existing path: ${destination}`,
        "Pass --overwrite or --overwrite-mode files when replacing existing files is intentional.",
      );
    }
  }
}
