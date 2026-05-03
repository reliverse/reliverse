import { getAdapterForFormat } from "../adapters/registry";
import { relpackError } from "../error";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import type { CommandContext, ProcessResult, TestRequest } from "../types";

export async function testArchive(
  request: TestRequest,
  ctx: CommandContext,
): Promise<ProcessResult> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const adapter = await getAdapterForFormat(format, ctx);

  if (!adapter.canTest || adapter.test === undefined) {
    throw relpackError("test-unsupported", `Testing is not supported for format: ${format}`);
  }

  const result = await adapter.test({ ...request, format }, ctx);
  if (result.exitCode !== 0) {
    throw relpackError(
      "test-failed",
      result.stderr || `Archive test failed with exit code ${result.exitCode}.`,
    );
  }

  return result;
}
