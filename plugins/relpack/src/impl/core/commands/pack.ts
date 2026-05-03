import { getAdapterForFormat } from "../adapters/registry";
import { relpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import type { CommandContext, PackRequest, ProcessResult } from "../types";

export async function packArchive(
  request: PackRequest,
  ctx: CommandContext,
): Promise<ProcessResult> {
  if (request.inputs.length === 0) {
    throw relpackError("missing-pack-inputs", "Pack command requires at least one input path.");
  }

  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.output));
  const adapter = await getAdapterForFormat(format, ctx);

  if (!adapter.canPack || adapter.pack === undefined) {
    throw relpackError("pack-unsupported", `Packing is not supported for format: ${format}`);
  }

  const result = await adapter.pack({ ...request, format }, ctx);
  if (result.exitCode !== 0) {
    throw relpackError(
      "pack-failed",
      result.stderr || `Pack backend failed with exit code ${result.exitCode}.`,
    );
  }

  return result;
}
