import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { normalizeGrJson } from "./json";
import type { GrArtifactPaths, GrEffectKind, GrPatch, GrSnapshot } from "./model";
import { createGrPatch } from "./patch";
import { resolveGrDurablePrivatePath } from "./private-root";
import { inspectGrRepositoryVersion } from "./repository-version";
import { createGrSnapshot, parseGrSnapshot } from "./snapshot";
import { commitGrTransition, prepareGrTransition, type GrTransitionV0 } from "./transition-state";

export type GrVersionedPatchResult = {
  readonly schemaVersion: "gr.versioned-patch-result.v0";
  readonly transition: GrTransitionV0;
  readonly patch: GrPatch;
  readonly artifacts: GrArtifactPaths;
};

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(normalizeGrJson(value), null, 2)}\n`;
}

export async function finalizeGrVersionedPatch(
  root: string,
  beforeValue: GrSnapshot,
  options: {
    readonly grantedEffects?: readonly GrEffectKind[] | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<GrVersionedPatchResult> {
  assertGrEffects(
    ["artifact.write", "filesystem.read", "filesystem.write", "git.read", "git.write"],
    options.grantedEffects,
  );
  const before = parseGrSnapshot(beforeValue);
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot !== before.repository.root) {
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "Versioned patch baseline belongs to another repository.",
    );
  }
  const repositoryVersion = await inspectGrRepositoryVersion(resolvedRoot, {
    snapshot: before,
    grantedEffects: ["filesystem.read", "git.read"],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const currentRepositoryVersion = await inspectGrRepositoryVersion(resolvedRoot, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  if (
    currentRepositoryVersion.packageName !== repositoryVersion.packageName ||
    currentRepositoryVersion.artifactName !== repositoryVersion.artifactName ||
    currentRepositoryVersion.version !== repositoryVersion.version
  ) {
    throw new GrError(
      "GR_STALE_STATE",
      "Repository package version changed after the GR baseline; GR refuses to reinterpret a public release mutation as private transition chronology.",
      { baseline: repositoryVersion, current: currentRepositoryVersion },
    );
  }

  const prepared = await prepareGrTransition(resolvedRoot, repositoryVersion, {
    grantedEffects: ["filesystem.read"],
  });
  const result = await createGrSnapshot({
    root: resolvedRoot,
    role: "result",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const patch = await createGrPatch(before, result, {
    grantedEffects: ["git.read"],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const baseName = `${repositoryVersion.artifactName}-${prepared.transition.transitionId}`;
  const directory = await resolveGrDurablePrivatePath(resolvedRoot, ["transitions", baseName]);
  await mkdir(path.dirname(directory), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new GrError(
        "GR_ARTIFACT_EXISTS",
        `GR transition artifact already exists: ${directory}`,
        {
          directory,
          transitionId: prepared.transition.transitionId,
        },
      );
    }
    throw error;
  }
  const forward = path.join(directory, `${baseName}.patch`);
  const reverse = path.join(directory, `${baseName}.reverse.patch`);
  const manifest = path.join(directory, `${baseName}.manifest.json`);
  const manifestValue = {
    schemaVersion: "gr.versioned-patch-manifest.v0",
    repository: {
      packageName: repositoryVersion.packageName,
      artifactName: repositoryVersion.artifactName,
      version: repositoryVersion.version,
    },
    transition: prepared.transition,
    patch: {
      id: patch.patchId,
      fingerprint: patch.patchFingerprint,
      format: patch.format,
      changedFiles: patch.diff.files,
    },
    files: {
      forward: { name: path.basename(forward), fingerprint: patch.forward.fingerprint },
      reverse: { name: path.basename(reverse), fingerprint: patch.reverse.fingerprint },
    },
  };
  try {
    await Promise.all([
      writeFile(forward, patch.forward.content, { encoding: "utf8", flag: "wx" }),
      writeFile(reverse, patch.reverse.content, { encoding: "utf8", flag: "wx" }),
      writeFile(manifest, jsonDocument(manifestValue), { encoding: "utf8", flag: "wx" }),
    ]);
    await commitGrTransition(prepared, { grantedEffects: ["filesystem.write"] });
  } catch (error) {
    throw error;
  }
  return Object.freeze({
    schemaVersion: "gr.versioned-patch-result.v0" as const,
    transition: prepared.transition,
    patch,
    artifacts: Object.freeze({
      directory,
      manifest,
      files: Object.freeze({ changesPatch: forward, reversePatch: reverse }),
    }),
  });
}
