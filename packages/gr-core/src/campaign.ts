import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runGrGit, runRequiredGrGit } from "./git";
import { withGrSnapshotIndexes } from "./git-index";
import { GR_GIT_AUTHORITY_ENV, GR_GIT_AUTHORITY_VALUE } from "./hooks";
import { inspectGrWorkspace } from "./inspect";
import { fingerprintGrJson, normalizeGrJson } from "./json";
import type { GrEffectKind, GrGitObjectReference, GrWorkspaceEntry } from "./model";
import { assertGrArtifactId, assertGrRelativePath } from "./paths";
import { isGrHardPrivatePath } from "./public-surface";
import { createGrSnapshot } from "./snapshot";

export const GR_CAMPAIGN_PLAN_SCHEMA_VERSION = "gr.campaign-plan.v0" as const;
export const GR_CAMPAIGN_REMOTE_BASE_SCHEMA_VERSION = "gr.campaign-remote-base.v0" as const;
export const GR_CAMPAIGN_COMMIT_RECEIPT_SCHEMA_VERSION = "gr.campaign-commit-receipt.v0" as const;
export const GR_CAMPAIGN_PUSH_RECEIPT_SCHEMA_VERSION = "gr.campaign-push-receipt.v0" as const;

export type GrCampaignCleanliness =
  | "campaign-clean"
  | "campaign-dirty"
  | "workspace-dirty-outside-campaign";

export type GrCampaignCommitSpecV0 = {
  readonly id: string;
  readonly title: string;
  readonly paths: readonly string[];
  readonly rationale?: string | undefined;
};

export type GrCampaignPlanV0 = {
  readonly schemaVersion: typeof GR_CAMPAIGN_PLAN_SCHEMA_VERSION;
  readonly operation: "gr.campaign.plan";
  readonly campaignId: string;
  readonly repository: {
    readonly root: string;
    readonly fingerprint: string;
  };
  readonly base: {
    readonly revision: string;
    readonly commit: GrGitObjectReference;
    readonly tree: GrGitObjectReference;
  };
  readonly scope: {
    readonly paths: readonly string[];
    readonly commits: readonly GrCampaignCommitSpecV0[];
  };
  readonly baselineInputs?: readonly {
    readonly path: string;
    readonly blob: GrGitObjectReference | null;
  }[];
  readonly workspace: {
    readonly cleanliness: GrCampaignCleanliness;
    readonly inScope: readonly GrWorkspaceEntry[];
    readonly outsideScope: readonly GrWorkspaceEntry[];
    readonly conflictedInScope: number;
  };
  readonly policy: {
    readonly privatePaths: "forbidden";
    readonly workspaceOutsideCampaign: "allowed";
    readonly remoteBaseDrift: "fail-closed";
    readonly commitDiffBudget: "advisory";
    readonly publication?: {
      readonly mode: "source-only";
      readonly exceptionRef: string;
      readonly installability: "not-claimed";
    };
  };
  readonly frozen?: {
    readonly headRef: string | null;
    readonly candidateTree: GrGitObjectReference;
    readonly steps: readonly {
      readonly commitId: string;
      readonly beforeTree: string;
      readonly afterTree: string;
    }[];
  };
  readonly campaignFingerprint: string;
};

export type GrCampaignRemoteBaseV0 = {
  readonly schemaVersion: typeof GR_CAMPAIGN_REMOTE_BASE_SCHEMA_VERSION;
  readonly operation: "gr.campaign.remote-base.verify";
  readonly campaignId: string;
  readonly remote: string;
  readonly ref: string;
  readonly expectedCommit: string;
  readonly observedCommit: string;
  readonly status: "matched";
};

function normalizeCampaignId(value: string): string {
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,95}$/u.test(id)) {
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR campaign IDs must be 3-96 lowercase ASCII letters, digits, dots, dashes, or underscores.",
      { campaignId: value },
    );
  }
  return id;
}

