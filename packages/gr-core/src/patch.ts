import { diffGrSnapshots, parseGrWorkspaceDiff } from "./diff";
import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runRequiredGrGit } from "./git";
import { fingerprintGrBytes, fingerprintGrJson, normalizeGrJson } from "./json";
import { GR_PATCH_SCHEMA_VERSION, type GrPatch, type GrSnapshot } from "./model";
import { grPublicGitPathspec, isGrHardPrivatePath } from "./public-surface";
import { parseGrSnapshot } from "./snapshot";
import { assertGrRelativePath } from "./paths";
import { isGrRepositoryIdentity } from "./validation";

export async function createGrPatch(
  beforeValue: GrSnapshot,
  resultValue: GrSnapshot,
  options: {
    readonly grantedEffects?: readonly "git.read"[] | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly paths?: readonly string[] | undefined;
  } = {},
): Promise<GrPatch> {
  assertGrEffects(["git.read"], options.grantedEffects);
  const before = parseGrSnapshot(beforeValue);
  const result = parseGrSnapshot(resultValue);
  const paths = options.paths?.map(assertGrRelativePath);
  const rawDiff = await diffGrSnapshots(before, result, {
    grantedEffects: ["git.read"],
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const publicFiles = rawDiff.files.filter(
    (file) =>
      !isGrHardPrivatePath(file.path) &&
      (file.originalPath === undefined || !isGrHardPrivatePath(file.originalPath)),
  );
  const scopedFiles = paths
    ? publicFiles.filter((file) => {
        const inside = (value: string) =>
          paths.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
        return inside(file.path) || (file.originalPath !== undefined && inside(file.originalPath));
      })
    : publicFiles;
  const { diffFingerprint: _rawFingerprint, ...rawSemanticDiff } = rawDiff;
  const publicSemanticDiff = { ...rawSemanticDiff, files: scopedFiles };
  const diff = normalizeGrJson({
    ...publicSemanticDiff,
    diffFingerprint: fingerprintGrJson(publicSemanticDiff, "gr.workspace-diff.v0"),
  }) as unknown as typeof rawDiff;
  const commonArgs = [
    "--binary",
    "--full-index",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
  ];
  const pathspec = paths
    ? [
        "--",
        ...paths.map((entry) => `:(literal)${entry}`),
        ":(exclude).private",
        ":(exclude).private/**",
        ":(glob,exclude)**/.private",
        ":(glob,exclude)**/.private/**",
      ]
    : grPublicGitPathspec();
  const [forwardContent, reverseContent] = await Promise.all([
    runRequiredGrGit(
      before.repository.root,
      [
        "diff",
        ...commonArgs,
        before.worktreeTree.oid,
        result.worktreeTree.oid,
        ...pathspec,
      ],
      options,
    ),
    runRequiredGrGit(
      before.repository.root,
      [
        "diff",
        ...commonArgs,
        result.worktreeTree.oid,
        before.worktreeTree.oid,
        ...pathspec,
      ],
      options,
    ),
  ]);
  const forward = Object.freeze({
    content: forwardContent,
    fingerprint: fingerprintGrBytes(forwardContent, "gr.patch-bytes.v0"),
  });
  const reverse = Object.freeze({
    content: reverseContent,
    fingerprint: fingerprintGrBytes(reverseContent, "gr.patch-bytes.v0"),
  });
  const semanticPatch = {
    schemaVersion: GR_PATCH_SCHEMA_VERSION,
    operation: "gr.patch.create" as const,
    repository: before.repository,
    before,
    result,
    diff,
    format: "git-diff-binary-full-index" as const,
    forward,
    reverse,
  };
  const patchFingerprint = fingerprintGrJson(semanticPatch, "gr.patch.v0");
  return normalizeGrJson({
    ...semanticPatch,
    patchId: `gr-patch-${patchFingerprint.slice(0, 20)}`,
    patchFingerprint,
  }) as unknown as GrPatch;
}

export function parseGrPatch(value: unknown): GrPatch {
  const normalized = normalizeGrJson(value) as unknown as GrPatch;
  if (
    normalized.schemaVersion !== GR_PATCH_SCHEMA_VERSION ||
    normalized.operation !== "gr.patch.create" ||
    typeof normalized.patchId !== "string" ||
    typeof normalized.patchFingerprint !== "string" ||
    normalized.format !== "git-diff-binary-full-index" ||
    !isGrRepositoryIdentity(normalized.repository) ||
    typeof normalized.forward?.content !== "string" ||
    typeof normalized.reverse?.content !== "string"
  ) {
    throw new GrError("GR_INVALID_ARTIFACT", "GR patch schema is invalid.");
  }
  const before = parseGrSnapshot(normalized.before);
  const result = parseGrSnapshot(normalized.result);
  const diff = parseGrWorkspaceDiff(normalized.diff);
  if (
    normalized.repository.fingerprint !== before.repository.fingerprint ||
    normalized.repository.fingerprint !== result.repository.fingerprint ||
    normalized.repository.fingerprint !== diff.repository.fingerprint ||
    diff.before.id !== before.snapshotId ||
    diff.before.fingerprint !== before.snapshotFingerprint ||
    diff.before.tree.oid !== before.worktreeTree.oid ||
    diff.result.id !== result.snapshotId ||
    diff.result.fingerprint !== result.snapshotFingerprint ||
    diff.result.tree.oid !== result.worktreeTree.oid
  ) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR patch contains inconsistent repository, snapshot, or diff references.",
    );
  }
  if (
    normalized.forward.fingerprint !==
      fingerprintGrBytes(normalized.forward.content, "gr.patch-bytes.v0") ||
    normalized.reverse.fingerprint !==
      fingerprintGrBytes(normalized.reverse.content, "gr.patch-bytes.v0")
  ) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR patch byte fingerprint does not match its content.",
    );
  }
  const { patchId, patchFingerprint, ...semanticPatch } = normalized;
  const expected = fingerprintGrJson(semanticPatch, "gr.patch.v0");
  if (patchFingerprint !== expected || patchId !== `gr-patch-${expected.slice(0, 20)}`) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR patch fingerprint or ID does not match its content.",
    );
  }
  return normalized;
}
