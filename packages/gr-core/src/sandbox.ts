import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { diffGrSnapshots } from "./diff";
import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { inspectGrWorkspace } from "./inspect";
import {
  fingerprintGrBytes,
  fingerprintGrJson,
  normalizeGrJson,
  stableGrJsonStringify,
} from "./json";
import {
  GR_SANDBOX_CLEANUP_RECEIPT_SCHEMA_VERSION,
  GR_SNAPSHOT_SANDBOX_SCHEMA_VERSION,
  GR_SNAPSHOT_SCHEMA_VERSION,
  type GrFailureEvidence,
  type GrGitObjectReference,
  type GrRepositoryIdentity,
  type GrSandboxCleanupReceipt,
  type GrSnapshot,
  type GrSnapshotSandbox,
  type GrSnapshotSandboxCaptureRequest,
  type GrSnapshotSandboxCleanupRequest,
  type GrSnapshotSandboxMaterializeRequest,
} from "./model";
import { assertGrRelativePath } from "./paths";
import { parseGrSnapshot } from "./snapshot";
import {
  hasExactGrKeys,
  isGrFailureEvidence,
  isGrGitObjectReference,
  isGrRecord,
  isGrRepositoryIdentity,
  isNonEmptyGrString,
} from "./validation";

const OWNER_SCHEMA_VERSION = "gr.snapshot-sandbox-owner.v0" as const;
const CONTAINER_PREFIX = "reliverse-gr-sandbox-";
const WORKSPACE_NAME = "workspace";
const MARKER_NAME = "owner.json";
const INDEX_NAME = "alternate-index";

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function indexFingerprint(indexPath: string): Promise<string> {
  try {
    return fingerprintGrBytes(await readFile(indexPath), "gr.git-index-bytes.v0");
  } catch (error) {
    if (missing(error)) return "absent";
    throw error;
  }
}

async function realIndexPath(root: string, signal?: AbortSignal): Promise<string> {
  const raw = (
    await runRequiredGrGit(root, ["rev-parse", "--git-path", "index"], signal ? { signal } : {})
  ).trim();
  return path.resolve(root, raw);
}

async function withUnchangedRealIndex<T>(
  root: string,
  signal: AbortSignal | undefined,
  operation: (indexPath: string) => Promise<T>,
): Promise<T> {
  const indexPath = await realIndexPath(root, signal);
  const before = await indexFingerprint(indexPath);
  let result: T | undefined;
  let failure: unknown;
  try {
    result = await operation(indexPath);
  } catch (error) {
    failure = error;
  }
  const after = await indexFingerprint(indexPath);
  if (before !== after) {
    throw new GrError(
      "GR_INDEX_CHANGED",
      "The real Git index changed during a GR sandbox operation.",
      {
        after,
        before,
        indexPath,
      },
    );
  }
  if (failure !== undefined) throw failure;
  return result as T;
}

function assertSameRepository(
  expected: GrRepositoryIdentity,
  actual: GrRepositoryIdentity,
  subject: string,
): void {
  if (
    expected.fingerprint !== actual.fingerprint ||
    expected.root !== actual.root ||
    expected.commonDirectory !== actual.commonDirectory ||
    expected.gitDirectory !== actual.gitDirectory
  ) {
    throw new GrError("GR_REPOSITORY_MISMATCH", `${subject} belongs to a different repository.`, {
      actual: actual.fingerprint,
      expected: expected.fingerprint,
    });
  }
}

async function currentRepository(
  root: string,
  signal?: AbortSignal,
): Promise<GrRepositoryIdentity> {
  return (
    await inspectGrWorkspace(root, {
      grantedEffects: ["filesystem.read", "git.read"],
      ...(signal ? { signal } : {}),
    })
  ).repository;
}

function treeObject(repository: GrRepositoryIdentity, oid: string): GrGitObjectReference {
  return Object.freeze({ algorithm: repository.objectFormat, kind: "tree", oid });
}

