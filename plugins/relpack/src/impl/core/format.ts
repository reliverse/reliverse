import type { ArchiveFormat } from "./types";

const EXTENSION_FORMATS: readonly [suffix: string, format: ArchiveFormat][] = [
  [".tar.gz", "tar.gz"],
  [".tgz", "tgz"],
  [".tar.zst", "tar.zst"],
  [".tzst", "tzst"],
  [".tar.xz", "tar.xz"],
  [".txz", "txz"],
  [".tar.bz2", "tar.bz2"],
  [".tbz2", "tbz2"],
  [".tar", "tar"],
  [".zip", "zip"],
  [".7z", "7z"],
];

export function detectArchiveFormat(filePath: string): ArchiveFormat {
  const lower = filePath.toLowerCase();

  for (const [suffix, format] of EXTENSION_FORMATS) {
    if (lower.endsWith(suffix)) {
      return format;
    }
  }

  return "unknown";
}

export function normalizeArchiveFormat(format: ArchiveFormat): ArchiveFormat {
  if (format === "tgz") return "tar.gz";
  if (format === "tzst") return "tar.zst";
  if (format === "txz") return "tar.xz";
  if (format === "tbz2") return "tar.bz2";
  return format;
}

export function isTarFormat(format: ArchiveFormat): boolean {
  return normalizeArchiveFormat(format).startsWith("tar");
}
