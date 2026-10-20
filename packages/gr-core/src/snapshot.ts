import { copyFile, lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { withGrSnapshotIndexes } from "./git-index";
import { inspectGrWorkspace } from "./inspect";
import { fingerprintGrBytes, fingerprintGrJson, normalizeGrJson } from "./json";
import {
  GR_SNAPSHOT_SCHEMA_VERSION,
  type GrGitObjectReference,
  type GrSnapshot,
  type GrSnapshotCoverage,
  type GrSnapshotRequest,
} from "./model";
import { grScopePathspecs, normalizeGrScope } from "./paths";
import {
  hasExactGrKeys,
  isGrGitObjectReference,
  isGrRecord,
  isGrRelativePathValue,
  isGrRepositoryIdentity,
  isNonEmptyGrString,
} from "./validation";

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function indexFingerprint(indexPath: string): Promise<string> {
  try {
    return fingerprintGrBytes(await readFile(indexPath), "gr.git-index-bytes.v0");
  } catch (error) {
    if (missing(error)) return "absent";
    throw error;
  }
}

function treeObject(algorithm: "sha1" | "sha256", oid: string): GrGitObjectReference {
  if (!/^[a-f0-9]+$/u.test(oid))
    throw new GrError("GR_GIT_FAILED", "Git returned an invalid tree object ID.", { oid });
  return Object.freeze({ algorithm, kind: "tree", oid });
}

async function writeIndexTree(
  root: string,
  targetIndex: string,
  sourceIndex: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    await lstat(sourceIndex);
    await copyFile(sourceIndex, targetIndex);
  } catch (error) {
    if (!missing(error)) throw error;
    await runRequiredGrGit(root, ["read-tree", "--empty"], {
      env: { GIT_INDEX_FILE: targetIndex },
      ...(signal ? { signal } : {}),
    });
  }
  return (
    await runRequiredGrGit(root, ["write-tree"], {
      env: { GIT_INDEX_FILE: targetIndex },
      ...(signal ? { signal } : {}),
    })
  ).trim();
}

