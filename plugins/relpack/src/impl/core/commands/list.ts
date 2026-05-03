import { getAdapterForFormat } from "../adapters/registry";
import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import { assertSafeArchiveEntryPath } from "../path-safety";
import type { ArchiveEntry, CommandContext, ListRequest } from "../types";

export async function listArchive(
  request: ListRequest,
  ctx: CommandContext,
): Promise<readonly ArchiveEntry[]> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const adapter = await getAdapterForFormat(format, ctx);
  const entries = await adapter.list({ ...request, format }, ctx);

  for (const entry of entries) {
    assertSafeArchiveEntryPath(entry.path);
  }

  return entries;
}
