import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGrCampaignPlan,
  freezeGrCampaignPlan,
  type GrCampaignCommitSpecV0,
  type GrCampaignPlanV0,
} from "./campaign";
import {
  verifyGrCampaignReviewTreeProof,
  type GrCampaignReviewTreeProof,
} from "./campaign-review-source";
import { assertGrEffects } from "./effects";
import { GrError } from "./error";
import { runGrGit, runRequiredGrGit } from "./git";
import type { GrEffectKind } from "./model";

const deny = (reason: string) =>
  new GrError("GR_NOT_AUTHORIZED", `GR_PUBLICATION_PREPARATION_${reason}`);
const hash = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
export const GR_PUBLICATION_BASE_BUNDLE = ".git/gr-publication-base.bundle";
export const GR_PUBLICATION_SOURCE_MANIFEST = ".git/gr-publication-source.json";
export const GR_PUBLICATION_SOURCE_PROOF = ".git/gr-publication-proof.json";
type Inventory = {
  schema: string;
  campaignFingerprint: string;
  candidateTree: string;
  scope: string[];
  files: { path: string; gitBlob: string; sha256: string; bytes: number; executable: boolean }[];
};
const limit = 64 * 1024 ** 2;

/** Campaign-owned data, admitted with the host policy; never selected by argv. */
export interface GrPublicationCampaign {
  readonly id: string;
  readonly paths: readonly string[];
  readonly commits: readonly GrCampaignCommitSpecV0[];
  readonly publication?: GrCampaignPlanV0["policy"]["publication"];
}
export function assertGrPublicationCampaign(campaign: GrPublicationCampaign) {
  const validPath = (p: string) =>
    typeof p === "string" &&
    !!p &&
    !p.startsWith("/") &&
    !/[\\\\\r\n\0]/.test(p) &&
    p
      .split("/")
      .every(
        (part) => !!part && part !== "." && part !== ".." && part !== ".git" && part !== ".private",
      );
  if (
    !campaign ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(campaign.id) ||
    !Array.isArray(campaign.paths) ||
    campaign.paths.length === 0 ||
    campaign.paths.length > 128 ||
    campaign.paths.some((p) => !validPath(p)) ||
    new Set(campaign.paths).size !== campaign.paths.length ||
    campaign.paths.join("\0") !==
      [...campaign.paths].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)).join("\0") ||
    !Array.isArray(campaign.commits) ||
    campaign.commits.length === 0 ||
    campaign.commits.length > 32 ||
    new Set(campaign.commits.map((c) => c.id)).size !== campaign.commits.length ||
    campaign.commits.some(
      (c) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(c.id) ||
        typeof c.title !== "string" ||
        !c.title.trim() ||
        c.title !== c.title.trim() ||
        /[\r\n\0]/.test(c.title) ||
        !Array.isArray(c.paths) ||
        c.paths.length === 0 ||
        new Set(c.paths).size !== c.paths.length ||
        c.paths.join("\0") !==
          [...c.paths].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)).join("\0") ||
        c.paths.some(
          (p: string) =>
            !validPath(p) ||
            !campaign.paths.some((scope) => p === scope || p.startsWith(scope + "/")),
        ),
    ) ||
    (campaign.publication !== undefined &&
      (campaign.publication.mode !== "source-only" ||
        campaign.publication.installability !== "not-claimed" ||
        typeof campaign.publication.exceptionRef !== "string" ||
        !campaign.publication.exceptionRef.trim()))
  )
    throw deny("CAMPAIGN_SPEC_INVALID");
}

/** Exact already-completed first step, not permission to create or replay a commit. */
export interface GrCampaignRetainedPrefix {
  readonly commitId: string;
  readonly commit: string;
  readonly tree: string;
  readonly title: string;
  readonly contentBase64: string;
}
function assertRetainedPrefix(prefix: GrCampaignRetainedPrefix) {
  if (
    !prefix.commitId ||
    !prefix.title ||
    /[\r\n\0]/.test(prefix.title) ||
    ![prefix.commit, prefix.tree].every((oid) => /^[a-f0-9]{40}$/.test(oid))
  )
    throw deny("RETAINED_PREFIX_INVALID");
  const bytes = Buffer.from(prefix.contentBase64, "base64");
  if (
    bytes.length > 65536 ||
    bytes.toString("base64") !== prefix.contentBase64 ||
    !Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes) ||
    createHash("sha1").update(`commit ${bytes.length}\0`).update(bytes).digest("hex") !==
      prefix.commit
  )
    throw deny("RETAINED_COMMIT_BYTES");
}

/** Read-only content export. The caller owns acceptance of the completed receipt;
 * this reads no credentials and grants no commit or publication authority. */
