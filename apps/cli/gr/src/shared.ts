import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { GrError, type GrChangedFile, type GrSnapshot, type GrWorkspaceEntry } from "@reliverse/gr";

export const GR_READ_EFFECTS = ["filesystem.read", "git.read"] as const;
export const GR_SNAPSHOT_EFFECTS = ["filesystem.read", "git.read", "git.write"] as const;
export const GR_ARTIFACT_EFFECTS = ["artifact.write"] as const;
export const GR_MUTATION_EFFECTS = [
  "filesystem.read",
  "filesystem.write",
  "git.read",
  "git.write",
] as const;

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function findGrRepositoryRoot(startDirectory: string): Promise<string> {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`unable to find repository root from ${startDirectory}`);
    current = parent;
  }
}

export const rootOption = {
  type: "string",
  description: "Repository root. Defaults to the nearest repository root.",
  inputSources: ["flag"],
} as const;

export async function resolveGrCliRoot(cwd: string, selected: string | undefined): Promise<string> {
  return selected ? path.resolve(cwd, selected) : findGrRepositoryRoot(cwd);
}

export async function resolveGrBundleTarget(
  cwd: string,
  selectedRoot: string | undefined,
  targets: readonly string[],
): Promise<{ readonly root: string; readonly paths: readonly string[] }> {
  if (selectedRoot) {
    return { root: await resolveGrCliRoot(cwd, selectedRoot), paths: [...targets] };
  }
  if (targets.length === 0) return { root: await findGrRepositoryRoot(cwd), paths: [] };

  const absoluteTargets = targets.map((target) => path.resolve(cwd, target));
  const roots = await Promise.all(
    absoluteTargets.map(async (target) => {
      try {
        return await findGrRepositoryRoot(target);
      } catch {
        return findGrRepositoryRoot(path.dirname(target));
      }
    }),
  );
  const root = roots[0]!;
  if (roots.some((candidate) => path.resolve(candidate) !== path.resolve(root))) {
    throw new Error("GR bundle targets must belong to one repository.");
  }
  const paths = absoluteTargets
    .map((target) => path.relative(root, target).replaceAll("\\", "/"))
    .filter((relative) => relative && relative !== ".");
  if (paths.some((relative) => relative === ".." || relative.startsWith("../"))) {
    throw new Error("GR bundle targets must remain inside the repository root.");
  }
  return { root, paths };
}

export async function readGrArtifact<T>(
  cwd: string,
  selectedPath: string,
  parse: (value: unknown) => T,
): Promise<T> {
  const artifactPath = path.resolve(cwd, selectedPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read GR artifact ${artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parse(value);
}

export function grErrorMessage(error: unknown): string {
  if (error instanceof GrError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export function snapshotReference(snapshot: GrSnapshot) {
  return Object.freeze({
    id: snapshot.snapshotId,
    fingerprint: snapshot.snapshotFingerprint,
    role: snapshot.role,
    tree: snapshot.worktreeTree,
    retention: snapshot.retention,
  });
}

function renderEntry(entry: GrWorkspaceEntry): string {
  const status = entry.kind === "untracked" ? "??" : `${entry.indexStatus}${entry.worktreeStatus}`;
  return `${status} ${entry.originalPath ? `${entry.originalPath} -> ` : ""}${entry.path}`;
}

export function formatWorkspaceStatus(
  entries: readonly GrWorkspaceEntry[],
  limit: number | undefined,
): readonly string[] {
  const visible = limit === undefined ? entries : entries.slice(0, limit);
  const lines = visible.map(renderEntry);
  if (visible.length < entries.length)
    lines.push(`… ${entries.length - visible.length} more paths hidden`);
  return lines;
}

function renderChangedFile(file: GrChangedFile): string {
  const binary = file.binary ? " binary" : "";
  return `${file.status}${binary} ${file.originalPath ? `${file.originalPath} -> ` : ""}${file.path}`;
}

export function formatChangedFiles(
  files: readonly GrChangedFile[],
  limit: number | undefined,
): readonly string[] {
  const visible = limit === undefined ? files : files.slice(0, limit);
  const lines = visible.map(renderChangedFile);
  if (visible.length < files.length)
    lines.push(`… ${files.length - visible.length} more paths hidden`);
  return lines;
}