async function writeWorktreeTree(
  request: GrSnapshotRequest,
  root: string,
  targetIndex: string,
  headCommit: string | undefined,
  pathspecs: readonly string[],
): Promise<string> {
  const env = { GIT_INDEX_FILE: targetIndex };
  if (headCommit) {
    await runRequiredGrGit(root, ["read-tree", headCommit], {
      env,
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } else {
    await runRequiredGrGit(root, ["read-tree", "--empty"], {
      env,
      ...(request.signal ? { signal: request.signal } : {}),
    });
  }
  const applicablePathspecs: string[] = [];
  for (const pathspec of pathspecs) {
    // Git pathspec expressions are not literal filesystem paths; preserve Git's matching rules.
    if (pathspec === "." || pathspec.startsWith(":(") || /[?*\[\]]/u.test(pathspec)) {
      applicablePathspecs.push(pathspec);
      continue;
    }
    try {
      await lstat(path.join(root, pathspec));
      applicablePathspecs.push(pathspec);
    } catch (error) {
      if (!missing(error)) throw error;
      // A missing path may still be tracked in HEAD and need its deletion staged.
      const tracked = await runRequiredGrGit(root, ["ls-files", "--cached", "-z", "--", pathspec], {
        env,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (tracked.length > 0) applicablePathspecs.push(pathspec);
    }
  }
  if (applicablePathspecs.length > 0) {
    await runRequiredGrGit(root, ["add", "-A", "--", ...applicablePathspecs], {
      env,
      ...(request.signal ? { signal: request.signal } : {}),
    });
  }
  return (
    await runRequiredGrGit(root, ["write-tree"], {
      env,
      ...(request.signal ? { signal: request.signal } : {}),
    })
  ).trim();
}

export async function createGrSnapshot(request: GrSnapshotRequest): Promise<GrSnapshot> {
  assertGrEffects(["filesystem.read", "git.read", "git.write"], request.grantedEffects);
  const inspection = await inspectGrWorkspace(request.root, {
    grantedEffects: ["filesystem.read", "git.read"],
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (inspection.summary.conflicted > 0) {
    throw new GrError("GR_UNSUPPORTED_STATE", "GR snapshot refuses a conflicted Git workspace.", {
      conflicted: inspection.summary.conflicted,
    });
  }
  if (inspection.summary.dirty && (request.dirtyPolicy ?? "reject") !== "capture") {
    throw new GrError(
      "GR_WORKSPACE_DIRTY",
      "GR snapshot rejects a dirty workspace unless capture is explicit.",
      {
        statusFingerprint: inspection.statusFingerprint,
      },
    );
  }
  const root = inspection.repository.root;
  const submoduleEntries = (
    await runRequiredGrGit(
      root,
      ["ls-files", "--stage", "-z"],
      request.signal ? { signal: request.signal } : {},
    )
  )
    .split("\0")
    .filter((entry) => entry.startsWith("160000 "));
  if (submoduleEntries.length > 0) {
    throw new GrError("GR_UNSUPPORTED_STATE", "GR v0 snapshot does not support Git submodules.", {
      submodules: submoduleEntries.length,
    });
  }

  const scope = normalizeGrScope(request.scope);
  const indexPathRaw = (
    await runRequiredGrGit(
      root,
      ["rev-parse", "--git-path", "index"],
      request.signal ? { signal: request.signal } : {},
    )
  ).trim();
  const realIndexPath = path.resolve(root, indexPathRaw);
  const realIndexBefore = await indexFingerprint(realIndexPath);
  const { indexTreeOid, worktreeTreeOid } = await withGrSnapshotIndexes(
    root,
    async (temporaryDirectory) => {
      const indexTreeOid = await writeIndexTree(
        root,
        path.join(temporaryDirectory, "index-state"),
        realIndexPath,
        request.signal,
      );
      const worktreeTreeOid = await writeWorktreeTree(
        request,
        root,
        path.join(temporaryDirectory, "worktree-state"),
        inspection.head.commit?.oid,
        grScopePathspecs(scope),
      );
      return { indexTreeOid, worktreeTreeOid };
    },
  );
  const realIndexAfter = await indexFingerprint(realIndexPath);
  if (realIndexBefore !== realIndexAfter) {
    throw new GrError(
      "GR_INDEX_CHANGED",
      "The real Git index changed during GR snapshot creation.",
      {
        after: realIndexAfter,
        before: realIndexBefore,
        indexPath: realIndexPath,
      },
    );
  }

  const coverage: GrSnapshotCoverage = Object.freeze({
    head: inspection.head.tree ? "included" : "not-applicable",
    staged: "included",
    unstaged: "included",
    untracked: "included",
    ignored: "denied",
    binary: "included",
    modes: "included",
    symlinks: "included",
    deletions: "included",
    renamesAndCopies: "included",
    submodules: "not-applicable",
  });
  const semanticSnapshot = {
    schemaVersion: GR_SNAPSHOT_SCHEMA_VERSION,
    operation: "gr.workspace.snapshot" as const,
    repository: inspection.repository,
    role: request.role,
    origin: { kind: "live-worktree" as const },
    scope,
    inspectionFingerprint: inspection.inspectionFingerprint,
    statusFingerprint: inspection.statusFingerprint,
    head: inspection.head,
    indexTree: treeObject(inspection.repository.objectFormat, indexTreeOid),
    worktreeTree: treeObject(inspection.repository.objectFormat, worktreeTreeOid),
    coverage,
    retention: "ephemeral" as const,
  };
  const snapshotFingerprint = fingerprintGrJson(semanticSnapshot, "gr.snapshot.v0");
  return normalizeGrJson({
    ...semanticSnapshot,
    snapshotId: `gr-snapshot-${snapshotFingerprint.slice(0, 20)}`,
    snapshotFingerprint,
  }) as unknown as GrSnapshot;
}

export async function createGrAcceptedRevisionSnapshot(
  request: Omit<GrSnapshotRequest, "dirtyPolicy"> & { readonly revision?: string },
): Promise<GrSnapshot> {
  assertGrEffects(["filesystem.read", "git.read"], request.grantedEffects);
  const inspection = await inspectGrWorkspace(request.root, {
    grantedEffects: ["filesystem.read", "git.read"],
    ...(request.signal ? { signal: request.signal } : {}),
  });
  const root = inspection.repository.root;
  const revision = request.revision ?? "HEAD";
  const commitOid = (
    await runRequiredGrGit(
      root,
      ["rev-parse", `${revision}^{commit}`],
      request.signal ? { signal: request.signal } : {},
    )
  ).trim();
  const treeOid = (
    await runRequiredGrGit(
      root,
      ["rev-parse", `${revision}^{tree}`],
      request.signal ? { signal: request.signal } : {},
    )
  ).trim();
  const commit = {
    algorithm: inspection.repository.objectFormat,
    kind: "commit" as const,
    oid: commitOid,
  };
  const tree = treeObject(inspection.repository.objectFormat, treeOid);
  const scope = normalizeGrScope(request.scope);
  if (scope.kind !== "workspace")
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      "Accepted-revision snapshots are whole-workspace v0 snapshots; narrow paths at bundle materialization time.",
    );
  const coverage: GrSnapshotCoverage = Object.freeze({
    head: "included",
    staged: "excluded",
    unstaged: "excluded",
    untracked: "excluded",
    ignored: "denied",
    binary: "included",
    modes: "included",
    symlinks: "included",
    deletions: "included",
    renamesAndCopies: "included",
    submodules: "unsupported",
  });
  const semanticSnapshot = {
    schemaVersion: GR_SNAPSHOT_SCHEMA_VERSION,
    operation: "gr.workspace.snapshot" as const,
    repository: inspection.repository,
    role: request.role,
    origin: { kind: "accepted-revision" as const, revision, commit, tree },
    scope,
    inspectionFingerprint: inspection.inspectionFingerprint,
    statusFingerprint: fingerprintGrJson(
      { revision, commit, tree },
      "gr.accepted-revision-status.v0",
    ),
    head: inspection.head,
    indexTree: tree,
    worktreeTree: tree,
    coverage,
    retention: "ephemeral" as const,
  };
  const snapshotFingerprint = fingerprintGrJson(semanticSnapshot, "gr.snapshot.v0");
  return normalizeGrJson({
    ...semanticSnapshot,
    snapshotId: `gr-snapshot-${snapshotFingerprint.slice(0, 20)}`,
    snapshotFingerprint,
  }) as unknown as GrSnapshot;
}

export function parseGrSnapshot(value: unknown): GrSnapshot {
  const normalized = normalizeGrJson(value) as unknown as GrSnapshot;
  if (
    normalized.schemaVersion !== GR_SNAPSHOT_SCHEMA_VERSION ||
    normalized.operation !== "gr.workspace.snapshot" ||
    typeof normalized.snapshotId !== "string" ||
    typeof normalized.snapshotFingerprint !== "string" ||
    !isGrRepositoryIdentity(normalized.repository) ||
    !isGrGitObjectReference(normalized.worktreeTree, "tree") ||
    !isGrGitObjectReference(normalized.indexTree, "tree") ||
    normalized.worktreeTree.algorithm !== normalized.repository.objectFormat ||
    normalized.indexTree.algorithm !== normalized.repository.objectFormat ||
    !["baseline", "checkpoint", "explicit", "result"].includes(normalized.role) ||
    !isGrRecord(normalized.origin) ||
    (normalized.origin.kind === "live-worktree"
      ? !hasExactGrKeys(normalized.origin, ["kind"])
      : normalized.origin.kind === "accepted-revision"
        ? !hasExactGrKeys(normalized.origin, ["kind", "revision", "commit", "tree"]) ||
          !isNonEmptyGrString(normalized.origin.revision) ||
          !isGrGitObjectReference(normalized.origin.commit, "commit") ||
          !isGrGitObjectReference(normalized.origin.tree, "tree")
        : normalized.origin.kind === "snapshot-sandbox"
          ? !hasExactGrKeys(normalized.origin, [
              "kind",
              "materializationId",
              "materializationFingerprint",
              "baselineSnapshotId",
              "baselineSnapshotFingerprint",
              "stateFingerprint",
            ]) ||
            !isNonEmptyGrString(normalized.origin.materializationId) ||
            !isNonEmptyGrString(normalized.origin.materializationFingerprint) ||
            !isNonEmptyGrString(normalized.origin.baselineSnapshotId) ||
            !isNonEmptyGrString(normalized.origin.baselineSnapshotFingerprint) ||
            !isNonEmptyGrString(normalized.origin.stateFingerprint)
          : true) ||
    !isNonEmptyGrString(normalized.inspectionFingerprint) ||
    !isNonEmptyGrString(normalized.statusFingerprint) ||
    normalized.retention !== "ephemeral" ||
    !isGrRecord(normalized.scope) ||
    (normalized.scope.kind !== "workspace" &&
      (normalized.scope.kind !== "paths" ||
        !Array.isArray(normalized.scope.paths) ||
        normalized.scope.paths.length === 0 ||
        normalized.scope.paths.some((scopePath) => !isGrRelativePathValue(scopePath)))) ||
    !isGrRecord(normalized.head) ||
    !["attached", "detached", "unborn"].includes(normalized.head.state as string)
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR snapshot schema is invalid.");
  }
  if (
    (normalized.head.commit && !isGrGitObjectReference(normalized.head.commit, "commit")) ||
    (normalized.head.tree && !isGrGitObjectReference(normalized.head.tree, "tree")) ||
    (normalized.head.commit &&
      normalized.head.commit.algorithm !== normalized.repository.objectFormat) ||
    (normalized.head.tree && normalized.head.tree.algorithm !== normalized.repository.objectFormat)
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR snapshot HEAD identity is invalid.");
  }
  const { snapshotId, snapshotFingerprint, ...semanticSnapshot } = normalized;
  const expected = fingerprintGrJson(semanticSnapshot, "gr.snapshot.v0");
  if (snapshotFingerprint !== expected || snapshotId !== `gr-snapshot-${expected.slice(0, 20)}`) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR snapshot fingerprint or ID does not match its content.",
    );
  }
  return normalized;
}
