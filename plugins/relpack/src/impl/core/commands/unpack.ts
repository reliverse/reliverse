import path from "node:path";

import { getAdapterForFormat } from "../adapters/registry";
import { relpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import { assertExtractionWillNotCollide, ensureDirectory } from "../fs";
import { resolveInside } from "../path-safety";
import type { CommandContext, ProcessResult, UnpackRequest } from "../types";
import { listArchive } from "./list";

export async function unpackArchive(
  request: UnpackRequest,
  ctx: CommandContext,
): Promise<ProcessResult> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const adapter = await getAdapterForFormat(format, ctx);

  if (!adapter.canUnpack || adapter.unpack === undefined) {
    throw relpackError("unpack-unsupported", `Unpacking is not supported for format: ${format}`);
  }

  const outputDir = path.resolve(request.cwd, request.outputDir);
  await ensureDirectory(outputDir);

  const entries = await listArchive({ cwd: request.cwd, archive: request.archive, format }, ctx);
  for (const entry of entries) {
    resolveInside(outputDir, entry.path);
  }
  await assertExtractionWillNotCollide(outputDir, entries, request.overwrite);

  const result = await adapter.unpack({ ...request, format, outputDir }, ctx);
  if (result.exitCode !== 0) {
    throw relpackError(
      "unpack-failed",
      result.stderr || `Unpack backend failed with exit code ${result.exitCode}.`,
    );
  }

  return result;
}