type SandboxOwner = {
  readonly schemaVersion: typeof OWNER_SCHEMA_VERSION;
  readonly operation: "gr.workspace.sandbox.materialize";
  readonly materializationId: string;
  readonly materializationFingerprint: string;
  readonly repositoryFingerprint: string;
  readonly baselineSnapshotId: string;
  readonly baselineSnapshotFingerprint: string;
  readonly containerRoot: string;
  readonly workspaceRoot: string;
};

function sandboxOwner(sandbox: GrSnapshotSandbox): SandboxOwner {
  return {
    schemaVersion: OWNER_SCHEMA_VERSION,
    operation: "gr.workspace.sandbox.materialize",
    materializationId: sandbox.materializationId,
    materializationFingerprint: sandbox.materializationFingerprint,
    repositoryFingerprint: sandbox.repository.fingerprint,
    baselineSnapshotId: sandbox.baseline.id,
    baselineSnapshotFingerprint: sandbox.baseline.fingerprint,
    containerRoot: sandbox.containerRoot,
    workspaceRoot: sandbox.workspaceRoot,
  };
}

function parseSandboxOwner(value: unknown): SandboxOwner {
  const normalized = normalizeGrJson(value);
  if (
    !isGrRecord(normalized) ||
    !hasExactGrKeys(normalized, [
      "schemaVersion",
      "operation",
      "materializationId",
      "materializationFingerprint",
      "repositoryFingerprint",
      "baselineSnapshotId",
      "baselineSnapshotFingerprint",
      "containerRoot",
      "workspaceRoot",
    ]) ||
    normalized.schemaVersion !== OWNER_SCHEMA_VERSION ||
    normalized.operation !== "gr.workspace.sandbox.materialize" ||
    !isNonEmptyGrString(normalized.materializationId) ||
    !isNonEmptyGrString(normalized.materializationFingerprint) ||
    !isNonEmptyGrString(normalized.repositoryFingerprint) ||
    !isNonEmptyGrString(normalized.baselineSnapshotId) ||
    !isNonEmptyGrString(normalized.baselineSnapshotFingerprint) ||
    !isNonEmptyGrString(normalized.containerRoot) ||
    !isNonEmptyGrString(normalized.workspaceRoot)
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR sandbox ownership marker is invalid.");
  }
  return normalized as unknown as SandboxOwner;
}

function assertSafeSandboxPaths(sandbox: GrSnapshotSandbox): void {
  if (
    !path.isAbsolute(sandbox.containerRoot) ||
    path.resolve(sandbox.containerRoot) !== sandbox.containerRoot ||
    path.basename(sandbox.containerRoot).startsWith(CONTAINER_PREFIX) === false ||
    path.dirname(sandbox.containerRoot) !== path.resolve(tmpdir()) ||
    sandbox.workspaceRoot !== path.join(sandbox.containerRoot, WORKSPACE_NAME) ||
    sandbox.ownershipMarker !== path.join(sandbox.containerRoot, MARKER_NAME)
  ) {
    throw new GrError(
      "GR_PATH_UNSAFE",
      "GR sandbox paths do not match the owned temporary layout.",
      {
        containerRoot: sandbox.containerRoot,
      },
    );
  }
}