function normalizeScopePath(value: string): string {
  const path = assertGrRelativePath(value);
  if (isGrHardPrivatePath(path)) {
    throw new GrError("GR_PRIVATE_PATH_FORBIDDEN", `GR campaign scope cannot include ${path}.`, {
      path,
    });
  }
  return path;
}

function pathCovered(path: string, scope: readonly string[]): boolean {
  return scope.some((candidate) => path === candidate || path.startsWith(`${candidate}/`));
}

async function object(
  root: string,
  revision: string,
  kind: "commit" | "tree",
  effects: readonly "git.read"[],
): Promise<GrGitObjectReference> {
  const oid = (
    await runRequiredGrGit(
      root,
      ["rev-parse", "--verify", `${revision}${kind === "tree" ? "^{tree}" : "^{commit}"}`],
      {},
    )
  ).trim();
  const format = (await runRequiredGrGit(root, ["rev-parse", "--show-object-format"])).trim();
  if (format !== "sha1" && format !== "sha256")
    throw new GrError("GR_GIT_FAILED", `Unsupported Git object format: ${format}`);
  void effects;
  return Object.freeze({ algorithm: format, kind, oid });
}

const rootMetadataPaths = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

/** Publication metadata is an exact baseline input, not implicit ownership of dirty files. */
async function rootManifestInputs(
  root: string,
  base: string,
  explicitPaths: readonly string[],
  algorithm: GrGitObjectReference["algorithm"],
) {
  const inputs: { path: string; blob: GrGitObjectReference | null }[] = [];
  for (const name of rootMetadataPaths) {
    let blob: GrGitObjectReference | null = null;
    try {
      const file = await open(
        path.join(root, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await file.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > 2 * 1024 ** 2)
          throw new GrError(
            "GR_INVALID_ARTIFACT",
            `Campaign baseline input ${name} must be a bounded regular file.`,
          );
        const bytes = await file.readFile(),
          after = await file.stat(),
          named = await lstat(path.join(root, name));
        if (
          bytes.length !== before.size ||
          before.ctimeMs !== after.ctimeMs ||
          before.dev !== named.dev ||
          before.ino !== named.ino ||
          before.ctimeMs !== named.ctimeMs
        )
          throw new GrError(
            "GR_STALE_STATE",
            `Campaign baseline input ${name} changed while reading.`,
          );
        if (name === "package.json") {
          const manifest = JSON.parse(bytes.toString("utf8"));
          if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
            throw new GrError("GR_INVALID_ARTIFACT", "Root package.json must be a JSON object.");
        }
        blob = {
          algorithm,
          kind: "blob",
          oid: createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
        };
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const old = await runGrGit(root, ["rev-parse", "--verify", `${base}:${name}`]);
    const oldOid = old.exitCode === 0 ? old.stdout.trim() : null;
    if (name === "package.json" && !blob) {
      if (oldOid)
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          "Campaign cannot omit an existing root package.json.",
        );
      return [];
    }
    if (!blob && !oldOid) continue;
    if (blob?.oid !== oldOid && !pathCovered(name, explicitPaths))
      throw new GrError(
        "GR_NOT_AUTHORIZED",
        `Changed root baseline input ${name} requires explicit Campaign scope and review; other WorkTurn changes cannot be imported implicitly.`,
      );
    inputs.push({ path: name, blob });
  }
  return inputs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function createGrCampaignPlan(options: {
  readonly root: string;
  readonly campaignId: string;
  readonly baseRevision: string;
  readonly paths: readonly string[];
  readonly commits?: readonly GrCampaignCommitSpecV0[] | undefined;
  readonly publication?: GrCampaignPlanV0["policy"]["publication"] | undefined;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
}): Promise<GrCampaignPlanV0> {
  assertGrEffects(["filesystem.read", "git.read"], options.grantedEffects);
  const campaignId = normalizeCampaignId(options.campaignId);
  let paths = [...new Set(options.paths.map(normalizeScopePath))].sort();
  if (paths.length === 0)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "GR campaign scope must contain at least one public path.",
    );
  const commits = (options.commits ?? []).map((commit) => {
    assertGrArtifactId(commit.id.trim());
    if (!commit.id.trim() || !commit.title.trim())
      throw new GrError("GR_INVALID_ARTIFACT", "GR campaign commit specs require id and title.");
    const commitPaths = [...new Set(commit.paths.map(normalizeScopePath))].sort();
    if (commitPaths.length === 0)
      throw new GrError("GR_INVALID_ARTIFACT", "Campaign commit scope cannot be empty.");
    for (const path of commitPaths) {
      if (!pathCovered(path, paths))
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          `Campaign commit path ${path} is outside campaign scope.`,
        );
    }
    return Object.freeze({
      ...commit,
      id: commit.id.trim(),
      title: commit.title.trim(),
      paths: commitPaths,
    });
  });
  const inspection = await inspectGrWorkspace(options.root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const [baseCommit, baseTree] = await Promise.all([
    object(options.root, options.baseRevision, "commit", ["git.read"]),
    object(options.root, options.baseRevision, "tree", ["git.read"]),
  ]);
  const baselineInputs = await rootManifestInputs(
    options.root,
    baseCommit.oid,
    paths,
    inspection.repository.objectFormat,
  );
  paths = [...new Set([...paths, ...baselineInputs.map((input) => input.path)])].sort();
  const inScope = inspection.entries.filter((entry) => pathCovered(entry.path, paths));
  const outsideScope = inspection.entries.filter((entry) => !pathCovered(entry.path, paths));
  const conflictedInScope = inScope.filter((entry) => entry.kind === "conflicted").length;
  if (conflictedInScope > 0) {
    throw new GrError(
      "GR_CAMPAIGN_CONFLICTED",
      "GR campaign scope contains unresolved Git conflicts.",
      { conflictedInScope },
    );
  }
  const cleanliness: GrCampaignCleanliness =
    inScope.length > 0
      ? "campaign-dirty"
      : outsideScope.length > 0
        ? "workspace-dirty-outside-campaign"
        : "campaign-clean";
  const semantic = {
    schemaVersion: GR_CAMPAIGN_PLAN_SCHEMA_VERSION,
    operation: "gr.campaign.plan" as const,
    campaignId,
    repository: {
      root: inspection.repository.root,
      fingerprint: inspection.repository.fingerprint,
    },
    base: { revision: options.baseRevision, commit: baseCommit, tree: baseTree },
    scope: { paths, commits },
    ...(baselineInputs.length ? { baselineInputs } : {}),
    workspace: { cleanliness, inScope, outsideScope, conflictedInScope },
    policy: {
      privatePaths: "forbidden" as const,
      workspaceOutsideCampaign: "allowed" as const,
      remoteBaseDrift: "fail-closed" as const,
      commitDiffBudget: "advisory" as const,
      ...(options.publication ? { publication: options.publication } : {}),
    },
  };
  const campaignFingerprint = fingerprintGrJson(semantic, "gr.campaign-plan.v0");
  return normalizeGrJson({ ...semantic, campaignFingerprint }) as unknown as GrCampaignPlanV0;
}

/** Freeze selected source bytes and ordered trees through an alternate index, never the live index. */
export async function freezeGrCampaignPlan(options: {
  root: string;
  plan: GrCampaignPlanV0;
  grantedEffects?: readonly GrEffectKind[];
}): Promise<GrCampaignPlanV0> {
  assertGrEffects(["filesystem.read", "git.read", "git.write"], options.grantedEffects);
  assertCampaignPlan(options.root, options.plan);
  const baselineInputs = await rootManifestInputs(
    options.root,
    options.plan.base.commit.oid,
    options.plan.scope.paths,
    options.plan.base.tree.algorithm,
  );
  if (fingerprintGrJson(baselineInputs) !== fingerprintGrJson(options.plan.baselineInputs ?? []))
    throw new GrError(
      "GR_STALE_STATE",
      "Root manifest/lockfile changed after planning; explicit replan/review is required before freeze.",
    );
  const snapshot = await createGrSnapshot({
    root: options.root,
    role: "explicit",
    dirtyPolicy: "capture",
    scope: { kind: "paths", paths: options.plan.scope.paths },
    grantedEffects: options.grantedEffects,
  });
  if (snapshot.head.commit?.oid !== options.plan.base.commit.oid)
    throw new GrError("GR_STALE_STATE", "Campaign freeze requires HEAD at the planned base.");
  for (const input of baselineInputs) {
    const actual = await runGrGit(options.root, [
      "rev-parse",
      "--verify",
      `${snapshot.worktreeTree.oid}:${input.path}`,
    ]);
    if ((actual.exitCode === 0 ? actual.stdout.trim() : null) !== (input.blob?.oid ?? null))
      throw new GrError(
        "GR_STALE_STATE",
        "Frozen root manifest/lockfile differs from its reviewed baseline bytes.",
      );
  }
  return withGrSnapshotIndexes(options.root, async (directory) => {
    const env = { GIT_INDEX_FILE: path.join(directory, "index-state") };
    await runRequiredGrGit(options.root, ["read-tree", options.plan.base.tree.oid], { env });
    let beforeTree = options.plan.base.tree.oid;
    const steps: { commitId: string; beforeTree: string; afterTree: string }[] = [];
    const ids = new Set<string>();
    const assigned = new Set<string>();
    for (const spec of options.plan.scope.commits) {
      if (ids.has(spec.id))
        throw new GrError("GR_INVALID_ARTIFACT", "Duplicate campaign commit ID.");
      ids.add(spec.id);
      const files = (
        await runRequiredGrGit(options.root, [
          "diff",
          "--name-only",
          "--no-renames",
          "-z",
          options.plan.base.tree.oid,
          snapshot.worktreeTree.oid,
          "--",
          ...spec.paths,
        ])
      )
        .split("\0")
        .filter(Boolean);
      if (!files.length || files.some((file) => assigned.has(file)))
        throw new GrError(
          "GR_INVALID_ARTIFACT",
          "Frozen commit assignments must be nonempty and disjoint.",
        );
      files.forEach((file) => assigned.add(file));
      const patch = await runRequiredGrGit(options.root, [
        "diff",
        "--binary",
        "--full-index",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        options.plan.base.tree.oid,
        snapshot.worktreeTree.oid,
        "--",
        ...spec.paths,
      ]);
      await runRequiredGrGit(
        options.root,
        ["apply", "--cached", "--binary", "--whitespace=nowarn", "-"],
        { env, input: patch },
      );
      const afterTree = (await runRequiredGrGit(options.root, ["write-tree"], { env })).trim();
      steps.push({ commitId: spec.id, beforeTree, afterTree });
      beforeTree = afterTree;
    }
    if (beforeTree !== snapshot.worktreeTree.oid)
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        "Frozen commit assignments do not cover the candidate tree.",
        { actualTree: beforeTree, expectedTree: snapshot.worktreeTree.oid },
      );
    const { campaignFingerprint: _, ...semantic } = options.plan;
    const frozen = {
      ...semantic,
      frozen: { headRef: snapshot.head.ref ?? null, candidateTree: snapshot.worktreeTree, steps },
    };
    return normalizeGrJson({
      ...frozen,
      campaignFingerprint: fingerprintGrJson(frozen, "gr.campaign-plan.v0"),
    }) as unknown as GrCampaignPlanV0;
  });
}

