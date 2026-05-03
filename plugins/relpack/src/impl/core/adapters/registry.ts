import { relpackError } from "../error";
import { isTarFormat, normalizeArchiveFormat } from "../format";
import type { ArchiveFormat, CommandContext } from "../types";
import { sevenzAdapter } from "./sevenz";
import { tarAdapter } from "./tar";
import type { ArchiveAdapter } from "./types";
import { zipAdapter } from "./zip";

const ADAPTERS: readonly ArchiveAdapter[] = [tarAdapter, zipAdapter, sevenzAdapter];

export function getAdapters(): readonly ArchiveAdapter[] {
  return ADAPTERS;
}

export async function getAdapterForFormat(
  format: ArchiveFormat,
  ctx: CommandContext,
): Promise<ArchiveAdapter> {
  const normalized = normalizeArchiveFormat(format);

  if (normalized === "unknown") {
    throw relpackError(
      "unknown-format",
      "Archive format could not be detected.",
      "Pass --format with one of: tar, tar.gz, tar.zst, tar.xz, tar.bz2, zip, 7z.",
    );
  }

  const adapter = ADAPTERS.find((candidate) =>
    isTarFormat(normalized)
      ? candidate.id === tarAdapter.id
      : candidate.formats.includes(normalized),
  );

  if (adapter === undefined) {
    throw relpackError("unsupported-format", `Unsupported archive format: ${format}`);
  }

  if (!(await adapter.isAvailable(ctx))) {
    throw relpackError(
      "backend-unavailable",
      `Required backend is unavailable: ${adapter.id}`,
      "Run relpack doctor to inspect installed archive tools.",
    );
  }

  return adapter;
}
