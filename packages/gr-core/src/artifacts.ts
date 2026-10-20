import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { normalizeGrJson } from "./json";
import type {
  GrArtifactPaths,
  GrEffectKind,
  GrPatch,
  GrRecoveryCapsule,
  GrRestoreReceipt,
  GrSandboxCleanupReceipt,
  GrSnapshot,
  GrSnapshotSandbox,
} from "./model";
import { parseGrPatch } from "./patch";
import { assertGrArtifactId, resolveGrRoot } from "./paths";
import { resolveGrPrivatePath } from "./private-root";
import { parseGrRecoveryCapsule } from "./recovery";
import { parseGrRestoreReceipt } from "./restore";
import { parseGrSandboxCleanupReceipt, parseGrSnapshotSandbox } from "./sandbox";
import { parseGrSnapshot } from "./snapshot";

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(normalizeGrJson(value), null, 2)}\n`;
}

function patchManifest(patch: GrPatch): unknown {
  return {
    schemaVersion: "gr.patch-artifact-manifest.v0",
    artifact: { kind: "patch", id: patch.patchId, fingerprint: patch.patchFingerprint },
    repository: patch.repository,
    format: patch.format,
    before: {
      id: patch.before.snapshotId,
      fingerprint: patch.before.snapshotFingerprint,
      tree: patch.before.worktreeTree,
    },
    result: {
      id: patch.result.snapshotId,
      fingerprint: patch.result.snapshotFingerprint,
      tree: patch.result.worktreeTree,
    },
    diff: { fingerprint: patch.diff.diffFingerprint, files: patch.diff.files },
    files: {
      forward: { path: "changes.patch", fingerprint: patch.forward.fingerprint },
      reverse: { path: "reverse.patch", fingerprint: patch.reverse.fingerprint },
    },
  };
}

async function createArtifactDirectory(
  root: string,
  category: string,
  id: string,
): Promise<string> {
  const categoryRoot = resolveGrPrivatePath(root, category);
  const directory = path.join(categoryRoot, assertGrArtifactId(id));
  await mkdir(categoryRoot, { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new GrError("GR_ARTIFACT_EXISTS", `GR artifact already exists: ${directory}`, {
        directory,
      });
    }
    throw error;
  }
  return directory;
}

async function assertArtifactTarget(targetRoot: string, artifactRoot: string): Promise<string> {
  const root = await resolveGrRoot(targetRoot);
  if (root !== artifactRoot) {
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "GR artifact target does not match its repository root.",
      {
        artifactRoot,
        targetRoot: root,
      },
    );
  }
  return root;
}

export async function materializeGrSnapshot(
  targetRoot: string,
  snapshotValue: GrSnapshot,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const snapshot = parseGrSnapshot(snapshotValue);
  const root = await assertArtifactTarget(targetRoot, snapshot.repository.root);
  const directory = await createArtifactDirectory(root, "snapshots", snapshot.snapshotId);
  const manifest = path.join(directory, "snapshot.json");
  await writeFile(manifest, jsonDocument(snapshot), { encoding: "utf8", flag: "wx" });
  return Object.freeze({ directory, manifest, files: Object.freeze({ snapshot: manifest }) });
}

export async function materializeGrPatch(
  targetRoot: string,
  patchValue: GrPatch,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const patchArtifact = parseGrPatch(patchValue);
  const root = await assertArtifactTarget(targetRoot, patchArtifact.repository.root);
  const directory = await createArtifactDirectory(root, "patches", patchArtifact.patchId);
  const manifest = path.join(directory, "manifest.json");
  const forward = path.join(directory, "changes.patch");
  const reverse = path.join(directory, "reverse.patch");
  await Promise.all([
    writeFile(manifest, jsonDocument(patchManifest(patchArtifact)), {
      encoding: "utf8",
      flag: "wx",
    }),
    writeFile(forward, patchArtifact.forward.content, { encoding: "utf8", flag: "wx" }),
    writeFile(reverse, patchArtifact.reverse.content, { encoding: "utf8", flag: "wx" }),
  ]);
  return Object.freeze({
    directory,
    manifest,
    files: Object.freeze({ changesPatch: forward, reversePatch: reverse }),
  });
}

export async function materializeGrRecoveryCapsule(
  targetRoot: string,
  capsuleValue: GrRecoveryCapsule,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const capsule = parseGrRecoveryCapsule(capsuleValue);
  const root = await assertArtifactTarget(targetRoot, capsule.repository.root);
  const directory = await createArtifactDirectory(root, "recovery", capsule.capsuleId);
  const manifest = path.join(directory, "capsule.json");
  await writeFile(manifest, jsonDocument(capsule), { encoding: "utf8", flag: "wx" });
  return Object.freeze({ directory, manifest, files: Object.freeze({ capsule: manifest }) });
}

export async function materializeGrSnapshotSandboxArtifact(
  targetRoot: string,
  sandboxValue: GrSnapshotSandbox,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const sandbox = parseGrSnapshotSandbox(sandboxValue);
  const root = await assertArtifactTarget(targetRoot, sandbox.repository.root);
  const directory = await createArtifactDirectory(root, "sandboxes", sandbox.materializationId);
  const manifest = path.join(directory, "materialization.json");
  await writeFile(manifest, jsonDocument(sandbox), { encoding: "utf8", flag: "wx" });
  return Object.freeze({
    directory,
    manifest,
    files: Object.freeze({ materialization: manifest }),
  });
}

export async function materializeGrSandboxCleanupReceipt(
  targetRoot: string,
  sandboxValue: GrSnapshotSandbox,
  receiptValue: GrSandboxCleanupReceipt,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const sandbox = parseGrSnapshotSandbox(sandboxValue);
  const receipt = parseGrSandboxCleanupReceipt(receiptValue);
  const root = await assertArtifactTarget(targetRoot, sandbox.repository.root);
  if (
    receipt.materialization.id !== sandbox.materializationId ||
    receipt.materialization.fingerprint !== sandbox.materializationFingerprint
  ) {
    throw new GrError(
      "GR_INVALID_RECEIPT",
      "GR sandbox cleanup receipt does not match its materialization.",
    );
  }
  const directory = resolveGrPrivatePath(root, "sandboxes", sandbox.materializationId);
  const manifest = path.join(directory, "cleanup-receipt.json");
  await writeFile(manifest, jsonDocument(receipt), { encoding: "utf8", flag: "wx" });
  return Object.freeze({ directory, manifest, files: Object.freeze({ cleanupReceipt: manifest }) });
}

export async function materializeGrRestoreReceipt(
  targetRoot: string,
  receiptValue: GrRestoreReceipt,
  grantedEffects: readonly GrEffectKind[],
): Promise<GrArtifactPaths> {
  assertGrEffects(["artifact.write"], grantedEffects);
  const receipt = parseGrRestoreReceipt(receiptValue);
  const root = await assertArtifactTarget(targetRoot, receipt.repository.root);
  const directory = await createArtifactDirectory(root, "runs", receipt.runId);
  const manifest = path.join(directory, "restore-receipt.json");
  await writeFile(manifest, jsonDocument(receipt), { encoding: "utf8", flag: "wx" });
  return Object.freeze({ directory, manifest, files: Object.freeze({ restoreReceipt: manifest }) });
}
