import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiscoverRvsPrivateWorkspaceBindingOptions } from "@reliverse/rvs-private";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { normalizeGrJson } from "./json";
import type { GrEffectKind } from "./model";
import { resolveGrDurablePrivatePath } from "./private-root";
import { inspectGrRepositoryVersion } from "./repository-version";
import {
  GR_TRANSITION_STATE_SCHEMA_VERSION,
  inspectGrTransitionState,
  parseGrTransitionState,
  type GrTransitionStateV0,
} from "./transition-state";

export const GR_PRIVATE_CONTINUATION_SCHEMA_VERSION = "gr.private-continuation.v0" as const;
export const GR_PRIVATE_CONTINUATION_PATH = "continuation/gr-transition-state.json" as const;

export type GrPrivateContinuationV0 =
  | { readonly kind: "none" }
  | {
      readonly kind: "gr-transition-state";
      readonly schemaVersion: typeof GR_PRIVATE_CONTINUATION_SCHEMA_VERSION;
      readonly path: typeof GR_PRIVATE_CONTINUATION_PATH;
      readonly sha256: string;
      readonly stateSchemaVersion: typeof GR_TRANSITION_STATE_SCHEMA_VERSION;
      readonly repository: GrTransitionStateV0["repository"];
      readonly lastSequence: number;
    };

export interface RestoreGrBundleContinuationRequest {
  readonly root: string;
  readonly bundleRoot: string;
  readonly grantedEffects?: readonly GrEffectKind[];
  readonly topology?: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot">;
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function serializeGrTransitionState(state: GrTransitionStateV0): string {
  return `${JSON.stringify(normalizeGrJson(state), null, 2)}\n`;
}

export async function createGrPrivateContinuation(
  root: string,
  stagingRoot: string,
  options: { readonly grantedEffects?: readonly GrEffectKind[] } = {},
): Promise<GrPrivateContinuationV0> {
  assertGrEffects(["filesystem.read", "filesystem.write"], options.grantedEffects);
  const state = await inspectGrTransitionState(root, { grantedEffects: ["filesystem.read"] });
  if (!state) return Object.freeze({ kind: "none" });

  const relativePath = GR_PRIVATE_CONTINUATION_PATH;
  const file = path.join(stagingRoot, ...relativePath.split("/"));
  const content = serializeGrTransitionState(state);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return Object.freeze({
    kind: "gr-transition-state" as const,
    schemaVersion: GR_PRIVATE_CONTINUATION_SCHEMA_VERSION,
    path: relativePath,
    sha256: sha256(content),
    stateSchemaVersion: state.schemaVersion,
    repository: state.repository,
    lastSequence: state.lastSequence,
  });
}

function parseContinuationManifest(value: unknown): GrPrivateContinuationV0 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR bundle manifest continuation must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "none") return Object.freeze({ kind: "none" });
  if (
    record.kind !== "gr-transition-state" ||
    record.schemaVersion !== GR_PRIVATE_CONTINUATION_SCHEMA_VERSION ||
    record.path !== GR_PRIVATE_CONTINUATION_PATH ||
    typeof record.sha256 !== "string" ||
    record.stateSchemaVersion !== GR_TRANSITION_STATE_SCHEMA_VERSION ||
    typeof record.repository !== "object" ||
    record.repository === null ||
    Array.isArray(record.repository) ||
    !Number.isSafeInteger(record.lastSequence) ||
    (record.lastSequence as number) < 0
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "Malformed GR bundle private continuation metadata.");
  }
  const repository = record.repository as Record<string, unknown>;
  if (typeof repository.packageName !== "string" || typeof repository.artifactName !== "string") {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Malformed GR bundle continuation repository identity.",
    );
  }
  return Object.freeze({
    kind: "gr-transition-state" as const,
    schemaVersion: GR_PRIVATE_CONTINUATION_SCHEMA_VERSION,
    path: GR_PRIVATE_CONTINUATION_PATH,
    sha256: record.sha256,
    stateSchemaVersion: GR_TRANSITION_STATE_SCHEMA_VERSION,
    repository: Object.freeze({
      packageName: repository.packageName,
      artifactName: repository.artifactName,
    }),
    lastSequence: record.lastSequence as number,
  });
}