async function assertOwnedSandbox(sandbox: GrSnapshotSandbox): Promise<void> {
  assertSafeSandboxPaths(sandbox);
  const [containerStat, workspaceStat, markerStat] = await Promise.all([
    lstat(sandbox.containerRoot),
    lstat(sandbox.workspaceRoot),
    lstat(sandbox.ownershipMarker),
  ]);
  if (
    containerStat.isSymbolicLink() ||
    !containerStat.isDirectory() ||
    workspaceStat.isSymbolicLink() ||
    !workspaceStat.isDirectory() ||
    markerStat.isSymbolicLink() ||
    !markerStat.isFile() ||
    (await realpath(sandbox.containerRoot)) !== sandbox.containerRoot
  ) {
    throw new GrError(
      "GR_SANDBOX_OWNERSHIP",
      "GR sandbox ownership layout was replaced or linked.",
      {
        containerRoot: sandbox.containerRoot,
      },
    );
  }
  let owner: SandboxOwner;
  try {
    owner = parseSandboxOwner(JSON.parse(await readFile(sandbox.ownershipMarker, "utf8")));
  } catch (error) {
    if (error instanceof GrError) throw error;
    throw new GrError("GR_SANDBOX_OWNERSHIP", "GR sandbox ownership marker cannot be read.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (stableGrJsonStringify(owner) !== stableGrJsonStringify(sandboxOwner(sandbox))) {
    throw new GrError(
      "GR_SANDBOX_OWNERSHIP",
      "GR sandbox ownership marker does not match the materialization.",
      {
        containerRoot: sandbox.containerRoot,
      },
    );
  }
}

async function captureTree(
  repository: GrRepositoryIdentity,
  sandbox: GrSnapshotSandbox,
  baselineTreeOid: string,
  signal?: AbortSignal,
): Promise<string> {
  if (await pathExists(path.join(sandbox.workspaceRoot, ".git"))) {
    throw new GrError("GR_SANDBOX_PATH_DENIED", "A GR sandbox workspace must not contain .git.");
  }
  const alternateIndex = path.join(sandbox.containerRoot, INDEX_NAME);
  await rm(alternateIndex, { force: true });
  const env = {
    GIT_DIR: repository.gitDirectory,
    GIT_INDEX_FILE: alternateIndex,
    GIT_WORK_TREE: sandbox.workspaceRoot,
  };
  try {
    await runRequiredGrGit(sandbox.workspaceRoot, ["read-tree", baselineTreeOid], {
      env,
      ...(signal ? { signal } : {}),
    });
    await runRequiredGrGit(sandbox.workspaceRoot, ["add", "-A", "-f", "--", "."], {
      env,
      ...(signal ? { signal } : {}),
    });
    return (
      await runRequiredGrGit(sandbox.workspaceRoot, ["write-tree"], {
        env,
        ...(signal ? { signal } : {}),
      })
    ).trim();
  } finally {
    await rm(alternateIndex, { force: true });
  }
}

export function parseGrSnapshotSandbox(value: unknown): GrSnapshotSandbox {
  const normalized = normalizeGrJson(value) as unknown as GrSnapshotSandbox;
  if (
    normalized.schemaVersion !== GR_SNAPSHOT_SANDBOX_SCHEMA_VERSION ||
    normalized.operation !== "gr.workspace.sandbox.materialize" ||
    !isNonEmptyGrString(normalized.materializationId) ||
    !isNonEmptyGrString(normalized.materializationFingerprint) ||
    !isGrRepositoryIdentity(normalized.repository) ||
    !isGrRecord(normalized.baseline) ||
    !hasExactGrKeys(normalized.baseline, ["id", "fingerprint", "indexTree", "worktreeTree"]) ||
    !isNonEmptyGrString(normalized.baseline.id) ||
    !isNonEmptyGrString(normalized.baseline.fingerprint) ||
    !isGrGitObjectReference(normalized.baseline.indexTree, "tree") ||
    !isGrGitObjectReference(normalized.baseline.worktreeTree, "tree") ||
    normalized.baseline.indexTree.algorithm !== normalized.repository.objectFormat ||
    normalized.baseline.worktreeTree.algorithm !== normalized.repository.objectFormat ||
    !isGrRecord(normalized.scope) ||
    !hasExactGrKeys(normalized.scope, ["kind"]) ||
    normalized.scope.kind !== "workspace" ||
    normalized.strategy !== "git-tree-alternate-index" ||
    !isNonEmptyGrString(normalized.containerRoot) ||
    !isNonEmptyGrString(normalized.workspaceRoot) ||
    !isNonEmptyGrString(normalized.ownershipMarker) ||
    normalized.retention !== "ephemeral" ||
    !isGrRecord(normalized.gitEffects) ||
    !hasExactGrKeys(normalized.gitEffects, ["realIndex", "refs", "commits", "objects"]) ||
    normalized.gitEffects.realIndex !== "verified-unchanged" ||
    normalized.gitEffects.refs !== "not-created" ||
    normalized.gitEffects.commits !== "not-created" ||
    normalized.gitEffects.objects !== "borrowed-ephemeral"
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR snapshot sandbox schema is invalid.");
  }
  assertSafeSandboxPaths(normalized);
  const { materializationId, materializationFingerprint, ...semantic } = normalized;
  const expected = fingerprintGrJson(semantic, "gr.snapshot-sandbox.v0");
  if (
    materializationFingerprint !== expected ||
    materializationId !== `gr-sandbox-${expected.slice(0, 20)}`
  ) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR snapshot sandbox fingerprint or ID does not match its content.",
    );
  }
  return normalized;
}