async function assertCampaignRootBaseline(root: string, plan: GrCampaignPlanV0) {
  const oid = async (tree: string, name: string) => {
    const result = await runGrGit(root, ["rev-parse", "--verify", `${tree}:${name}`]);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  };
  const tree = plan.frozen?.candidateTree.oid ?? plan.base.tree.oid;
  const manifest = await oid(tree, "package.json");
  const baseManifest = manifest ?? (await oid(plan.base.tree.oid, "package.json"));
  if (!baseManifest) return;
  if (
    !plan.frozen ||
    !manifest ||
    plan.baselineInputs?.find((input) => input.path === "package.json")?.blob?.oid !== manifest
  )
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Root manifest publication requires a current frozen baseline; legacy plans must be replanned, not relabelled.",
    );
  for (const input of plan.baselineInputs ?? []) {
    if ((await oid(tree, input.path)) !== (input.blob?.oid ?? null))
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        "Frozen publication baseline metadata does not match its tree.",
      );
  }
}

function assertCampaignPlan(root: string, plan: GrCampaignPlanV0) {
  const { campaignFingerprint, ...semantic } = plan;
  if (
    root !== plan.repository.root ||
    fingerprintGrJson(semantic, "gr.campaign-plan.v0") !== campaignFingerprint
  )
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Campaign repository or plan fingerprint does not match.",
    );
}

