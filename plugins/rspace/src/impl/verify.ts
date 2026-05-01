import path from "node:path";

import {
  extractTarGzToTemporaryDirectory,
  removeTemporaryWorkspace,
  verifyTarGzArchive,
} from "./archive";
import { ARCHIVE_MANIFEST_PATH, RSPACE_PROTOCOL, RSPACE_STATE_PATH } from "./constants";
import { logInfo, readVerifyOptions } from "./context";
import { assertDirectory, pathExists, readJsonFile } from "./files";
import { isTarGzPath } from "./paths";
import type { RspaceState, RspaceVerificationResult } from "./types";

export async function runRspaceVerifyCommand(ctx: unknown): Promise<string> {
  const options = readVerifyOptions(ctx);
  const result = isTarGzPath(options.input)
    ? await verifyArchive(options.input)
    : await verifyDirectory(options.input);

  const report = formatVerificationResult(result);
  logInfo(ctx, report);

  return report;
}

async function verifyArchive(archivePath: string): Promise<RspaceVerificationResult> {
  const files = await verifyTarGzArchive(archivePath);
  const tempDir = await extractTarGzToTemporaryDirectory(archivePath);

  try {
    const directoryResult = await verifyDirectory(tempDir);

    return {
      input: archivePath,
      kind: "tar.gz",
      ok: directoryResult.ok,
      files,
      warnings: directoryResult.warnings,
    };
  } finally {
    await removeTemporaryWorkspace(tempDir);
  }
}

async function verifyDirectory(inputPath: string): Promise<RspaceVerificationResult> {
  await assertDirectory(inputPath, "Rspace input");

  const warnings: string[] = [];
  const statePath = path.join(inputPath, RSPACE_STATE_PATH);
  const manifestPath = path.join(inputPath, ARCHIVE_MANIFEST_PATH);

  if (!(await pathExists(statePath))) {
    throw new Error(`Missing required Rspace state file: ${RSPACE_STATE_PATH}`);
  }

  if (!(await pathExists(manifestPath))) {
    warnings.push(`Missing ${ARCHIVE_MANIFEST_PATH}.`);
  }

  const state = await readJsonFile<RspaceState>(statePath);

  if (state.protocol !== RSPACE_PROTOCOL) {
    throw new Error(
      `Unsupported Rspace protocol "${String(state.protocol)}". Expected "${RSPACE_PROTOCOL}".`,
    );
  }

  for (const file of state.generatedFiles) {
    if (!(await pathExists(path.join(inputPath, file)))) {
      warnings.push(`Missing generated file listed in state: ${file}`);
    }
  }

  return {
    input: inputPath,
    kind: "directory",
    ok: warnings.length === 0,
    files: state.files,
    warnings,
  };
}

function formatVerificationResult(result: RspaceVerificationResult): string {
  const lines = [
    result.ok ? "Rspace verification passed" : "Rspace verification completed with warnings",
    "",
    `Input: ${result.input}`,
    `Kind: ${result.kind}`,
    `Files: ${result.files.length}`,
  ];

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}
