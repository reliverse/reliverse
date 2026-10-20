import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { normalizeGrJson } from "./json";
import type { GrEffectKind, GrSnapshot } from "./model";
import { parseGrSnapshot } from "./snapshot";

export const GR_REPOSITORY_VERSION_SCHEMA_VERSION = "gr.repository-version.v0" as const;

export type GrRepositoryVersion = {
  readonly schemaVersion: typeof GR_REPOSITORY_VERSION_SCHEMA_VERSION;
  readonly packageName: string;
  readonly artifactName: string;
  readonly version: string;
  readonly source: "package.json";
};

const SEMVER_V0 = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseVersionedPackageJson(content: string, source: string): GrRepositoryVersion {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new GrError("GR_INVALID_ARTIFACT", `Unable to parse ${source} as JSON.`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GrError("GR_INVALID_ARTIFACT", `${source} must contain a package object.`);
  }
  const record = value as Record<string, unknown>;
  const packageName = record.name;
  const version = record.version;
  if (typeof packageName !== "string" || packageName.length === 0) {
    throw new GrError("GR_UNSUPPORTED_STATE", `${source} does not declare a package name.`);
  }
  if (typeof version !== "string" || !SEMVER_V0.test(version)) {
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      `${source} must declare a stable x.y.z package version before GR can finalize a repository patch.`,
      { version: typeof version === "string" ? version : null },
    );
  }
  const leaf = packageName.includes("/")
    ? packageName.slice(packageName.lastIndexOf("/") + 1)
    : packageName;
  const artifactName = leaf.endsWith("-root") ? leaf.slice(0, -"-root".length) : leaf;
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(artifactName)) {
    throw new GrError(
      "GR_UNSUPPORTED_STATE",
      "Repository package name cannot derive a safe patch artifact name.",
      {
        packageName,
        artifactName,
      },
    );
  }
  return normalizeGrJson({
    schemaVersion: GR_REPOSITORY_VERSION_SCHEMA_VERSION,
    packageName,
    artifactName,
    version,
    source: "package.json",
  }) as unknown as GrRepositoryVersion;
}

export async function inspectGrRepositoryVersion(
  root: string,
  options: {
    readonly grantedEffects?: readonly GrEffectKind[] | undefined;
    readonly snapshot?: GrSnapshot | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<GrRepositoryVersion> {
  assertGrEffects(["filesystem.read", "git.read"], options.grantedEffects);
  const packagePath = path.join(root, "package.json");
  if (options.snapshot) {
    const snapshot = parseGrSnapshot(options.snapshot);
    if (path.resolve(root) !== snapshot.repository.root) {
      throw new GrError(
        "GR_REPOSITORY_MISMATCH",
        "Repository version snapshot belongs to another worktree.",
      );
    }
    const content = await runRequiredGrGit(
      root,
      ["show", `${snapshot.worktreeTree.oid}:package.json`],
      options,
    );
    return parseVersionedPackageJson(content, "snapshot package.json");
  }
  return parseVersionedPackageJson(await readFile(packagePath, "utf8"), packagePath);
}