export function verifyGrCampaignRemoteBase(options: {
  readonly campaignId: string;
  readonly expectedCommit: string;
  readonly observedCommit: string;
  readonly remote: string;
  readonly ref: string;
}): GrCampaignRemoteBaseV0 {
  if (options.expectedCommit !== options.observedCommit) {
    throw new GrError(
      "GR_REMOTE_BASE_DRIFT",
      `Remote ${options.remote}/${options.ref} moved since the campaign was planned.`,
      {
        expectedCommit: options.expectedCommit,
        observedCommit: options.observedCommit,
      },
    );
  }
  return Object.freeze({
    schemaVersion: GR_CAMPAIGN_REMOTE_BASE_SCHEMA_VERSION,
    operation: "gr.campaign.remote-base.verify",
    campaignId: normalizeCampaignId(options.campaignId),
    remote: options.remote,
    ref: options.ref,
    expectedCommit: options.expectedCommit,
    observedCommit: options.observedCommit,
    status: "matched",
  });
}

const grAuthorityEnv = (): NodeJS.ProcessEnv => ({
  [GR_GIT_AUTHORITY_ENV]: GR_GIT_AUTHORITY_VALUE,
});

export async function commitGrCampaignStep(options: {
  readonly root: string;
  readonly plan: GrCampaignPlanV0;
  readonly commitId: string;
  /** Exact parent from the previous step receipt; mandatory after the first frozen step. */
  readonly expectedBeforeCommit?: string | undefined;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
}): Promise<{
  readonly schemaVersion: typeof GR_CAMPAIGN_COMMIT_RECEIPT_SCHEMA_VERSION;
  readonly operation: "gr.campaign.commit";
  readonly campaignId: string;
  readonly commitId: string;
  readonly title: string;
  readonly beforeCommit: string;
  readonly afterCommit: string;
  readonly stagedPaths: readonly string[];
}> {
  assertGrEffects(["filesystem.read", "git.read", "git.write"], options.grantedEffects);
  assertCampaignPlan(options.root, options.plan);
  await assertCampaignRootBaseline(options.root, options.plan);
  const frozenStep = options.plan.frozen?.steps.find((step) => step.commitId === options.commitId);
  const spec = options.plan.scope.commits.find((entry) => entry.id === options.commitId);
  if (!spec)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      `Campaign commit ${options.commitId} is not declared by the plan.`,
    );
  const beforeCommit = (await runRequiredGrGit(options.root, ["rev-parse", "HEAD"])).trim();
  if (options.plan.frozen) {
    const headRef = (
      await runRequiredGrGit(options.root, ["rev-parse", "--symbolic-full-name", "HEAD"])
    ).trim();
    if ((headRef === "HEAD" ? null : headRef) !== options.plan.frozen.headRef)
      throw new GrError(
        "GR_STALE_STATE",
        "Frozen campaign local branch changed; commit was not attempted.",
      );
    const beforeTree = (await runRequiredGrGit(options.root, ["rev-parse", "HEAD^{tree}"])).trim();
    if (!frozenStep || beforeTree !== frozenStep.beforeTree)
      throw new GrError("GR_STALE_STATE", "Frozen campaign HEAD tree or commit order changed.");
    const firstStep = options.commitId === options.plan.frozen.steps[0]?.commitId;
    const expectedParent = firstStep ? options.plan.base.commit.oid : options.expectedBeforeCommit;
    if (!expectedParent || beforeCommit !== expectedParent)
      throw new GrError(
        "GR_STALE_STATE",
        "Frozen campaign exact parent HEAD changed or receipt pin is missing.",
      );
    const snapshot = await createGrSnapshot({
      root: options.root,
      role: "explicit",
      dirtyPolicy: "capture",
      scope: { kind: "paths", paths: options.plan.scope.paths },
      grantedEffects: options.grantedEffects,
    });
    if (snapshot.worktreeTree.oid !== options.plan.frozen.candidateTree.oid)
      throw new GrError(
        "GR_STALE_STATE",
        "Frozen campaign candidate content changed; revalidation is required.",
      );
  }
  const stagedBefore = (
    await runRequiredGrGit(options.root, ["diff", "--cached", "--name-only", "-z"])
  )
    .split("\0")
    .filter(Boolean);
  if (stagedBefore.length > 0)
    throw new GrError(
      "GR_INDEX_CHANGED",
      "GR campaign commit requires an initially clean Git index.",
      { stagedPaths: stagedBefore },
    );
  await runRequiredGrGit(options.root, ["add", "-A", "--", ...spec.paths], {
    env: grAuthorityEnv(),
  });
  const stagedPaths = (
    await runRequiredGrGit(options.root, ["diff", "--cached", "--name-only", "-z"])
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (stagedPaths.length === 0)
    throw new GrError("GR_INVALID_ARTIFACT", `Campaign commit ${spec.id} has no staged changes.`);
  for (const staged of stagedPaths) {
    if (
      isGrHardPrivatePath(staged) ||
      !pathCovered(staged, spec.paths) ||
      !pathCovered(staged, options.plan.scope.paths)
    ) {
      throw new GrError(
        "GR_INVALID_ARTIFACT",
        `Staged path ${staged} is outside the declared campaign commit scope; inspect the retained index.`,
        { staged },
      );
    }
  }
  if (frozenStep) {
    const stagedTree = (await runRequiredGrGit(options.root, ["write-tree"])).trim();
    if (stagedTree !== frozenStep.afterTree)
      throw new GrError(
        "GR_STALE_STATE",
        "Staged content does not match the frozen campaign step; inspect the retained index.",
      );
  }
  if ((await runRequiredGrGit(options.root, ["rev-parse", "HEAD"])).trim() !== beforeCommit)
    throw new GrError(
      "GR_STALE_STATE",
      "Campaign HEAD changed before commit; inspect the retained index.",
    );
  try {
    await runRequiredGrGit(options.root, ["commit", "-m", spec.title, "--"], {
      env: { ...grAuthorityEnv(), GIT_EDITOR: "true" },
    });
  } catch (error) {
    const failure = new GrError(
      "GR_GIT_FAILED",
      "Campaign commit failed; index/history retained for inspection, with no automatic retry authority.",
      { outcome: "uncertain", beforeCommit, commitId: spec.id },
    );
    failure.cause = error;
    throw failure;
  }
  let afterCommit: string;
  try {
    afterCommit = (await runRequiredGrGit(options.root, ["rev-parse", "HEAD"])).trim();
    const observed = await runRequiredGrGit(options.root, [
      "show",
      "--no-patch",
      "--format=%P%n%T%n%B",
      afterCommit,
    ]);
    const [parents, tree, ...message] = observed.split("\n");
    const headRef = (
      await runRequiredGrGit(options.root, ["rev-parse", "--symbolic-full-name", "HEAD"])
    ).trim();
    if (
      (options.plan.frozen &&
        (headRef === "HEAD" ? null : headRef) !== options.plan.frozen.headRef) ||
      parents !== beforeCommit ||
      message.join("\n").trimEnd() !== spec.title ||
      (frozenStep && tree !== frozenStep.afterTree)
    )
      throw new GrError(
        "GR_STALE_STATE",
        "Actual commit parent, tree or message differs from the reviewed campaign step.",
      );
  } catch (error) {
    const failure = new GrError(
      "GR_STALE_STATE",
      "Campaign commit readback is unverified; retain history and reconcile the uncertain outcome without automatic retry.",
      { outcome: "uncertain", beforeCommit, commitId: spec.id },
    );
    failure.cause = error;
    throw failure;
  }
  return Object.freeze({
    schemaVersion: GR_CAMPAIGN_COMMIT_RECEIPT_SCHEMA_VERSION,
    operation: "gr.campaign.commit",
    campaignId: options.plan.campaignId,
    commitId: spec.id,
    title: spec.title,
    beforeCommit,
    afterCommit,
    stagedPaths,
  });
}