export async function materializeGrSnapshotSandbox(
  request: GrSnapshotSandboxMaterializeRequest,
): Promise<GrSnapshotSandbox> {
  assertGrEffects(
    ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    request.grantedEffects,
  );
  const baseline = parseGrSnapshot(request.baseline);
  if (baseline.scope.kind !== "workspace") {
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      "GR sandbox v0 requires a workspace-scoped baseline.",
    );
  }
  const repository = await currentRepository(request.root, request.signal);
  assertSameRepository(baseline.repository, repository, "GR sandbox baseline");
  await runRequiredGrGit(
    repository.root,
    ["cat-file", "-e", `${baseline.worktreeTree.oid}^{tree}`],
    request.signal ? { signal: request.signal } : {},
  );

  return await withUnchangedRealIndex(repository.root, request.signal, async () => {
    let containerRoot: string | undefined;
    try {
      containerRoot = await realpath(await mkdtemp(path.join(tmpdir(), CONTAINER_PREFIX)));
      const workspaceRoot = path.join(containerRoot, WORKSPACE_NAME);
      const ownershipMarker = path.join(containerRoot, MARKER_NAME);
      const alternateIndex = path.join(containerRoot, INDEX_NAME);
      await mkdir(workspaceRoot, { mode: 0o700 });
      const env = { GIT_INDEX_FILE: alternateIndex };
      await runRequiredGrGit(repository.root, ["read-tree", baseline.worktreeTree.oid], {
        env,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      await runRequiredGrGit(
        repository.root,
        ["checkout-index", "--all", "--force", `--prefix=${workspaceRoot}${path.sep}`],
        { env, ...(request.signal ? { signal: request.signal } : {}) },
      );
      await rm(alternateIndex, { force: true });

      const semantic = {
        schemaVersion: GR_SNAPSHOT_SANDBOX_SCHEMA_VERSION,
        operation: "gr.workspace.sandbox.materialize" as const,
        repository,
        baseline: {
          id: baseline.snapshotId,
          fingerprint: baseline.snapshotFingerprint,
          indexTree: baseline.indexTree,
          worktreeTree: baseline.worktreeTree,
        },
        scope: { kind: "workspace" as const },
        strategy: "git-tree-alternate-index" as const,
        containerRoot,
        workspaceRoot,
        ownershipMarker,
        retention: "ephemeral" as const,
        gitEffects: {
          realIndex: "verified-unchanged" as const,
          refs: "not-created" as const,
          commits: "not-created" as const,
          objects: "borrowed-ephemeral" as const,
        },
      };
      const materializationFingerprint = fingerprintGrJson(semantic, "gr.snapshot-sandbox.v0");
      const sandbox = normalizeGrJson({
        ...semantic,
        materializationId: `gr-sandbox-${materializationFingerprint.slice(0, 20)}`,
        materializationFingerprint,
      }) as unknown as GrSnapshotSandbox;
      await writeFile(ownershipMarker, `${stableGrJsonStringify(sandboxOwner(sandbox))}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const captured = await captureTree(
        repository,
        sandbox,
        baseline.worktreeTree.oid,
        request.signal,
      );
      if (captured !== baseline.worktreeTree.oid) {
        throw new GrError(
          "GR_STALE_STATE",
          "Materialized GR sandbox does not exactly match its baseline tree.",
          { actualTree: captured, expectedTree: baseline.worktreeTree.oid },
        );
      }
      return parseGrSnapshotSandbox(sandbox);
    } catch (error) {
      if (containerRoot) await rm(containerRoot, { force: true, recursive: true });
      throw error;
    }
  });
}

export async function captureGrSnapshotSandboxResult(
  request: GrSnapshotSandboxCaptureRequest,
): Promise<GrSnapshot> {
  assertGrEffects(
    ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    request.grantedEffects,
  );
  const baseline = parseGrSnapshot(request.baseline);
  const sandbox = parseGrSnapshotSandbox(request.sandbox);
  const repository = await currentRepository(request.root, request.signal);
  assertSameRepository(baseline.repository, repository, "GR sandbox baseline");
  assertSameRepository(sandbox.repository, repository, "GR sandbox materialization");
  if (
    sandbox.baseline.id !== baseline.snapshotId ||
    sandbox.baseline.fingerprint !== baseline.snapshotFingerprint ||
    sandbox.baseline.indexTree.oid !== baseline.indexTree.oid ||
    sandbox.baseline.worktreeTree.oid !== baseline.worktreeTree.oid
  ) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR sandbox baseline does not match the supplied snapshot.",
    );
  }
  await assertOwnedSandbox(sandbox);
  const allowed = new Set(request.allowedChangedPaths.map(assertGrRelativePath));

  return await withUnchangedRealIndex(repository.root, request.signal, async () => {
    const candidateTreeOid = await captureTree(
      repository,
      sandbox,
      baseline.worktreeTree.oid,
      request.signal,
    );
    const stateSemantic = {
      materializationId: sandbox.materializationId,
      materializationFingerprint: sandbox.materializationFingerprint,
      baselineSnapshotId: baseline.snapshotId,
      baselineSnapshotFingerprint: baseline.snapshotFingerprint,
      baselineTree: baseline.worktreeTree,
      resultTree: treeObject(repository, candidateTreeOid),
    };
    const stateFingerprint = fingerprintGrJson(stateSemantic, "gr.snapshot-sandbox-state.v0");
    const statusFingerprint = fingerprintGrJson(
      { baselineTree: baseline.worktreeTree, resultTree: treeObject(repository, candidateTreeOid) },
      "gr.snapshot-sandbox-status.v0",
    );
    const inspectionFingerprint = fingerprintGrJson(
      {
        repository,
        sandbox: sandbox.materializationFingerprint,
        stateFingerprint,
        statusFingerprint,
      },
      "gr.snapshot-sandbox-inspection.v0",
    );
    const semanticSnapshot = {
      schemaVersion: GR_SNAPSHOT_SCHEMA_VERSION,
      operation: "gr.workspace.snapshot" as const,
      repository,
      role: "result" as const,
      origin: {
        kind: "snapshot-sandbox" as const,
        materializationId: sandbox.materializationId,
        materializationFingerprint: sandbox.materializationFingerprint,
        baselineSnapshotId: baseline.snapshotId,
        baselineSnapshotFingerprint: baseline.snapshotFingerprint,
        stateFingerprint,
      },
      scope: baseline.scope,
      inspectionFingerprint,
      statusFingerprint,
      head: baseline.head,
      indexTree: baseline.indexTree,
      worktreeTree: treeObject(repository, candidateTreeOid),
      coverage: baseline.coverage,
      retention: "ephemeral" as const,
    };
    const snapshotFingerprint = fingerprintGrJson(semanticSnapshot, "gr.snapshot.v0");
    const result = parseGrSnapshot(
      normalizeGrJson({
        ...semanticSnapshot,
        snapshotId: `gr-snapshot-${snapshotFingerprint.slice(0, 20)}`,
        snapshotFingerprint,
      }),
    );
    const diff = await diffGrSnapshots(baseline, result, {
      grantedEffects: ["git.read"],
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const denied = diff.files.flatMap((file) =>
      [file.path, file.originalPath].filter(
        (changedPath): changedPath is string =>
          changedPath !== undefined && !allowed.has(changedPath),
      ),
    );
    if (denied.length > 0) {
      throw new GrError(
        "GR_SANDBOX_PATH_DENIED",
        "GR sandbox result changed paths outside the exact allowlist.",
        { allowed: [...allowed].sort(), denied: [...new Set(denied)].sort() },
      );
    }
    return result;
  });
}

function failureEvidence(error: unknown): GrFailureEvidence {
  if (error instanceof GrError) {
    return normalizeGrJson({
      code: error.code,
      message: error.message,
      details: error.details,
    }) as unknown as GrFailureEvidence;
  }
  return Object.freeze({
    code: "GR_SANDBOX_CLEANUP_FAILED",
    message: error instanceof Error ? error.message : String(error),
  });
}

function cleanupReceipt(
  sandbox: GrSnapshotSandbox,
  status: GrSandboxCleanupReceipt["status"],
  failure?: GrFailureEvidence,
): GrSandboxCleanupReceipt {
  const semantic = {
    schemaVersion: GR_SANDBOX_CLEANUP_RECEIPT_SCHEMA_VERSION,
    operation: "gr.workspace.sandbox.cleanup" as const,
    materialization: {
      id: sandbox.materializationId,
      fingerprint: sandbox.materializationFingerprint,
    },
    status,
    removedPath: sandbox.containerRoot,
    ...(failure ? { failure } : {}),
  };
  return normalizeGrJson({
    ...semantic,
    receiptFingerprint: fingerprintGrJson(semantic, "gr.snapshot-sandbox-cleanup-receipt.v0"),
  }) as unknown as GrSandboxCleanupReceipt;
}

export function parseGrSandboxCleanupReceipt(value: unknown): GrSandboxCleanupReceipt {
  const normalized = normalizeGrJson(value) as unknown as GrSandboxCleanupReceipt;
  if (
    normalized.schemaVersion !== GR_SANDBOX_CLEANUP_RECEIPT_SCHEMA_VERSION ||
    normalized.operation !== "gr.workspace.sandbox.cleanup" ||
    !isGrRecord(normalized.materialization) ||
    !hasExactGrKeys(normalized.materialization, ["id", "fingerprint"]) ||
    !isNonEmptyGrString(normalized.materialization.id) ||
    !isNonEmptyGrString(normalized.materialization.fingerprint) ||
    !["already-absent", "failed", "removed"].includes(normalized.status) ||
    !isNonEmptyGrString(normalized.removedPath) ||
    !isNonEmptyGrString(normalized.receiptFingerprint) ||
    (normalized.failure !== undefined && !isGrFailureEvidence(normalized.failure)) ||
    (normalized.status === "failed") !== (normalized.failure !== undefined)
  ) {
    throw new GrError("GR_INVALID_RECEIPT", "GR sandbox cleanup receipt schema is invalid.");
  }
  const { receiptFingerprint, ...semantic } = normalized;
  if (
    receiptFingerprint !== fingerprintGrJson(semantic, "gr.snapshot-sandbox-cleanup-receipt.v0")
  ) {
    throw new GrError("GR_INVALID_RECEIPT", "GR sandbox cleanup receipt fingerprint is invalid.");
  }
  return normalized;
}

export async function cleanupGrSnapshotSandbox(
  request: GrSnapshotSandboxCleanupRequest,
): Promise<GrSandboxCleanupReceipt> {
  assertGrEffects(["filesystem.read", "filesystem.write", "git.read"], request.grantedEffects);
  const sandbox = parseGrSnapshotSandbox(request.sandbox);
  try {
    const repository = await currentRepository(request.root);
    assertSameRepository(sandbox.repository, repository, "GR sandbox materialization");
    assertSafeSandboxPaths(sandbox);
    if (!(await pathExists(sandbox.containerRoot))) {
      return cleanupReceipt(sandbox, "already-absent");
    }
    await assertOwnedSandbox(sandbox);
    await rm(sandbox.containerRoot, { recursive: true });
    if (await pathExists(sandbox.containerRoot)) {
      throw new GrError(
        "GR_SANDBOX_CLEANUP_FAILED",
        "GR sandbox container still exists after cleanup.",
        {
          containerRoot: sandbox.containerRoot,
        },
      );
    }
    return cleanupReceipt(sandbox, "removed");
  } catch (error) {
    return cleanupReceipt(sandbox, "failed", failureEvidence(error));
  }
}
