import { detectArchiveFormat, normalizeArchiveFormat } from "../format";
import {
  hashBuffer,
  readArchiveFileBuffer,
  readManifestFromArchive,
  RELPACK_MANIFEST_PATH,
} from "../manifest";
import type { CommandContext, VerifyMismatch, VerifyRequest, VerifyResult } from "../types";
import { listArchive } from "./list";

export async function verifyArchive(
  request: VerifyRequest,
  ctx: CommandContext,
): Promise<VerifyResult> {
  const format = normalizeArchiveFormat(request.format ?? detectArchiveFormat(request.archive));
  const manifest = await readManifestFromArchive(request.archive, format, ctx);
  const listedEntries = await listArchive(
    { cwd: request.cwd, archive: request.archive, format },
    ctx,
  );
  const archiveEntryMap = new Map(listedEntries.map((entry) => [entry.path, entry]));
  const mismatches: VerifyMismatch[] = [];

  if (!archiveEntryMap.has(RELPACK_MANIFEST_PATH)) {
    mismatches.push({ path: RELPACK_MANIFEST_PATH, reason: "missing-entry" });
  }

  for (const expected of manifest.entries) {
    const actual = archiveEntryMap.get(expected.path);
    if (actual === undefined) {
      mismatches.push({ path: expected.path, reason: "missing-entry" });
      continue;
    }

    if (actual.kind !== "unknown" && expected.kind !== "unknown" && actual.kind !== expected.kind) {
      mismatches.push({
        path: expected.path,
        reason: "kind-mismatch",
        expected: expected.kind,
        actual: actual.kind,
      });
      continue;
    }

    if (expected.size !== undefined && actual.size !== undefined && expected.size !== actual.size) {
      mismatches.push({
        path: expected.path,
        reason: "size-mismatch",
        expected: expected.size,
        actual: actual.size,
      });
      continue;
    }

    if (expected.kind === "file" && expected.sha256 !== undefined) {
      const buffer = await readArchiveFileBuffer(request.archive, format, expected.path, ctx);
      const actualHash = hashBuffer(buffer);
      if (actualHash !== expected.sha256) {
        mismatches.push({
          path: expected.path,
          reason: "sha256-mismatch",
          expected: expected.sha256,
          actual: actualHash,
        });
      }
    }
  }

  return {
    ok: mismatches.length === 0,
    archive: request.archive,
    format,
    manifest,
    checkedEntries: manifest.entries.length,
    mismatches,
  };
}
