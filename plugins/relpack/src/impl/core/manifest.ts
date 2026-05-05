import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getAdapterForFormat } from "./adapters/registry";
import { relpackError } from "./error";
import { detectArchiveFormat, normalizeArchiveFormat } from "./format";
import { assertSafeArchiveEntryPath } from "./path-safety";
import { runProcess, runProcessBuffer } from "./spawn";
import type {
  ArchiveEntry,
  ArchiveFormat,
  CommandContext,
  RelpackManifest,
  RelpackManifestEntry,
} from "./types";
import { listArchive } from "./commands/list";

export const RELPACK_MANIFEST_PATH = ".relpack/manifest.json";
export const RELPACK_METADATA_DIR = ".relpack";

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  return await new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function tryReadPackageMetadata(rootDir: string): Promise<{
  readonly packageName?: string;
  readonly version?: string;
}> {
  try {
    const packageJsonPath = path.join(rootDir, "package.json");
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { readonly name?: unknown; readonly version?: unknown };
    return {
      ...(typeof parsed.name === "string" ? { packageName: parsed.name } : {}),
      ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
    };
  } catch {
    return {};
  }
}

export async function createManifestFromStagedEntries(
  stageDir: string,
  entries: readonly string[],
): Promise<RelpackManifest> {
  const manifestEntries: RelpackManifestEntry[] = [];

  for (const entryPath of entries) {
    const safePath = assertSafeArchiveEntryPath(entryPath);
    if (safePath === RELPACK_MANIFEST_PATH || safePath.startsWith(`${RELPACK_METADATA_DIR}/`)) {
      continue;
    }

    const fullPath = path.join(stageDir, safePath);
    const info = await stat(fullPath);

    if (info.isDirectory()) {
      manifestEntries.push({ path: safePath, kind: "directory" });
      continue;
    }

    if (info.isFile()) {
      manifestEntries.push({
        path: safePath,
        kind: "file",
        size: info.size,
        sha256: await hashFile(fullPath),
      });
      continue;
    }

    manifestEntries.push({ path: safePath, kind: "unknown" });
  }

  manifestEntries.sort((a, b) => a.path.localeCompare(b.path));
  const packageMetadata = await tryReadPackageMetadata(stageDir);

  return {
    schemaVersion: 1,
    createdBy: "relpack",
    createdAt: new Date().toISOString(),
    ...packageMetadata,
    entries: manifestEntries,
  };
}

export function parseManifest(raw: string): RelpackManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw relpackError("manifest-invalid-json", "Archive manifest is not valid JSON.", message);
  }

  if (!isManifest(parsed)) {
    throw relpackError(
      "manifest-invalid-schema",
      "Archive manifest does not match relpack manifest schema v1.",
    );
  }

  for (const entry of parsed.entries) {
    assertSafeArchiveEntryPath(entry.path);
  }

  return parsed;
}

export async function readManifestFromArchive(
  archive: string,
  format: ArchiveFormat | undefined,
  ctx: CommandContext,
): Promise<RelpackManifest> {
  const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(archive));
  await getAdapterForFormat(normalizedFormat, ctx);

  const raw = await readArchiveTextFile(archive, normalizedFormat, RELPACK_MANIFEST_PATH, ctx);
  return parseManifest(raw);
}

export async function tryReadManifestFromArchive(
  archive: string,
  format: ArchiveFormat | undefined,
  ctx: CommandContext,
): Promise<RelpackManifest | undefined> {
  try {
    return await readManifestFromArchive(archive, format, ctx);
  } catch {
    return undefined;
  }
}

export async function readArchiveFileBuffer(
  archive: string,
  format: ArchiveFormat,
  entryPath: string,
  ctx: CommandContext,
): Promise<Buffer> {
  const archivePath = path.resolve(ctx.cwd, archive);
  const safeEntry = assertSafeArchiveEntryPath(entryPath);
  const normalizedFormat = normalizeArchiveFormat(format);

  if (normalizedFormat === "zip") {
    const result = await runProcessBuffer("unzip", ["-p", archivePath, safeEntry], {
      cwd: ctx.cwd,
      env: ctx.env,
    });
    if (result.exitCode !== 0) {
      throw relpackError("archive-read-failed", `Could not read archive entry: ${safeEntry}`, result.stderr);
    }
    return result.stdout;
  }

  if (normalizedFormat === "7z") {
    const result = await runProcessBuffer("7z", ["x", "-so", archivePath, safeEntry], {
      cwd: ctx.cwd,
      env: ctx.env,
    });
    if (result.exitCode !== 0) {
      throw relpackError("archive-read-failed", `Could not read archive entry: ${safeEntry}`, result.stderr);
    }
    return result.stdout;
  }

  const result = await runProcessBuffer("tar", ["-xOf", archivePath, safeEntry], {
    cwd: ctx.cwd,
    env: ctx.env,
  });
  if (result.exitCode !== 0) {
    throw relpackError("archive-read-failed", `Could not read archive entry: ${safeEntry}`, result.stderr);
  }
  return result.stdout;
}

export async function readArchiveTextFile(
  archive: string,
  format: ArchiveFormat,
  entryPath: string,
  ctx: CommandContext,
): Promise<string> {
  return (await readArchiveFileBuffer(archive, format, entryPath, ctx)).toString("utf8");
}

export function isManifestEntryPath(entry: ArchiveEntry): boolean {
  return entry.path === RELPACK_MANIFEST_PATH;
}

export async function archiveHasManifest(
  archive: string,
  format: ArchiveFormat | undefined,
  ctx: CommandContext,
): Promise<boolean> {
  const entries = await listArchive({ cwd: ctx.cwd, archive, ...(format === undefined ? {} : { format }) }, ctx);
  return entries.some(isManifestEntryPath);
}

function isManifest(value: unknown): value is RelpackManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    readonly schemaVersion?: unknown;
    readonly createdBy?: unknown;
    readonly createdAt?: unknown;
    readonly entries?: unknown;
  };

  if (candidate.schemaVersion !== 1) return false;
  if (candidate.createdBy !== "relpack") return false;
  if (typeof candidate.createdAt !== "string") return false;
  if (!Array.isArray(candidate.entries)) return false;

  return candidate.entries.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as {
      readonly path?: unknown;
      readonly kind?: unknown;
      readonly size?: unknown;
      readonly sha256?: unknown;
    };
    return (
      typeof item.path === "string" &&
      typeof item.kind === "string" &&
      (item.size === undefined || typeof item.size === "number") &&
      (item.sha256 === undefined || typeof item.sha256 === "string")
    );
  });
}
