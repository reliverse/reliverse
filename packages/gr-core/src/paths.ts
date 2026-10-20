import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { GrError } from "./error";
import type { GrSnapshotScope } from "./model";

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function resolveGrRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  let rootStat;
  try {
    rootStat = await lstat(resolved);
  } catch (error) {
    throw new GrError("GR_NOT_REPOSITORY", `GR repository root does not exist: ${resolved}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new GrError(
      "GR_PATH_UNSAFE",
      "GR repository root must be a real directory, not a symlink.",
      { root: resolved },
    );
  }
  return realpath(resolved);
}

export function assertGrRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new GrError("GR_PATH_UNSAFE", "GR path must be normalized and repository-relative.", {
      path: value,
    });
  }
  return value;
}

export function normalizeGrScope(scope: GrSnapshotScope | undefined): GrSnapshotScope {
  if (!scope || scope.kind === "workspace") return Object.freeze({ kind: "workspace" });
  const paths = [...new Set(scope.paths.map(assertGrRelativePath))].sort();
  if (paths.length === 0)
    throw new GrError("GR_PATH_UNSAFE", "A path-scoped GR snapshot requires at least one path.");
  return Object.freeze({ kind: "paths", paths: Object.freeze(paths) });
}

export function grScopePathspecs(scope: GrSnapshotScope): readonly string[] {
  return scope.kind === "workspace" ? ["."] : scope.paths;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export async function assertGrPathContained(root: string, relativePath: string): Promise<string> {
  assertGrRelativePath(relativePath);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!isInside(root, candidate)) {
    throw new GrError("GR_PATH_UNSAFE", "GR path escapes the repository root.", {
      path: relativePath,
      root,
    });
  }
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new GrError("GR_PATH_UNSAFE", "GR path traverses a symbolic link.", {
          path: relativePath,
          symlink: current,
        });
      }
    } catch (error) {
      if (missing(error)) break;
      throw error;
    }
  }
  return candidate;
}

export function assertGrArtifactId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(value) || value === "." || value === "..") {
    throw new GrError("GR_ARTIFACT_PATH_UNSAFE", "GR artifact identity is not filesystem-safe.", {
      value,
    });
  }
  return value;
}
