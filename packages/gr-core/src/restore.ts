import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runGrGit } from "./git";
import { fingerprintGrJson, normalizeGrJson } from "./json";
import {
  GR_RESTORE_RECEIPT_SCHEMA_VERSION,
  type GrFailureEvidence,
  type GrGitObjectReference,
  type GrRestoreOperationReceipt,
  type GrRestoreReceipt,
  type GrRestoreRequest,
} from "./model";
import { assertGrArtifactId, assertGrPathContained, resolveGrRoot } from "./paths";
import { parseGrRecoveryCapsule } from "./recovery";
import { createGrSnapshot } from "./snapshot";
import {
  isGrFailureEvidence,
  isGrGitObjectReference,
  isGrRecord,
  isGrRelativePathValue,
  isGrRepositoryIdentity,
  isNonEmptyGrString,
} from "./validation";

function failureFrom(error: unknown): GrFailureEvidence {
  if (error instanceof GrError) {
    return {
      code: error.code,
      message: error.message,
      ...(Object.keys(error.details).length === 0
        ? {}
        : { details: normalizeGrJson(error.details) }),
    };
  }
  return {
    code: "GR_RESTORE_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function sealRestoreReceipt(
  receipt: Omit<GrRestoreReceipt, "receiptFingerprint">,
): GrRestoreReceipt {
  const normalized = normalizeGrJson(receipt);
  return normalizeGrJson({
    ...(normalized as Readonly<Record<string, unknown>>),
    receiptFingerprint: fingerprintGrJson(normalized, "gr.restore-receipt.v0"),
  }) as unknown as GrRestoreReceipt;
}

function expectedFiles(request: GrRestoreRequest): readonly GrRestoreOperationReceipt[] {
  return Object.freeze(
    request.capsule.patch.diff.files.map((file) => ({
      path: file.path,
      status: "not-run" as const,
    })),
  );
}

function patchArgs(check: boolean): readonly string[] {
  return ["apply", "--recount", "--whitespace=nowarn", ...(check ? ["--check"] : [])];
}

function isSnapshotReceiptReference(value: unknown): boolean {
  return isGrRecord(value) && isNonEmptyGrString(value.id) && isNonEmptyGrString(value.fingerprint);
}

function isRestoreAuthorization(value: unknown): boolean {
  return (
    isGrRecord(value) &&
    (value.kind === "cli-flag" || value.kind === "trusted-caller") &&
    isNonEmptyGrString(value.source)
  );
}

function isHeadState(value: unknown): boolean {
  return (
    isGrRecord(value) &&
    (value.state === "attached" || value.state === "detached" || value.state === "unborn") &&
    (value.ref === undefined || isNonEmptyGrString(value.ref)) &&
    (value.commit === undefined || isGrGitObjectReference(value.commit, "commit")) &&
    (value.tree === undefined || isGrGitObjectReference(value.tree, "tree"))
  );
}

function isRestorePreflight(value: unknown): boolean {
  return (
    isGrRecord(value) &&
    (value.status === "failed" || value.status === "passed") &&
    isGrGitObjectReference(value.expectedTree, "tree") &&
    (value.actualTree === undefined || isGrGitObjectReference(value.actualTree, "tree")) &&
    isGrGitObjectReference(value.expectedIndexTree, "tree") &&
    (value.actualIndexTree === undefined ||
      isGrGitObjectReference(value.actualIndexTree, "tree")) &&
    isHeadState(value.expectedHead) &&
    (value.actualHead === undefined || isHeadState(value.actualHead)) &&
    (value.failure === undefined || isGrFailureEvidence(value.failure))
  );
}

function isRestoreFileReceipt(value: unknown): boolean {
  return (
    isGrRecord(value) &&
    isGrRelativePathValue(value.path) &&
    (value.status === "not-run" || value.status === "restored" || value.status === "unknown") &&
    (value.failure === undefined || isGrFailureEvidence(value.failure))
  );
}

function assertRestoreRequest(request: GrRestoreRequest): void {
  if (!request.authorization || request.authorization.source.trim().length === 0) {
    throw new GrError("GR_NOT_AUTHORIZED", "GR restore requires explicit typed authorization.");
  }
  assertGrArtifactId(request.runId);
  if (request.createdAt.trim().length === 0)
    throw new GrError("GR_INVALID_RECEIPT", "GR restore requires createdAt metadata.");
  assertGrEffects(
    ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    request.grantedEffects,
  );
}

export async function restoreGrRecoveryCapsule(
  request: GrRestoreRequest,
): Promise<GrRestoreReceipt> {
  assertRestoreRequest(request);
  const capsule = parseGrRecoveryCapsule(request.capsule);
  const expectedSnapshot =
    request.direction === "forward" ? capsule.patch.before : capsule.patch.result;
  const desiredSnapshot =
    request.direction === "forward" ? capsule.patch.result : capsule.patch.before;
  const patch = request.direction === "forward" ? capsule.patch.forward : capsule.patch.reverse;
  const expectedTree = expectedSnapshot.worktreeTree;
  const expectedIndexTree = expectedSnapshot.indexTree;
  const expectedHead = expectedSnapshot.head;
  const baseReceipt = {
    schemaVersion: GR_RESTORE_RECEIPT_SCHEMA_VERSION,
    operation: "gr.restore" as const,
    runId: request.runId,
    createdAt: request.createdAt,
    direction: request.direction,
    repository: capsule.repository,
    capsule: { id: capsule.capsuleId, fingerprint: capsule.capsuleFingerprint },
    authorization: request.authorization!,
  };

  let actualTree: GrGitObjectReference | undefined;
  let actualIndexTree: GrGitObjectReference | undefined;
  let actualHead: GrRestoreReceipt["preflight"]["actualHead"];
  let beforeSnapshot: Awaited<ReturnType<typeof createGrSnapshot>> | undefined;
  let selectedRoot: string | undefined;
  try {
    selectedRoot = await resolveGrRoot(request.root);
    for (const file of capsule.patch.diff.files) {
      await assertGrPathContained(selectedRoot, file.path);
      if (file.originalPath) await assertGrPathContained(selectedRoot, file.originalPath);
    }
    beforeSnapshot = await createGrSnapshot({
      root: selectedRoot,
      role: "checkpoint",
      scope: expectedSnapshot.scope,
      dirtyPolicy: "capture",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
      ...(request.signal ? { signal: request.signal } : {}),
    });
    actualTree = beforeSnapshot.worktreeTree;
    actualIndexTree = beforeSnapshot.indexTree;
    actualHead = beforeSnapshot.head;
    if (beforeSnapshot.repository.fingerprint !== capsule.repository.fingerprint) {
      throw new GrError(
        "GR_REPOSITORY_MISMATCH",
        "GR recovery capsule belongs to a different repository.",
        {
          actual: beforeSnapshot.repository.fingerprint,
          expected: capsule.repository.fingerprint,
        },
      );
    }
    if (
      actualTree.oid !== expectedTree.oid ||
      actualIndexTree.oid !== expectedIndexTree.oid ||
      fingerprintGrJson(actualHead, "gr.head-state.v0") !==
        fingerprintGrJson(expectedHead, "gr.head-state.v0")
    ) {
      throw new GrError(
        "GR_STALE_STATE",
        "GR restore target does not match the expected worktree, index, and HEAD state.",
        {
          actualTree: actualTree.oid,
          expectedTree: expectedTree.oid,
          actualIndexTree: actualIndexTree.oid,
          expectedIndexTree: expectedIndexTree.oid,
          actualHead: fingerprintGrJson(actualHead, "gr.head-state.v0"),
          expectedHead: fingerprintGrJson(expectedHead, "gr.head-state.v0"),
        },
      );
    }
    const checked = await runGrGit(selectedRoot, patchArgs(true), {
      input: patch.content,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (checked.exitCode !== 0) {
      throw new GrError(
        "GR_STALE_STATE",
        "Git rejected the recovery patch during restore preflight.",
        {
          stderr: checked.stderr.trim(),
        },
      );
    }
  } catch (error) {
    const failure = failureFrom(error);
    return sealRestoreReceipt({
      ...baseReceipt,
      preflight: {
        status: "failed",
        expectedTree,
        ...(actualTree ? { actualTree } : {}),
        expectedIndexTree,
        ...(actualIndexTree ? { actualIndexTree } : {}),
        expectedHead,
        ...(actualHead ? { actualHead } : {}),
        failure,
      },
      files: expectedFiles(request),
      ...(beforeSnapshot
        ? {
            beforeSnapshot: {
              id: beforeSnapshot.snapshotId,
              fingerprint: beforeSnapshot.snapshotFingerprint,
            },
          }
        : {}),
      observedEffects: ["filesystem.read", "git.read", "git.write"],
      status: "failed",
      failure,
    });
  }

  const applied = await runGrGit(selectedRoot!, patchArgs(false), {
    input: patch.content,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  if (applied.exitCode !== 0) {
    const failure = failureFrom(
      new GrError("GR_RESTORE_FAILED", "Git failed while applying the recovery patch.", {
        stderr: applied.stderr.trim(),
      }),
    );
    return sealRestoreReceipt({
      ...baseReceipt,
      preflight: {
        status: "passed",
        expectedTree,
        actualTree,
        expectedIndexTree,
        actualIndexTree,
        expectedHead,
        actualHead,
      },
      files: Object.freeze(
        capsule.patch.diff.files.map((file) => ({
          path: file.path,
          status: "unknown" as const,
          failure,
        })),
      ),
      beforeSnapshot: {
        id: beforeSnapshot!.snapshotId,
        fingerprint: beforeSnapshot!.snapshotFingerprint,
      },
      observedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
      status: "failed",
      failure,
    });
  }

  let resultSnapshot: Awaited<ReturnType<typeof createGrSnapshot>>;
  try {
    resultSnapshot = await createGrSnapshot({
      root: selectedRoot!,
      role: "result",
      scope: desiredSnapshot.scope,
      dirtyPolicy: "capture",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (
      resultSnapshot.worktreeTree.oid !== desiredSnapshot.worktreeTree.oid ||
      resultSnapshot.indexTree.oid !== desiredSnapshot.indexTree.oid ||
      fingerprintGrJson(resultSnapshot.head, "gr.head-state.v0") !==
        fingerprintGrJson(desiredSnapshot.head, "gr.head-state.v0")
    ) {
      throw new GrError(
        "GR_RESTORE_FAILED",
        "GR restore result does not match the desired worktree, index, and HEAD state.",
        {
          actualTree: resultSnapshot.worktreeTree.oid,
          expectedTree: desiredSnapshot.worktreeTree.oid,
          actualIndexTree: resultSnapshot.indexTree.oid,
          expectedIndexTree: desiredSnapshot.indexTree.oid,
        },
      );
    }
  } catch (error) {
    const failure = failureFrom(error);
    return sealRestoreReceipt({
      ...baseReceipt,
      preflight: {
        status: "passed",
        expectedTree,
        actualTree,
        expectedIndexTree,
        actualIndexTree,
        expectedHead,
        actualHead,
      },
      files: Object.freeze(
        capsule.patch.diff.files.map((file) => ({
          path: file.path,
          status: "unknown" as const,
          failure,
        })),
      ),
      beforeSnapshot: {
        id: beforeSnapshot!.snapshotId,
        fingerprint: beforeSnapshot!.snapshotFingerprint,
      },
      observedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
      status: "failed",
      failure,
    });
  }

  return sealRestoreReceipt({
    ...baseReceipt,
    preflight: {
      status: "passed",
      expectedTree,
      actualTree,
      expectedIndexTree,
      actualIndexTree,
      expectedHead,
      actualHead,
    },
    files: Object.freeze(
      capsule.patch.diff.files.map((file) => ({ path: file.path, status: "restored" as const })),
    ),
    beforeSnapshot: {
      id: beforeSnapshot!.snapshotId,
      fingerprint: beforeSnapshot!.snapshotFingerprint,
    },
    resultSnapshot: {
      id: resultSnapshot.snapshotId,
      fingerprint: resultSnapshot.snapshotFingerprint,
    },
    observedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    status: "succeeded",
  });
}

export function parseGrRestoreReceipt(value: unknown): GrRestoreReceipt {
  const normalized = normalizeGrJson(value) as unknown as GrRestoreReceipt;
  if (
    normalized.schemaVersion !== GR_RESTORE_RECEIPT_SCHEMA_VERSION ||
    normalized.operation !== "gr.restore" ||
    typeof normalized.receiptFingerprint !== "string" ||
    !isNonEmptyGrString(normalized.runId) ||
    !isNonEmptyGrString(normalized.createdAt) ||
    (normalized.direction !== "forward" && normalized.direction !== "reverse") ||
    !isGrRepositoryIdentity(normalized.repository) ||
    !isGrRecord(normalized.capsule) ||
    !isNonEmptyGrString(normalized.capsule.id) ||
    !isNonEmptyGrString(normalized.capsule.fingerprint) ||
    !isRestoreAuthorization(normalized.authorization) ||
    !isRestorePreflight(normalized.preflight) ||
    !Array.isArray(normalized.files) ||
    normalized.files.some((file) => !isRestoreFileReceipt(file)) ||
    (normalized.beforeSnapshot !== undefined &&
      !isSnapshotReceiptReference(normalized.beforeSnapshot)) ||
    (normalized.resultSnapshot !== undefined &&
      !isSnapshotReceiptReference(normalized.resultSnapshot)) ||
    !Array.isArray(normalized.observedEffects) ||
    normalized.observedEffects.some(
      (effect) =>
        ![
          "artifact.write",
          "filesystem.read",
          "filesystem.write",
          "git.read",
          "git.write",
        ].includes(effect),
    ) ||
    (normalized.status !== "failed" && normalized.status !== "succeeded") ||
    (normalized.failure !== undefined && !isGrFailureEvidence(normalized.failure))
  ) {
    throw new GrError("GR_INVALID_RECEIPT", "GR restore receipt schema is invalid.");
  }
  if (
    (normalized.status === "succeeded" &&
      (normalized.preflight.status !== "passed" ||
        normalized.failure !== undefined ||
        !normalized.beforeSnapshot ||
        !normalized.resultSnapshot ||
        normalized.files.some((file) => file.status !== "restored"))) ||
    normalized.preflight.expectedTree.algorithm !== normalized.repository.objectFormat ||
    (normalized.preflight.actualTree &&
      normalized.preflight.actualTree.algorithm !== normalized.repository.objectFormat) ||
    normalized.preflight.expectedIndexTree.algorithm !== normalized.repository.objectFormat ||
    (normalized.preflight.actualIndexTree &&
      normalized.preflight.actualIndexTree.algorithm !== normalized.repository.objectFormat) ||
    (normalized.status === "failed" && normalized.failure === undefined) ||
    (normalized.preflight.status === "failed" &&
      (normalized.status !== "failed" || normalized.preflight.failure === undefined))
  ) {
    throw new GrError(
      "GR_INVALID_RECEIPT",
      "GR restore receipt status is inconsistent with its evidence.",
    );
  }
  const { receiptFingerprint, ...semanticReceipt } = normalized;
  if (receiptFingerprint !== fingerprintGrJson(semanticReceipt, "gr.restore-receipt.v0")) {
    throw new GrError(
      "GR_INVALID_RECEIPT",
      "GR restore receipt fingerprint does not match its content.",
    );
  }
  return normalized;
}
