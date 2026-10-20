import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiscoverRvsPrivateWorkspaceBindingOptions } from "@reliverse/rvs-private";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { normalizeGrJson } from "./json";
import type { GrEffectKind } from "./model";
import { resolveGrDurablePrivatePath } from "./private-root";
import type { GrRepositoryVersion } from "./repository-version";

export const GR_TRANSITION_STATE_SCHEMA_VERSION = "gr.transition-state.v0" as const;
export const GR_TRANSITION_SCHEMA_VERSION = "gr.transition.v0" as const;

export interface GrTransitionStateV0 {
  readonly schemaVersion: typeof GR_TRANSITION_STATE_SCHEMA_VERSION;
  readonly repository: {
    readonly packageName: string;
    readonly artifactName: string;
  };
  readonly lastSequence: number;
  readonly initializedFrom: {
    readonly kind: "legacy-root-semver-patch";
    readonly version: string;
  };
}

export interface GrTransitionV0 {
  readonly schemaVersion: typeof GR_TRANSITION_SCHEMA_VERSION;
  readonly sequence: number;
  readonly transitionId: string;
  readonly repository: {
    readonly packageName: string;
    readonly artifactName: string;
    readonly version: string;
  };
}

export interface PreparedGrTransitionV0 {
  readonly transition: GrTransitionV0;
  readonly statePath: string;
  readonly nextState: GrTransitionStateV0;
  readonly previousState: GrTransitionStateV0 | null;
}

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function legacySequence(version: string): number {
  const match = STABLE_SEMVER.exec(version);
  if (!match) {
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      `GR cannot initialize private transition chronology from unsupported legacy root version: ${version}.`,
    );
  }
  const value = Number(match[3]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GrError("GR_UNSUPPORTED_STATE", `Invalid legacy GR transition seed: ${version}.`);
  }
  return value;
}

function transitionId(sequence: number): string {
  return `grt_${String(sequence).padStart(9, "0")}`;
}

export function parseGrTransitionState(
  value: unknown,
  source = "GR transition state",
): GrTransitionStateV0 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GrError("GR_INVALID_ARTIFACT", `GR transition state must be an object: ${source}.`);
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== GR_TRANSITION_STATE_SCHEMA_VERSION) {
    throw new GrError("GR_INVALID_ARTIFACT", `Unsupported GR transition state schema: ${source}.`);
  }
  const repository = record.repository;
  const initializedFrom = record.initializedFrom;
  if (
    typeof repository !== "object" ||
    repository === null ||
    Array.isArray(repository) ||
    typeof initializedFrom !== "object" ||
    initializedFrom === null ||
    Array.isArray(initializedFrom)
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", `Malformed GR transition state: ${source}.`);
  }
  const repo = repository as Record<string, unknown>;
  const init = initializedFrom as Record<string, unknown>;
  const lastSequence = record.lastSequence;
  if (
    typeof repo.packageName !== "string" ||
    repo.packageName.length === 0 ||
    typeof repo.artifactName !== "string" ||
    repo.artifactName.length === 0 ||
    !Number.isSafeInteger(lastSequence) ||
    (lastSequence as number) < 0 ||
    init.kind !== "legacy-root-semver-patch" ||
    typeof init.version !== "string"
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", `Malformed GR transition state fields: ${source}.`);
  }
  return normalizeGrJson({
    schemaVersion: GR_TRANSITION_STATE_SCHEMA_VERSION,
    repository: { packageName: repo.packageName, artifactName: repo.artifactName },
    lastSequence,
    initializedFrom: { kind: "legacy-root-semver-patch", version: init.version },
  }) as unknown as GrTransitionStateV0;
}

async function readState(statePath: string): Promise<GrTransitionStateV0 | null> {
  try {
    return parseGrTransitionState(JSON.parse(await readFile(statePath, "utf8")), statePath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        `Unable to parse GR transition state JSON: ${statePath}.`,
      );
    }
    throw error;
  }
}

export async function prepareGrTransition(
  root: string,
  repositoryVersion: GrRepositoryVersion,
  options: {
    readonly grantedEffects?: readonly GrEffectKind[] | undefined;
    readonly topology?: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot">;
  } = {},
): Promise<PreparedGrTransitionV0> {
  assertGrEffects(["filesystem.read"], options.grantedEffects);
  const statePath = await resolveGrDurablePrivatePath(
    root,
    ["transition-state.json"],
    options.topology ?? {},
  );
  const current = await readState(statePath);
  if (
    current &&
    (current.repository.packageName !== repositoryVersion.packageName ||
      current.repository.artifactName !== repositoryVersion.artifactName)
  ) {
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "GR private transition state belongs to another repository.",
      {
        statePath,
        state: current.repository,
        repository: {
          packageName: repositoryVersion.packageName,
          artifactName: repositoryVersion.artifactName,
        },
      },
    );
  }

  const seed = current?.lastSequence ?? legacySequence(repositoryVersion.version);
  if (seed >= Number.MAX_SAFE_INTEGER) {
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      "GR private transition sequence cannot be incremented.",
    );
  }
  const sequence = seed + 1;
  const nextState = Object.freeze({
    schemaVersion: GR_TRANSITION_STATE_SCHEMA_VERSION,
    repository: Object.freeze({
      packageName: repositoryVersion.packageName,
      artifactName: repositoryVersion.artifactName,
    }),
    lastSequence: sequence,
    initializedFrom:
      current?.initializedFrom ??
      Object.freeze({
        kind: "legacy-root-semver-patch" as const,
        version: repositoryVersion.version,
      }),
  });
  const transition = Object.freeze({
    schemaVersion: GR_TRANSITION_SCHEMA_VERSION,
    sequence,
    transitionId: transitionId(sequence),
    repository: Object.freeze({
      packageName: repositoryVersion.packageName,
      artifactName: repositoryVersion.artifactName,
      version: repositoryVersion.version,
    }),
  });
  return Object.freeze({ transition, statePath, nextState, previousState: current });
}

export async function commitGrTransition(
  prepared: PreparedGrTransitionV0,
  options: { readonly grantedEffects?: readonly GrEffectKind[] | undefined } = {},
): Promise<void> {
  assertGrEffects(["filesystem.write"], options.grantedEffects);
  await mkdir(path.dirname(prepared.statePath), { recursive: true });
  const temporary = `${prepared.statePath}.tmp-${process.pid}-${randomUUID()}`;
  const content = `${JSON.stringify(normalizeGrJson(prepared.nextState), null, 2)}\n`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, prepared.statePath);
}

export async function inspectGrTransitionState(
  root: string,
  options: {
    readonly grantedEffects?: readonly GrEffectKind[] | undefined;
    readonly topology?: Omit<DiscoverRvsPrivateWorkspaceBindingOptions, "workspaceRoot">;
  } = {},
): Promise<GrTransitionStateV0 | null> {
  assertGrEffects(["filesystem.read"], options.grantedEffects);
  const statePath = await resolveGrDurablePrivatePath(
    root,
    ["transition-state.json"],
    options.topology ?? {},
  );
  return readState(statePath);
}
