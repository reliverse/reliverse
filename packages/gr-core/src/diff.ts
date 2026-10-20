import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { fingerprintGrJson, normalizeGrJson } from "./json";
import {
  GR_WORKSPACE_DIFF_SCHEMA_VERSION,
  type GrChangeKind,
  type GrChangedFile,
  type GrGitObjectReference,
  type GrSnapshot,
  type GrWorkspaceDiff,
} from "./model";
import { assertGrRelativePath } from "./paths";
import { parseGrSnapshot } from "./snapshot";
import {
  isGrGitObjectReference,
  isGrRecord,
  isGrRelativePathValue,
  isGrRepositoryIdentity,
  isNonEmptyGrString,
} from "./validation";

function objectReference(
  algorithm: "sha1" | "sha256",
  kind: GrGitObjectReference["kind"],
  oid: string,
): GrGitObjectReference | undefined {
  return /^0+$/u.test(oid) ? undefined : Object.freeze({ algorithm, kind, oid });
}

function changeKind(status: string, beforeMode: string, afterMode: string): GrChangeKind {
  const code = status[0];
  if (code === "A") return "add";
  if (code === "D") return "delete";
  if (code === "R") return "rename";
  if (code === "C") return "copy";
  if (beforeMode === "120000" || afterMode === "120000") return "symlink";
  if (beforeMode !== afterMode) return "mode";
  return "modify";
}

function parseBinaryPaths(output: string): ReadonlySet<string> {
  const chunks = output.split("\0");
  const binary = new Set<string>();
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const match = /^([^\t]+)\t([^\t]+)\t(.*)$/u.exec(chunk);
    if (!match) continue;
    let targetPath = match[3]!;
    if (targetPath.length === 0) {
      const originalPath = chunks[index + 1];
      const resultPath = chunks[index + 2];
      if (!originalPath || !resultPath) continue;
      targetPath = resultPath;
      index += 2;
    }
    if (match[1] === "-" && match[2] === "-") binary.add(assertGrRelativePath(targetPath));
  }
  return binary;
}

function parseRawDiff(
  output: string,
  algorithm: "sha1" | "sha256",
  binaryPaths: ReadonlySet<string>,
): readonly GrChangedFile[] {
  const chunks = output.split("\0");
  const files: GrChangedFile[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const metadata = chunks[index];
    if (!metadata) continue;
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])(\d*)$/u.exec(metadata);
    if (!match)
      throw new GrError("GR_GIT_FAILED", "Unable to parse Git raw diff metadata.", { metadata });
    const status = `${match[5]}${match[6]}`;
    const firstPath = chunks[index + 1];
    if (!firstPath)
      throw new GrError("GR_GIT_FAILED", "Git raw diff omitted a changed path.", { metadata });
    index += 1;
    let originalPath: string | undefined;
    let targetPath = firstPath;
    if (match[5] === "R" || match[5] === "C") {
      const secondPath = chunks[index + 1];
      if (!secondPath)
        throw new GrError("GR_GIT_FAILED", "Git raw rename/copy diff omitted a result path.", {
          metadata,
        });
      originalPath = assertGrRelativePath(firstPath);
      targetPath = secondPath;
      index += 1;
    }
    const normalizedPath = assertGrRelativePath(targetPath);
    const beforeMode = match[1]!;
    const afterMode = match[2]!;
    const beforeKind = beforeMode === "120000" ? "blob" : "blob";
    const afterKind = afterMode === "120000" ? "blob" : "blob";
    files.push(
      Object.freeze({
        path: normalizedPath,
        ...(originalPath ? { originalPath } : {}),
        kind: changeKind(status, beforeMode, afterMode),
        status,
        ...(objectReference(algorithm, beforeKind, match[3]!)
          ? { before: objectReference(algorithm, beforeKind, match[3]!) }
          : {}),
        ...(objectReference(algorithm, afterKind, match[4]!)
          ? { after: objectReference(algorithm, afterKind, match[4]!) }
          : {}),
        ...(beforeMode === "000000" ? {} : { beforeMode }),
        ...(afterMode === "000000" ? {} : { afterMode }),
        binary: binaryPaths.has(normalizedPath),
      }),
    );
  }
  return Object.freeze(
    files.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        (left.originalPath ?? "").localeCompare(right.originalPath ?? ""),
    ),
  );
}

function assertSnapshotPair(before: GrSnapshot, result: GrSnapshot): void {
  if (
    before.repository.fingerprint !== result.repository.fingerprint ||
    before.repository.root !== result.repository.root
  ) {
    throw new GrError("GR_REPOSITORY_MISMATCH", "GR snapshots belong to different repositories.", {
      before: before.repository.fingerprint,
      result: result.repository.fingerprint,
    });
  }
  if (JSON.stringify(before.scope) !== JSON.stringify(result.scope)) {
    throw new GrError("GR_REPOSITORY_MISMATCH", "GR snapshots use different path scopes.");
  }
}

