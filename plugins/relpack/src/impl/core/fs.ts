import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { relpackError } from "./error";
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

export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function assertOutputArchiveCanBeWritten(
  outputPath: string,
  overwrite: OverwritePolicy,
): Promise<void> {
  if (overwrite === "never" && (await pathExists(outputPath))) {
    throw relpackError(
      "output-exists",
      `Output archive already exists: ${outputPath}`,
      "Pass --overwrite when replacing an existing archive is intentional.",
    );
  }

  await ensureDirectory(path.dirname(outputPath));
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
  if (overwrite === "always") return;

  for (const entry of entries) {
    const destination = resolveInside(outputDir, entry.path);
    if (await pathExists(destination)) {
      throw relpackError(
        "extract-collision",
        `Extraction would overwrite an existing path: ${destination}`,
        "Pass --overwrite when replacing existing files is intentional.",
      );
    }
  }
}
