import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertCanWriteOutput, assertDirectory, assertFile, pathExists } from "./files";
import { normalizeArchivePath } from "./paths";

export async function createTarGzArchive(input: {
  workspacePath: string;
  archivePath: string;
  overwrite: boolean;
}): Promise<void> {
  await assertTarAvailable();
  await assertDirectory(input.workspacePath, "Rspace workspace");

  const archivePath = normalizeArchivePath(input.archivePath);
  const archiveDir = path.dirname(archivePath);

  await mkdir(archiveDir, {
    recursive: true,
  });

  await assertCanWriteOutput(archivePath, input.overwrite);

  const result = Bun.spawnSync({
    cmd: ["tar", "-czf", archivePath, "-C", input.workspacePath, "."],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    throw new Error(formatProcessError("Failed to create tar.gz archive", result));
  }

  await verifyTarGzArchive(archivePath);
}

export async function verifyTarGzArchive(archivePath: string): Promise<string[]> {
  const exists = await pathExists(archivePath);

  if (!exists) {
    throw new Error(`Archive does not exist: ${archivePath}`);
  }

  await assertFile(archivePath, "Archive");
  await assertTarAvailable();

  const result = Bun.spawnSync({
    cmd: ["tar", "-tzf", archivePath],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    throw new Error(formatProcessError("Failed to verify tar.gz archive", result));
  }

  return decodeLines(result.stdout);
}

export async function extractTarGzToTemporaryDirectory(archivePath: string): Promise<string> {
  await verifyTarGzArchive(archivePath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rspace-verify-"));
  const result = Bun.spawnSync({
    cmd: ["tar", "-xzf", archivePath, "-C", tempDir],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    await removeTemporaryWorkspace(tempDir);
    throw new Error(formatProcessError("Failed to extract tar.gz archive", result));
  }

  return tempDir;
}

export async function removeTemporaryWorkspace(pathToRemove: string): Promise<void> {
  await rm(pathToRemove, {
    recursive: true,
    force: true,
  });
}

export async function assertTarAvailable(): Promise<void> {
  const result = Bun.spawnSync({
    cmd: ["tar", "--version"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    throw new Error("The `tar` command is required to create and verify .tar.gz archives.");
  }
}

export function runProcessCheck(command: string[]): {
  ok: boolean;
  output: string;
} {
  const result = Bun.spawnSync({
    cmd: command,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = [...decodeLines(result.stdout), ...decodeLines(result.stderr)].join("\n");

  return {
    ok: result.success,
    output,
  };
}

function decodeLines(buffer: Uint8Array): string[] {
  return new TextDecoder()
    .decode(buffer)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type ProcessResult = {
  stdout: Uint8Array;
  stderr: Uint8Array;
};

function formatProcessError(message: string, result: ProcessResult): string {
  const stderr = new TextDecoder().decode(result.stderr).trim();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const details = [stderr, stdout].filter(Boolean).join("\n");

  return details.length > 0 ? `${message}:\n${details}` : message;
}