async function readExistingState(
  root: string,
  topology: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot"> | undefined,
): Promise<{ statePath: string; state: GrTransitionStateV0 | null }> {
  const statePath = await resolveGrDurablePrivatePath(
    root,
    ["transition-state.json"],
    topology ?? {},
  );
  try {
    const state = parseGrTransitionState(JSON.parse(await readFile(statePath, "utf8")), statePath);
    return { statePath, state };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { statePath, state: null };
    }
    if (error instanceof SyntaxError) {
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        `Unable to parse existing GR transition state JSON: ${statePath}.`,
      );
    }
    throw error;
  }
}

export async function restoreGrBundleContinuation(request: RestoreGrBundleContinuationRequest) {
  assertGrEffects(["filesystem.read", "filesystem.write", "git.read"], request.grantedEffects);
  const root = path.resolve(request.root);
  const bundleRoot = path.resolve(request.bundleRoot);
  let manifest: any;
  try {
    manifest = JSON.parse(await readFile(path.join(bundleRoot, "bundle.json"), "utf8"));
  } catch {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR bundle continuation restore requires a readable bundle.json.",
    );
  }
  if (manifest?.schemaVersion !== "gr.repository-bundle.v0") {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Unsupported GR repository bundle schema for continuation restore.",
    );
  }
  const continuation = parseContinuationManifest(manifest.continuation ?? { kind: "none" });
  if (continuation.kind === "none") {
    return Object.freeze({
      schemaVersion: "gr.private-continuation-restore.v0" as const,
      restored: false,
      reason: "not-present" as const,
    });
  }

  const continuationFile = path.join(bundleRoot, ...continuation.path.split("/"));
  const content = await readFile(continuationFile);
  if (sha256(content) !== continuation.sha256) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR private continuation checksum mismatch.", {
      path: continuation.path,
    });
  }
  const incoming = parseGrTransitionState(JSON.parse(content.toString("utf8")), continuationFile);
  if (
    incoming.repository.packageName !== continuation.repository.packageName ||
    incoming.repository.artifactName !== continuation.repository.artifactName ||
    incoming.lastSequence !== continuation.lastSequence
  ) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR private continuation content does not match bundle manifest metadata.",
    );
  }

  const repository = await inspectGrRepositoryVersion(root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  if (
    repository.packageName !== incoming.repository.packageName ||
    repository.artifactName !== incoming.repository.artifactName
  ) {
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "GR private continuation belongs to another repository.",
      {
        incoming: incoming.repository,
        repository: { packageName: repository.packageName, artifactName: repository.artifactName },
      },
    );
  }

  const { statePath, state: existing } = await readExistingState(root, request.topology);
  if (existing) {
    if (
      existing.repository.packageName !== incoming.repository.packageName ||
      existing.repository.artifactName !== incoming.repository.artifactName ||
      existing.initializedFrom.kind !== incoming.initializedFrom.kind ||
      existing.initializedFrom.version !== incoming.initializedFrom.version
    ) {
      throw new GrError(
        "GR_REPOSITORY_MISMATCH",
        "Existing GR private transition state is incompatible with imported continuation.",
      );
    }
    if (existing.lastSequence > incoming.lastSequence) {
      return Object.freeze({
        schemaVersion: "gr.private-continuation-restore.v0" as const,
        restored: false,
        reason: "newer-local-state" as const,
        statePath,
        lastSequence: existing.lastSequence,
      });
    }
    if (existing.lastSequence === incoming.lastSequence) {
      return Object.freeze({
        schemaVersion: "gr.private-continuation-restore.v0" as const,
        restored: false,
        reason: "already-current" as const,
        statePath,
        lastSequence: existing.lastSequence,
      });
    }
  }

  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, serializeGrTransitionState(incoming), {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, statePath);
  return Object.freeze({
    schemaVersion: "gr.private-continuation-restore.v0" as const,
    restored: true,
    reason: existing ? ("advanced" as const) : ("imported" as const),
    statePath,
    lastSequence: incoming.lastSequence,
  });
}
