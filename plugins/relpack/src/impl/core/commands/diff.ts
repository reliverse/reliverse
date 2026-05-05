import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import { DEFAULT_IGNORED_NAMES } from "../ignore";
import { tryReadManifestFromArchive } from "../manifest";
import { assertSafeArchiveEntryPath, resolveInside } from "../path-safety";
import type { CommandContext, DiffRequest, DiffResult, RelpackManifestEntry } from "../types";
import { listArchive } from "./list";

export async function diffArchiveWithOutput(
  request: DiffRequest,
  ctx: CommandContext,
): Promise<DiffResult> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const entries = await listArchive({ cwd: request.cwd, archive: request.archive, format }, ctx);
  const manifest = await tryReadManifestFromArchive(request.archive, format, ctx);
  const manifestEntries = new Map((manifest?.entries ?? []).map((entry) => [entry.path, entry]));
  const archivePaths = new Set(
    entries
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath !== ".relpack/manifest.json"),
  );
  const outputDir = path.resolve(request.cwd, request.outputDir);
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const archivePath of archivePaths) {
    const destination = resolveInside(outputDir, archivePath);
    const expected = manifestEntries.get(archivePath);
    const state = await compareDestination(destination, expected);
    if (state === "missing") added.push(archivePath);
    if (state === "changed") changed.push(archivePath);
    if (state === "unchanged") unchanged.push(archivePath);
  }

  const ignoredNames = request.ignoredNames ?? [...DEFAULT_IGNORED_NAMES, ".relpack"];
  const outputPaths = await collectOutputPaths(outputDir, ignoredNames).catch(() => []);
  const removed = outputPaths.filter((entryPath) => !archivePaths.has(entryPath));

  return {
    archive: request.archive,
    outputDir: request.outputDir,
    format,
    added: added.sort((a, b) => a.localeCompare(b)),
    changed: changed.sort((a, b) => a.localeCompare(b)),
    unchanged: unchanged.sort((a, b) => a.localeCompare(b)),
    removed: removed.sort((a, b) => a.localeCompare(b)),
    ...(manifest === undefined ? {} : { manifest }),
  };
}

async function compareDestination(
  destination: string,
  expected: RelpackManifestEntry | undefined,
): Promise<"missing" | "changed" | "unchanged"> {
  let info;
  try {
    info = await lstat(destination);
  } catch {
    return "missing";
  }

  if (expected === undefined) {
    return "changed";
  }

  if (expected.kind === "directory") {
    return info.isDirectory() ? "unchanged" : "changed";
  }

  if (expected.kind === "file") {
    if (!info.isFile()) return "changed";
    if (expected.size !== undefined && info.size !== expected.size) return "changed";
    if (expected.sha256 !== undefined) {
      const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
      return digest === expected.sha256 ? "unchanged" : "changed";
    }
    return "unchanged";
  }

  return "changed";
}

async function collectOutputPaths(outputDir: string, ignoredNames: readonly string[]): Promise<string[]> {
  const paths: string[] = [];

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const children = await readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      if (ignoredNames.includes(child.name)) {
        continue;
      }

      const entryPath = assertSafeArchiveEntryPath(prefix.length > 0 ? `${prefix}/${child.name}` : child.name);
      paths.push(entryPath);
      if (child.isDirectory()) {
        await walk(path.join(currentDir, child.name), entryPath);
      }
    }
  }

  await walk(outputDir, "");
  return paths;
}
