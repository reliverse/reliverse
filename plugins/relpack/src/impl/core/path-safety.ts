import path from "node:path";

import { relpackError } from "./error";

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function normalizeArchiveEntryPath(entryPath: string): string {
  return entryPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function assertSafeArchiveEntryPath(entryPath: string): string {
  const normalized = normalizeArchiveEntryPath(entryPath).trim();

  if (normalized.length === 0) {
    throw relpackError("unsafe-empty-entry", "Archive contains an empty entry path.");
  }

  if (normalized.startsWith("/") || normalized.startsWith("~")) {
    throw relpackError("unsafe-absolute-entry", `Archive entry is absolute: ${entryPath}`);
  }

  if (/^[a-zA-Z]:\//.test(normalized) || /^[a-zA-Z]:$/.test(normalized)) {
    throw relpackError(
      "unsafe-drive-entry",
      `Archive entry contains a Windows drive prefix: ${entryPath}`,
    );
  }

  if (/\p{Cc}/u.test(normalized)) {
    throw relpackError(
      "unsafe-control-character",
      `Archive entry contains a control character: ${entryPath}`,
    );
  }

  const segments = normalized.split("/").filter(Boolean);

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw relpackError(
        "unsafe-traversal-entry",
        `Archive entry escapes the output directory: ${entryPath}`,
      );
    }

    const reservedCandidate = segment.replace(/\..*$/, "").toLowerCase();
    if (WINDOWS_RESERVED_NAMES.has(reservedCandidate)) {
      throw relpackError(
        "unsafe-windows-name",
        `Archive entry uses a Windows reserved name: ${entryPath}`,
      );
    }
  }

  return segments.join("/");
}

export function resolveInside(baseDir: string, entryPath: string): string {
  const safeEntry = assertSafeArchiveEntryPath(entryPath);
  const base = path.resolve(baseDir);
  const candidate = path.resolve(base, safeEntry);

  if (!isPathInside(base, candidate)) {
    throw relpackError(
      "unsafe-output-path",
      `Archive entry resolves outside the output directory: ${entryPath}`,
    );
  }

  return candidate;
}

export function isPathInside(parent: string, child: string): boolean {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function toArchiveInputPath(cwd: string, inputPath: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedInput = path.resolve(cwd, inputPath);

  if (!isPathInside(resolvedCwd, resolvedInput)) {
    throw relpackError(
      "input-outside-cwd",
      `Input path must be inside the current working directory: ${inputPath}`,
      "Run relpack from the project root or move the input under the current directory.",
    );
  }

  const relative = path.relative(resolvedCwd, resolvedInput).replaceAll(path.sep, "/");
  return assertSafeArchiveEntryPath(relative);
}