export async function diffGrSnapshots(
  beforeValue: GrSnapshot,
  resultValue: GrSnapshot,
  options: {
    readonly grantedEffects?: readonly "git.read"[] | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<GrWorkspaceDiff> {
  assertGrEffects(["git.read"], options.grantedEffects);
  const before = parseGrSnapshot(beforeValue);
  const result = parseGrSnapshot(resultValue);
  assertSnapshotPair(before, result);
  const root = before.repository.root;
  for (const tree of [before.worktreeTree, result.worktreeTree]) {
    await runRequiredGrGit(root, ["cat-file", "-e", `${tree.oid}^{tree}`], options);
  }
  const args = [before.worktreeTree.oid, result.worktreeTree.oid];
  const [raw, numstat] = await Promise.all([
    runRequiredGrGit(
      root,
      ["diff-tree", "--raw", "-z", "--no-commit-id", "-r", "--find-renames", ...args],
      options,
    ),
    runRequiredGrGit(
      root,
      ["diff-tree", "--numstat", "-z", "--no-commit-id", "-r", "--find-renames", ...args],
      options,
    ),
  ]);
  const files = parseRawDiff(raw, before.repository.objectFormat, parseBinaryPaths(numstat));
  const semanticDiff = {
    schemaVersion: GR_WORKSPACE_DIFF_SCHEMA_VERSION,
    operation: "gr.workspace.diff" as const,
    repository: before.repository,
    before: {
      id: before.snapshotId,
      fingerprint: before.snapshotFingerprint,
      tree: before.worktreeTree,
    },
    result: {
      id: result.snapshotId,
      fingerprint: result.snapshotFingerprint,
      tree: result.worktreeTree,
    },
    files,
    policy: { renameDetection: "find-renames" as const, binary: "detect" as const },
  };
  return normalizeGrJson({
    ...semanticDiff,
    diffFingerprint: fingerprintGrJson(semanticDiff, "gr.workspace-diff.v0"),
  }) as unknown as GrWorkspaceDiff;
}

export function parseGrWorkspaceDiff(value: unknown): GrWorkspaceDiff {
  const normalized = normalizeGrJson(value) as unknown as GrWorkspaceDiff;
  if (
    normalized.schemaVersion !== GR_WORKSPACE_DIFF_SCHEMA_VERSION ||
    normalized.operation !== "gr.workspace.diff" ||
    typeof normalized.diffFingerprint !== "string" ||
    !isGrRepositoryIdentity(normalized.repository) ||
    !isGrRecord(normalized.before) ||
    !isNonEmptyGrString(normalized.before.id) ||
    !isNonEmptyGrString(normalized.before.fingerprint) ||
    !isGrGitObjectReference(normalized.before.tree, "tree") ||
    !isGrRecord(normalized.result) ||
    !isNonEmptyGrString(normalized.result.id) ||
    !isNonEmptyGrString(normalized.result.fingerprint) ||
    !isGrGitObjectReference(normalized.result.tree, "tree") ||
    normalized.before.tree.algorithm !== normalized.repository.objectFormat ||
    normalized.result.tree.algorithm !== normalized.repository.objectFormat ||
    !Array.isArray(normalized.files) ||
    !isGrRecord(normalized.policy) ||
    normalized.policy.renameDetection !== "find-renames" ||
    normalized.policy.binary !== "detect"
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR workspace diff schema is invalid.");
  }
  for (const file of normalized.files) {
    if (
      !isGrRecord(file) ||
      !isGrRelativePathValue(file.path) ||
      !["add", "copy", "delete", "mode", "modify", "rename", "symlink"].includes(
        file.kind as string,
      ) ||
      !isNonEmptyGrString(file.status) ||
      typeof file.binary !== "boolean" ||
      (file.originalPath !== undefined && !isGrRelativePathValue(file.originalPath)) ||
      (file.before !== undefined && !isGrGitObjectReference(file.before, "blob")) ||
      (file.after !== undefined && !isGrGitObjectReference(file.after, "blob"))
    ) {
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        "GR workspace diff contains an invalid changed-file entry.",
      );
    }
  }
  const { diffFingerprint, ...semanticDiff } = normalized;
  if (diffFingerprint !== fingerprintGrJson(semanticDiff, "gr.workspace-diff.v0")) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR workspace diff fingerprint does not match its content.",
    );
  }
  return normalized;
}