export function assertGrCampaignPushCommit(
  expected: string,
  observed: string,
  phase: "before-push" | "after-push",
): void {
  if (!expected || expected !== observed)
    throw new GrError(
      "GR_STALE_STATE",
      phase === "before-push"
        ? "GR campaign HEAD does not match its final commit receipt; push was not attempted."
        : "GR campaign remote result is unverified or changed after push; outcome is uncertain and this check grants no retry authority.",
      {
        expectedCommit: expected,
        observedCommit: observed,
        phase,
        outcome: phase === "before-push" ? "not-attempted" : "uncertain",
      },
    );
}

export async function pushGrCampaign(options: {
  readonly root: string;
  readonly plan: GrCampaignPlanV0;
  readonly remote?: string | undefined;
  readonly ref?: string | undefined;
  /** Final commit-chain receipt pin, checked before any publication effect. */
  readonly expectedHead?: string | undefined;
  readonly expectedRemoteUrl?: string | undefined;
  readonly grantedEffects?: readonly GrEffectKind[] | undefined;
}): Promise<{
  readonly schemaVersion: typeof GR_CAMPAIGN_PUSH_RECEIPT_SCHEMA_VERSION;
  readonly operation: "gr.campaign.push";
  readonly campaignId: string;
  readonly remote: string;
  readonly ref: string;
  readonly expectedRemoteBase: string;
  readonly remoteUrl: string;
  readonly pushedCommit: string;
  readonly status: "pushed";
}> {
  assertGrEffects(["git.read", "git.write", "network.write"], options.grantedEffects);
  assertCampaignPlan(options.root, options.plan);
  await assertCampaignRootBaseline(options.root, options.plan);
  if (options.plan.frozen && !options.expectedHead)
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Frozen campaign push requires the exact final commit receipt HEAD.",
    );
  const remote = options.remote ?? "origin";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote))
    throw new GrError("GR_INVALID_ARTIFACT", "Campaign push requires one named remote.");
  const branch = options.ref ?? "refs/heads/main";
  const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  if (!ref.startsWith("refs/heads/") || ref.includes("*"))
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Campaign push requires one fully qualified branch ref.",
    );
  await runRequiredGrGit(options.root, ["check-ref-format", ref]);
  const urls = (
    await runRequiredGrGit(options.root, ["remote", "get-url", "--push", "--all", remote])
  )
    .trim()
    .split("\n");
  if (
    urls.length !== 1 ||
    !urls[0] ||
    (options.expectedRemoteUrl !== undefined && urls[0] !== options.expectedRemoteUrl)
  )
    throw new GrError(
      "GR_REMOTE_BASE_DRIFT",
      "Campaign remote push URL changed or has multiple destinations; push was not attempted.",
    );
  const remoteUrl = urls[0]!;
  const rawGraph = { GIT_GRAFT_FILE: devNull };
  const graftPath = (
    await runRequiredGrGit(options.root, ["rev-parse", "--git-path", "info/grafts"])
  ).trim();
  try {
    await lstat(path.resolve(options.root, graftPath));
    throw new GrError("GR_UNSUPPORTED_STATE", "Campaign push refuses grafted history.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const observed =
    (await runRequiredGrGit(options.root, ["ls-remote", "--heads", remoteUrl, ref]))
      .trim()
      .split(/\s+/u)[0] ?? "";
  if (!observed)
    throw new GrError(
      "GR_REMOTE_BASE_DRIFT",
      `Unable to resolve ${remote}/${ref} before campaign push.`,
    );
  verifyGrCampaignRemoteBase({
    campaignId: options.plan.campaignId,
    expectedCommit: options.plan.base.commit.oid,
    observedCommit: observed,
    remote,
    ref,
  });
  const pushedCommit = (await runRequiredGrGit(options.root, ["rev-parse", "HEAD"])).trim();
  if (options.expectedHead !== undefined)
    assertGrCampaignPushCommit(options.expectedHead, pushedCommit, "before-push");
  if (options.plan.frozen) {
    const headRef = (
      await runRequiredGrGit(options.root, ["rev-parse", "--symbolic-full-name", "HEAD"])
    ).trim();
    if ((headRef === "HEAD" ? null : headRef) !== options.plan.frozen.headRef)
      throw new GrError(
        "GR_STALE_STATE",
        "Frozen campaign local branch changed; push was not attempted.",
      );
    const tree = (
      await runRequiredGrGit(options.root, [
        "--no-replace-objects",
        "rev-parse",
        `${pushedCommit}^{tree}`,
      ])
    ).trim();
    if (tree !== options.plan.frozen.candidateTree.oid)
      throw new GrError(
        "GR_STALE_STATE",
        "Campaign final tree does not match its frozen candidate.",
      );
  }
  await runRequiredGrGit(
    options.root,
    [
      "--no-replace-objects",
      "merge-base",
      "--is-ancestor",
      options.plan.base.commit.oid,
      pushedCommit,
    ],
    { env: rawGraph },
  );
  // Lease is expected-old CAS only: raw ancestry above forbids history rewrite.
  // Explicit URL/refspec and disabled tag/mirror/submodule fanout constrain the effect to one ref.
  try {
    await runRequiredGrGit(
      options.root,
      [
        "push",
        "--no-mirror",
        "--no-follow-tags",
        "--recurse-submodules=no",
        `--force-with-lease=${ref}:${options.plan.base.commit.oid}`,
        remoteUrl,
        `${pushedCommit}:${ref}`,
      ],
      {
        env: { ...grAuthorityEnv(), ...rawGraph },
      },
    );
  } catch (error) {
    const failure = new GrError(
      "GR_GIT_FAILED",
      "Campaign CAS push failed or is unverified; no automatic retry, rebase or widened force authority.",
      {
        outcome: "uncertain",
        expectedOld: options.plan.base.commit.oid,
        newHead: pushedCommit,
        ref,
      },
    );
    failure.cause = error;
    throw failure;
  }
  let confirmed = "";
  try {
    confirmed =
      (await runRequiredGrGit(options.root, ["ls-remote", "--heads", remoteUrl, ref]))
        .trim()
        .split(/\s+/u)[0] ?? "";
  } catch {
    /* A successful push with failed readback is uncertain, not absent. */
  }
  assertGrCampaignPushCommit(pushedCommit, confirmed, "after-push");
  return Object.freeze({
    schemaVersion: GR_CAMPAIGN_PUSH_RECEIPT_SCHEMA_VERSION,
    operation: "gr.campaign.push",
    campaignId: options.plan.campaignId,
    remote,
    ref,
    expectedRemoteBase: observed,
    remoteUrl,
    pushedCommit,
    status: "pushed",
  });
}