export async function readGrCampaignRetainedPrefix(input: {
  readonly root: string;
  readonly baseCommit: string;
  readonly expectedHead: string;
  readonly prefix: Omit<GrCampaignRetainedPrefix, "contentBase64">;
  readonly grantedEffects: readonly GrEffectKind[];
}): Promise<GrCampaignRetainedPrefix> {
  assertGrEffects(["filesystem.read", "git.read"], input.grantedEffects);
  if (
    ![input.baseCommit, input.expectedHead, input.prefix.commit].every((oid) =>
      /^[a-f0-9]{40}$/.test(oid),
    )
  )
    throw deny("RETAINED_PREFIX_INVALID");
  const check = async () => {
    if (
      (await runRequiredGrGit(input.root, ["rev-parse", "HEAD"])).trim() !== input.expectedHead ||
      (await runRequiredGrGit(input.root, ["symbolic-ref", "-q", "HEAD"])).trim() !==
        "refs/heads/main"
    )
      throw deny("RETAINED_SOURCE_HEAD_CHANGED");
  };
  await check();
  const size = Number(
    (
      await runRequiredGrGit(input.root, [
        "--no-replace-objects",
        "cat-file",
        "-s",
        input.prefix.commit,
      ])
    ).trim(),
  );
  if (!Number.isSafeInteger(size) || size < 1 || size > 65536)
    throw deny("RETAINED_PREFIX_INVALID");
  const content = await runRequiredGrGit(input.root, [
    "--no-replace-objects",
    "cat-file",
    "commit",
    input.prefix.commit,
  ]);
  const result = { ...input.prefix, contentBase64: Buffer.from(content).toString("base64") };
  assertRetainedPrefix(result);
  const record = (
    await runRequiredGrGit(input.root, [
      "--no-replace-objects",
      "show",
      "-s",
      "--format=%P%n%T%n%B",
      result.commit,
    ])
  ).trimEnd();
  if (record !== `${input.baseCommit}\n${result.tree}\n${result.title}`)
    throw deny("RETAINED_PREFIX_CHANGED");
  await check();
  return result;
}

/** Only the accepted public base's reachable history, never --all, private refs,
 * current candidate/worktree or repository-local configuration. No live ref/index
 * changes. The receiving protected repository gets its own identity/plan. */
