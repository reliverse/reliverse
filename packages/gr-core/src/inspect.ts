import { realpath } from "node:fs/promises";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runGrGit, runOptionalGrGit, runRequiredGrGit } from "./git";
import { fingerprintGrJson, normalizeGrJson } from "./json";
import {
  GR_WORKSPACE_INSPECTION_SCHEMA_VERSION,
  type GrGitObjectReference,
  type GrHeadState,
  type GrRepositoryIdentity,
  type GrWorkspaceEntry,
  type GrWorkspaceInspection,
} from "./model";
import { assertGrRelativePath, resolveGrRoot } from "./paths";

function gitObject(
  algorithm: "sha1" | "sha256",
  kind: GrGitObjectReference["kind"],
  oid: string,
): GrGitObjectReference {
  return Object.freeze({ algorithm, kind, oid });
}

function parseStatus(output: string): readonly GrWorkspaceEntry[] {
  const records = output.split("\0");
  const entries: GrWorkspaceEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("? ")) {
      entries.push({
        path: assertGrRelativePath(record.slice(2)),
        kind: "untracked",
        indexStatus: "?",
        worktreeStatus: "?",
      });
      continue;
    }
    if (record.startsWith("! ")) continue;
    if (record.startsWith("1 ")) {
      const match = /^1 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/u.exec(record);
      if (!match)
        throw new GrError("GR_GIT_FAILED", "Unable to parse Git porcelain v2 ordinary entry.", {
          record,
        });
      const status = match[1]!;
      entries.push({
        path: assertGrRelativePath(match[2]!),
        kind: status.includes("U") ? "conflicted" : "tracked",
        indexStatus: status[0]!,
        worktreeStatus: status[1]!,
      });
      continue;
    }
    if (record.startsWith("2 ")) {
      const match = /^2 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/u.exec(record);
      const originalPath = records[index + 1];
      if (!match || !originalPath)
        throw new GrError("GR_GIT_FAILED", "Unable to parse Git porcelain v2 rename entry.", {
          record,
        });
      index += 1;
      const status = match[1]!;
      entries.push({
        path: assertGrRelativePath(match[2]!),
        originalPath: assertGrRelativePath(originalPath),
        kind: status.includes("U") ? "conflicted" : "tracked",
        indexStatus: status[0]!,
        worktreeStatus: status[1]!,
      });
      continue;
    }
    if (record.startsWith("u ")) {
      const match = /^u ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/u.exec(
        record,
      );
      if (!match)
        throw new GrError("GR_GIT_FAILED", "Unable to parse Git porcelain v2 conflict entry.", {
          record,
        });
      entries.push({
        path: assertGrRelativePath(match[2]!),
        kind: "conflicted",
        indexStatus: match[1]![0]!,
        worktreeStatus: match[1]![1]!,
      });
      continue;
    }
    throw new GrError("GR_GIT_FAILED", "Unsupported Git porcelain v2 record.", { record });
  }
  return Object.freeze(
    entries.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        (left.originalPath ?? "").localeCompare(right.originalPath ?? ""),
    ),
  );
}

export async function inspectGrWorkspace(
  root: string,
  options: {
    readonly grantedEffects?: readonly ("filesystem.read" | "git.read")[] | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<GrWorkspaceInspection> {
  assertGrEffects(["filesystem.read", "git.read"], options.grantedEffects);
  const resolvedRoot = await resolveGrRoot(root);
  const discovery = await runGrGit(resolvedRoot, ["rev-parse", "--show-toplevel"], options);
  const topLevel = discovery.stdout.trim();
  if (discovery.exitCode !== 0 || topLevel.length === 0) {
    throw new GrError("GR_NOT_REPOSITORY", "Selected root is not a Git worktree root.", {
      root: resolvedRoot,
      ...(discovery.stderr.trim().length > 0 ? { stderr: discovery.stderr.trim() } : {}),
    });
  }
  const canonicalTopLevel = await realpath(path.resolve(resolvedRoot, topLevel));
  if (canonicalTopLevel !== resolvedRoot) {
    throw new GrError(
      "GR_REPOSITORY_MISMATCH",
      "Selected root is not the canonical Git worktree root.",
      {
        actual: canonicalTopLevel,
        selected: resolvedRoot,
      },
    );
  }
  const commonRaw = (
    await runRequiredGrGit(resolvedRoot, ["rev-parse", "--git-common-dir"], options)
  ).trim();
  const gitRaw = (await runRequiredGrGit(resolvedRoot, ["rev-parse", "--git-dir"], options)).trim();
  const commonDirectory = await realpath(path.resolve(resolvedRoot, commonRaw));
  const gitDirectory = await realpath(path.resolve(resolvedRoot, gitRaw));
  const objectFormatRaw =
    (
      await runOptionalGrGit(resolvedRoot, ["rev-parse", "--show-object-format"], options)
    )?.trim() || "sha1";
  if (objectFormatRaw !== "sha1" && objectFormatRaw !== "sha256") {
    throw new GrError("GR_UNSUPPORTED_STATE", `Unsupported Git object format: ${objectFormatRaw}`);
  }
  const objectFormat: "sha1" | "sha256" = objectFormatRaw;
  const repositorySemantic = {
    backend: "git" as const,
    root: resolvedRoot,
    commonDirectory,
    gitDirectory,
    objectFormat,
  };
  const repository: GrRepositoryIdentity = Object.freeze({
    ...repositorySemantic,
    fingerprint: fingerprintGrJson(repositorySemantic, "gr.repository-identity.v0"),
  });

  const commitOid = (
    await runOptionalGrGit(resolvedRoot, ["rev-parse", "--verify", "HEAD"], options)
  )?.trim();
  const ref = (
    await runOptionalGrGit(resolvedRoot, ["symbolic-ref", "-q", "HEAD"], options)
  )?.trim();
  let head: GrHeadState;
  if (!commitOid) {
    head = Object.freeze({ state: "unborn", ...(ref ? { ref } : {}) });
  } else {
    const treeOid = (
      await runRequiredGrGit(resolvedRoot, ["rev-parse", "HEAD^{tree}"], options)
    ).trim();
    head = Object.freeze({
      state: ref ? "attached" : "detached",
      ...(ref ? { ref } : {}),
      commit: gitObject(objectFormatRaw, "commit", commitOid),
      tree: gitObject(objectFormatRaw, "tree", treeOid),
    });
  }

  const statusOutput = await runRequiredGrGit(
    resolvedRoot,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    options,
  );
  const entries = parseStatus(statusOutput);
  const summary = Object.freeze({
    conflicted: entries.filter((entry) => entry.kind === "conflicted").length,
    staged: entries.filter((entry) => entry.kind !== "untracked" && entry.indexStatus !== ".")
      .length,
    tracked: entries.filter((entry) => entry.kind !== "untracked").length,
    unstaged: entries.filter((entry) => entry.kind !== "untracked" && entry.worktreeStatus !== ".")
      .length,
    untracked: entries.filter((entry) => entry.kind === "untracked").length,
    dirty: entries.length > 0,
  });
  const statusFingerprint = fingerprintGrJson({ entries, summary }, "gr.git-status.v0");
  const semanticInspection = {
    schemaVersion: GR_WORKSPACE_INSPECTION_SCHEMA_VERSION,
    operation: "gr.workspace.inspect" as const,
    repository,
    head,
    entries,
    summary,
    statusFingerprint,
  };
  return normalizeGrJson({
    ...semanticInspection,
    inspectionFingerprint: fingerprintGrJson(semanticInspection, "gr.workspace-inspection.v0"),
  }) as unknown as GrWorkspaceInspection;
}