export async function exportGrCampaignPublicBase(input: {
  readonly root: string;
  readonly baseCommit: string;
  readonly baseTree: string;
  readonly grantedEffects: readonly GrEffectKind[];
}) {
  assertGrEffects(["filesystem.read", "filesystem.write", "git.read"], input.grantedEffects);
  const verify = async () => {
    if (
      !/^[a-f0-9]{40}$/.test(input.baseCommit) ||
      !/^[a-f0-9]{40}$/.test(input.baseTree) ||
      (await runRequiredGrGit(input.root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim() !==
        input.baseCommit ||
      (await runRequiredGrGit(input.root, ["rev-parse", "--verify", "HEAD^{tree}"])).trim() !==
        input.baseTree ||
      (await runRequiredGrGit(input.root, ["symbolic-ref", "-q", "HEAD"])).trim() !==
        "refs/heads/main"
    )
      throw deny("BASE_CHANGED");
  };
  await verify();
  const estimate = Number(
    (
      await runRequiredGrGit(input.root, [
        "rev-list",
        "--disk-usage",
        "--objects",
        input.baseCommit,
      ])
    ).trim(),
  );
  if (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > limit)
    throw deny("BASE_SIZE_BOUND");
  const space = await statfs(tmpdir());
  if (space.bavail * space.bsize < 256 * 1024 ** 2) throw deny("SPACE_BOUND");
  const dir = await mkdtemp(path.join(tmpdir(), "gr-public-base-"));
  try {
    const file = path.join(dir, "base.bundle");
    await runRequiredGrGit(input.root, ["bundle", "create", file, "HEAD"], {
      signal: AbortSignal.timeout(30000),
    });
    const s = await lstat(file);
    if (!s.isFile() || s.isSymbolicLink() || s.size > limit) throw deny("BASE_SIZE_BOUND");
    const bytes = await readFile(file);
    await verify();
    return {
      schema: "gr.campaign-public-base.v0" as const,
      baseCommit: input.baseCommit,
      baseTree: input.baseTree,

      digest: hash(bytes),
      bytes: bytes.length,
      contentBase64: bytes.toString("base64"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Preparation only: import accepted base history, create the private baseline ref
 * (not a release commit), then invoke existing plan/freeze/source/tree-proof owners.
 * No network, commit, push, Gate mutation, signing or Cap grant. A failed or complete
 * preparation cannot resume automatically. Native startup owns custody/Auth. */
export async function prepareGrCampaignPublicationSource(input: {
  readonly root: string;
  readonly campaignId: string;
  readonly baseCommit: string;
  readonly baseTree: string;
  readonly baseBundleDigest: string;
  readonly sourceManifestDigest: string;
  readonly sourceTreeProofDigest: string;
  readonly expectedCandidateTree: string;
  readonly paths: readonly string[];
  readonly commits: readonly GrCampaignCommitSpecV0[];
  readonly publication?: GrCampaignPlanV0["policy"]["publication"];
  readonly retainedPrefix?: GrCampaignRetainedPrefix;
  readonly grantedEffects: readonly GrEffectKind[];
}) {
  assertGrEffects(
    ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    input.grantedEffects,
  );
  if (
    ![input.baseCommit, input.baseTree, input.expectedCandidateTree].every((s) =>
      /^[a-f0-9]{40}$/.test(s),
    ) ||
    ![input.baseBundleDigest, input.sourceManifestDigest, input.sourceTreeProofDigest].every((d) =>
      /^sha256:[a-f0-9]{64}$/.test(d),
    )
  )
    throw deny("BINDING_INVALID");
  if (input.retainedPrefix) assertRetainedPrefix(input.retainedPrefix);
  const claim = path.join(input.root, ".git/gr-publication-preparation");
  await mkdir(claim, { mode: 0o700 });
  const record = async (name: string, value: unknown) => {
    const f = await open(path.join(claim, name + ".json"), "wx", 0o600);
    try {
      await f.writeFile(JSON.stringify(value) + "\n");
      await f.sync();
    } finally {
      await f.close();
    }
    const d = await open(claim, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  };
  // Persist the claim before any Git effect. All failures retain it.
  const parent = await open(path.dirname(claim), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
  await record("reservation", {
    operation: "gr.campaign.publication.prepare",
    outcome: "outcome-unknown",
    baseCommit: input.baseCommit,
    expectedCandidateTree: input.expectedCandidateTree,
  });
  const readPinned = async (relative: string, digest: string) => {
    const f = await open(
      path.join(input.root, relative),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const s = await f.stat();
      if (!s.isFile() || s.nlink !== 1 || s.size > 2 * 1024 ** 2 || s.mode & 0o022)
        throw deny("SOURCE_METADATA");
      const b = await f.readFile(),
        a = await f.stat();
      if (hash(b) !== digest || b.length !== s.size || s.ctimeMs !== a.ctimeMs)
        throw deny("SOURCE_CHANGED");
      return JSON.parse(b.toString("utf8"));
    } finally {
      await f.close();
    }
  };
  const inventory = (await readPinned(
    GR_PUBLICATION_SOURCE_MANIFEST,
    input.sourceManifestDigest,
  )) as Inventory;
  const treeProof = (await readPinned(
    GR_PUBLICATION_SOURCE_PROOF,
    input.sourceTreeProofDigest,
  )) as GrCampaignReviewTreeProof;
  if (
    inventory.schema !== "rvs.campaign-review-corpus.v0" ||
    inventory.candidateTree !== input.expectedCandidateTree ||
    JSON.stringify(inventory.scope) !== JSON.stringify(input.paths)
  )
    throw deny("SOURCE_SCOPE");
  verifyGrCampaignReviewTreeProof(treeProof, inventory);
  const verifyFiles = async () => {
    let total = 0;
    for (const entry of inventory.files) {
      if (
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0 ||
        entry.bytes > 2 * 1024 ** 2 ||
        !/^sha256:[a-f0-9]{64}$/.test(entry.sha256) ||
        (total += entry.bytes) > 16 * 1024 ** 2
      )
        throw deny("SOURCE_SIZE");
      const f = await open(
        path.join(input.root, entry.path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const s = await f.stat();
        if (
          !s.isFile() ||
          s.nlink !== 1 ||
          s.size !== entry.bytes ||
          s.mode & 0o022 ||
          Boolean(s.mode & 0o111) !== entry.executable
        )
          throw deny("SOURCE_METADATA");
        const b = await f.readFile(),
          a = await f.stat();
        if (
          b.length !== entry.bytes ||
          s.ctimeMs !== a.ctimeMs ||
          hash(b) !== entry.sha256 ||
          createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex") !== entry.gitBlob
        )
          throw deny("SOURCE_CHANGED");
      } finally {
        await f.close();
      }
    }
  };
  await verifyFiles();
  const file = path.join(input.root, GR_PUBLICATION_BASE_BUNDLE);
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await fd.stat();
    if (!s.isFile() || s.nlink !== 1 || s.size > limit || s.mode & 0o022)
      throw deny("BUNDLE_METADATA");
    const bytes = await fd.readFile(),
      a = await fd.stat(),
      n = await lstat(file);
    if (
      bytes.length !== s.size ||
      hash(bytes) !== input.baseBundleDigest ||
      s.ctimeMs !== a.ctimeMs ||
      s.dev !== n.dev ||
      s.ino !== n.ino ||
      s.ctimeMs !== n.ctimeMs
    )
      throw deny("BUNDLE_CHANGED");
  } finally {
    await fd.close();
  }
  if (
    (await runRequiredGrGit(input.root, ["symbolic-ref", "-q", "HEAD"])).trim() !==
      "refs/heads/main" ||
    (await runGrGit(input.root, ["rev-parse", "--verify", "HEAD"])).exitCode === 0
  )
    throw deny("TARGET_NOT_UNBORN");
  const heads = (await runRequiredGrGit(input.root, ["bundle", "list-heads", file])).trim();
  const prefix = input.retainedPrefix;
  if (heads !== `${input.baseCommit} HEAD`) throw deny("BUNDLE_REFS");
  await runRequiredGrGit(input.root, ["bundle", "verify", file]);
  await runRequiredGrGit(input.root, ["bundle", "unbundle", file]);
  if (
    (
      await runRequiredGrGit(input.root, ["rev-parse", "--verify", `${input.baseCommit}^{tree}`])
    ).trim() !== input.baseTree
  )
    throw deny("BASE_TREE_CHANGED");
  await runRequiredGrGit(input.root, [
    "update-ref",
    "refs/heads/main",
    input.baseCommit,
    "0".repeat(40),
  ]);
  // Preserve base entries outside scope without checking them out or importing
  // producer HOME/config. Existing GR scoped snapshots retain those index entries.
  await runRequiredGrGit(input.root, ["read-tree", input.baseCommit]);
  const plan = await freezeGrCampaignPlan({
    root: input.root,
    plan: await createGrCampaignPlan({
      root: input.root,
      campaignId: input.campaignId,
      ...(input.publication ? { publication: input.publication } : {}),
      baseRevision: input.baseCommit,
      paths: input.paths,
      commits: input.commits,
      grantedEffects: input.grantedEffects,
    }),
    grantedEffects: input.grantedEffects,
  });
  if (plan.frozen?.candidateTree.oid !== input.expectedCandidateTree)
    throw deny("CANDIDATE_CHANGED");
  let retainedPrefix: GrCampaignRetainedPrefix | undefined;
  if (prefix) {
    const step = plan.frozen?.steps[0];
    const spec = plan.scope.commits[0];
    const imported = (
      await runRequiredGrGit(input.root, ["hash-object", "-t", "commit", "-w", "--stdin"], {
        input: Buffer.from(prefix.contentBase64, "base64").toString("utf8"),
      })
    ).trim();
    if (imported !== prefix.commit) throw deny("RETAINED_COMMIT_BYTES");
    const record = (
      await runRequiredGrGit(input.root, [
        "--no-replace-objects",
        "show",
        "-s",
        "--format=%P%n%T%n%B",
        prefix.commit,
      ])
    ).trimEnd();
    if (
      !step ||
      !spec ||
      step.commitId !== prefix.commitId ||
      spec.id !== prefix.commitId ||
      step.beforeTree !== input.baseTree ||
      step.afterTree !== prefix.tree ||
      spec.title !== prefix.title ||
      record !== `${input.baseCommit}\n${prefix.tree}\n${prefix.title}`
    )
      throw deny("RETAINED_PREFIX_CHANGED");
    await runRequiredGrGit(input.root, [
      "update-ref",
      "refs/heads/main",
      prefix.commit,
      input.baseCommit,
    ]);
    await runRequiredGrGit(input.root, ["read-tree", prefix.commit]);
    retainedPrefix = prefix;
  }
  await verifyFiles();
  // Content evidence is reusable for the SAME tree. Recompute only the repository-
  // bound plan identity; no old review/approval is transferred to the new plan.
  // Avoid hundreds of redundant protected Git subprocesses to re-export known
  // blobs: bytes are checked locally and existing pure tree verification is used.
  const manifest = { ...inventory, campaignFingerprint: plan.campaignFingerprint };
  verifyGrCampaignReviewTreeProof(treeProof, manifest);
  const result = {
    schema: "gr.campaign-publication-preparation.v0" as const,
    plan,
    manifest,
    treeProof,
    ...(retainedPrefix ? { retainedPrefix } : {}),
    commitPerformed: false,
    pushPerformed: false,
    authorityGranted: false,
    outcome: "completed" as const,
  };
  await record("completed", result);
  return result;
}
