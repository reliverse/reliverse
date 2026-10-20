import type { BigIntStats } from "node:fs";
import { lstat, readFile, readlink, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  prepareGrCampaignPublicationSource,
  withGrGitRuntime,
  type GrCampaignRetainedPrefix,
  type GrPublicationCampaign,
  assertGrPublicationCampaign,
} from "@reliverse/gr";
import {
  assertGrOwnerNativeCustodySpec,
  assertGrCampaignReviewerSigningPolicy,
  type GrCampaignReviewerSigningPolicy,
  createGrOwnerNativeGitRuntime,
  type GrOwnerNativeCustody,
  type GrOwnerExecutionAuthPin,
} from "@reliverse/gr-action-runtime";
import {
  assertRvsReviewerRootDirectory,
  readRvsReviewerProtectedDocument as document,
} from "@reliverse/rvs-systemd-ubuntu";

import { GR_REVIEW_OWNER_EXECUTABLE, inspectGrNativeUnlockedGate } from "./native-review-bridge";
import { createGrOwnerExecutionAuthReader } from "./owner-auth-reader";
import {
  assertGrOwnerUnusedExecution,
  retireGrUnusedCampaignGate,
  type GrOwnerUnusedExecution,
} from "./owner-retirement";

export const GR_OWNER_PUBLICATION_POLICY = "/etc/reliverse/gr/owner-publication.json";
export const GR_OWNER_PUBLICATION_ROOT = "/var/lib/reliverse/gr/publication/reliverse-reliverse";
/** Structural binding only. Raw object integrity and the frozen first-step tree
 * are independently checked by the preparation owner before retaining the ref. */
export function assertGrPublicationRetainedPrefix(
  prefix: GrCampaignRetainedPrefix,
  campaign: GrPublicationCampaign,
) {
  const first = campaign.commits[0];
  if (
    !first ||
    prefix.commitId !== first.id ||
    prefix.title !== first.title ||
    ![prefix.commit, prefix.tree].every((oid) => /^[a-f0-9]{40}$/.test(oid)) ||
    typeof prefix.contentBase64 !== "string" ||
    prefix.contentBase64.length > 87384
  )
    throw new Error("GR_PUBLICATION_RETAINED_PREFIX_INVALID");
}
export interface GrOwnerPublicationPolicy {
  readonly schema: "gr.owner-publication.host.v0";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly custody: GrOwnerNativeCustody;
  readonly links: readonly { readonly path: string; readonly target: string }[];
  readonly ownerAuth: GrOwnerExecutionAuthPin;
  readonly authPolicyDigest: `sha256:${string}`;
  readonly baseCommit: string;
  readonly baseTree: string;
  readonly baseBundleDigest: `sha256:${string}`;
  readonly sourceManifestDigest: `sha256:${string}`;
  readonly sourceTreeProofDigest: `sha256:${string}`;
  readonly expectedCandidateTree: string;
  readonly campaign: GrPublicationCampaign;
  readonly retireUnusedExecution?: GrOwnerUnusedExecution;
  readonly retainedPrefix?: GrCampaignRetainedPrefix;
}
const denied = () => new Error("GR_OWNER_PUBLICATION_PREPARATION_NOT_ADMITTED");
const transition = "/var/lib/reliverse/gr/admissions/owner-publication/.transition";
export interface GrOwnerPreparationChild {
  readonly schema: "gr.owner-publication.child.v0";
  readonly operation: "prepare-source";
  readonly policyDigest: string;
  readonly root: string;
  readonly candidateTree: string;
  readonly bootId: string;
  readonly childPid: number;
  readonly childStart: string;
  readonly parentPid: number;
  readonly parentStart: string;
  readonly lockDevice: number;
  readonly lockInode: number;
}

/** Root-created process delegation, not a bearer token or Principal approval. */
export function assertGrOwnerPreparationChild(
  child: GrOwnerPreparationChild,
  expected: {
    readonly policyDigest: string;
    readonly root: string;
    readonly candidateTree: string;
    readonly pid: number;
    readonly ppid: number;
    readonly parentUid: number;
    readonly childStart: string;
    readonly parentStart: string;
    readonly bootId: string;
    readonly lock: {
      readonly uid: number;
      readonly mode: number;
      readonly dev: number;
      readonly ino: number;
      readonly directory: boolean;
    };
  },
) {
  if (
    child.schema !== "gr.owner-publication.child.v0" ||
    child.operation !== "prepare-source" ||
    child.policyDigest !== expected.policyDigest ||
    child.root !== expected.root ||
    child.candidateTree !== expected.candidateTree ||
    child.childPid !== expected.pid ||
    child.parentPid !== expected.ppid ||
    expected.parentUid !== 0 ||
    !/^\d+$/.test(child.childStart) ||
    child.childStart !== expected.childStart ||
    !/^\d+$/.test(child.parentStart) ||
    child.parentStart !== expected.parentStart ||
    child.bootId !== expected.bootId ||
    !/^[a-f0-9-]{36}$/.test(child.bootId) ||
    !expected.lock.directory ||
    expected.lock.uid !== 0 ||
    (expected.lock.mode & 0o7777) !== 0o755 ||
    !Number.isSafeInteger(child.lockDevice) ||
    !Number.isSafeInteger(child.lockInode) ||
    child.lockDevice !== expected.lock.dev ||
    child.lockInode !== expected.lock.ino
  )
    throw denied();
}

async function assertPreparationChild(policy: GrOwnerPublicationPolicy, digest: string) {
  const loaded = await document(transition + "/child.json", 0, 4096);
  const start = async (pid: number) => {
    const text = await readFile(`/proc/${pid}/stat`, "utf8");
    return text
      .slice(text.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/)[19]!;
  };
  const [lock, parent, childStart, parentStart, bootId] = await Promise.all([
    lstat(transition),
    lstat(`/proc/${process.ppid}`),
    start(process.pid),
    start(process.ppid),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ]);
  assertGrOwnerPreparationChild(loaded.value as unknown as GrOwnerPreparationChild, {
    policyDigest: digest,
    root: policy.custody.root,
    candidateTree: policy.expectedCandidateTree,
    pid: process.pid,
    ppid: process.ppid,
    parentUid: parent.uid,
    childStart,
    parentStart,
    bootId: bootId.trim(),
    lock: { ...lock, directory: lock.isDirectory() && !lock.isSymbolicLink() },
  });
}
export function assertGrOwnerPublicationPolicy(p: GrOwnerPublicationPolicy) {
  assertGrOwnerNativeCustodySpec(p.custody);
  assertGrPublicationCampaign(p.campaign);
  if (p.retireUnusedExecution) assertGrOwnerUnusedExecution(p.retireUnusedExecution);
  if (p.retainedPrefix) {
    assertGrPublicationRetainedPrefix(p.retainedPrefix, p.campaign);
    if (p.retireUnusedExecution) throw denied();
  }
  const begin = Date.parse(p.createdAt),
    end = Date.parse(p.expiresAt);
  if (
    p.schema !== "gr.owner-publication.host.v0" ||
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    end <= begin ||
    end - begin > 5 * 3600000 ||
    (p.custody.root !== GR_OWNER_PUBLICATION_ROOT &&
      p.custody.root !== `${GR_OWNER_PUBLICATION_ROOT}-${p.expectedCandidateTree}`) ||
    p.custody.ownerUid !== 995 ||
    p.custody.ownerGid !== 985 ||
    p.custody.producerUid !== 1000 ||
    p.custody.reviewerUid !== 994 ||
    p.custody.launcherExecutable !== GR_REVIEW_OWNER_EXECUTABLE ||
    p.custody.remoteUrl !== "git@github.com:reliverse/reliverse.git" ||
    !/^prn_[a-f0-9]{32}$/.test(p.ownerAuth.principalId) ||
    !/^auth_session_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      p.ownerAuth.sessionId,
    ) ||
    fingerprintGatehouseValue(p.ownerAuth.author) !== fingerprintGatehouseValue(p.custody.author) ||
    p.links.length > 64 ||
    new Set(p.links.map((l) => l.path)).size !== p.links.length ||
    p.links.some(
      (l) =>
        !/^\/(?:usr\/[A-Za-z0-9_./+-]+|lib|lib64)$/.test(l.path) ||
        path.normalize(l.path) !== l.path ||
        !l.target ||
        /[\r\n\0]/.test(l.target),
    ) ||
    ![p.baseCommit, p.baseTree, p.expectedCandidateTree].every((s) => /^[a-f0-9]{40}$/.test(s)) ||
    ![
      p.baseBundleDigest,
      p.authPolicyDigest,
      p.sourceManifestDigest,
      p.sourceTreeProofDigest,
    ].every((s) => /^sha256:[a-f0-9]{64}$/.test(s))
  )
    throw denied();
}

/** Bootstrap-only preparation on an independently admitted private replica. This
 * does not need a signing Gate before the exact protected-root plan exists, and
 * cannot choose an operation/plan/executor path from argv. Apply still uses the
 * separate reviewed-owner Gate/Cap path, with no fallback to this preparation. */
export async function runGrOwnerPublicationPreparation() {
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== 995 ||
    process.geteuid?.() !== 995 ||
    process.getgid?.() !== 985 ||
    process.getegid?.() !== 985 ||
    process.execPath !== GR_REVIEW_OWNER_EXECUTABLE ||
    process.umask() !== 0o077 ||
    !process.stdin.isTTY ||
    !process.stderr.isTTY ||
    [
      "BUN_OPTIONS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "SSH_AUTH_SOCK",
    ].some((k) => process.env[k] !== undefined)
  )
    throw denied();
  const loaded = await document(GR_OWNER_PUBLICATION_POLICY, 0, 65536);
  const policy = loaded.value as unknown as GrOwnerPublicationPolicy;
  assertGrOwnerPublicationPolicy(policy);
  const native = createGrOwnerNativeGitRuntime(policy.custody);
  const assertNativeCurrent = async () => {
    await assertPreparationChild(policy, loaded.digest);
    if (
      (await document(GR_OWNER_PUBLICATION_POLICY, 0, 65536)).digest !== loaded.digest ||
      Date.now() < Date.parse(policy.createdAt) ||
      Date.now() >= Date.parse(policy.expiresAt)
    )
      throw denied();
    const a = await stat("/proc/self/fd/0"),
      b = await stat("/proc/self/fd/2");
    if (
      !a.isCharacterDevice() ||
      a.uid !== 995 ||
      b.uid !== 995 ||
      a.dev !== b.dev ||
      a.ino !== b.ino
    )
      throw denied();
    for (const link of policy.links) {
      await assertRvsReviewerRootDirectory(path.dirname(link.path));
      const s = await lstat(link.path);
      if (!s.isSymbolicLink() || s.uid !== 0 || (await readlink(link.path)) !== link.target)
        throw denied();
    }
    await native.assertCurrent();
  };
  const readCurrentOwner = createGrOwnerExecutionAuthReader(
    { ...policy.ownerAuth, authPolicyDigest: policy.authPolicyDigest },
    { now: () => new Date(), assertNativeCurrent },
  );
  await readCurrentOwner();
  const retirement = policy.retireUnusedExecution
    ? await retireUnusedExecution(policy, readCurrentOwner)
    : undefined;
  // Every preparatory Git subprocess rechecks canonical current Auth as well as
  // native custody. This grants no repo.commit/repo.push operation or CapRef.
  const runtime = {
    ...native,
    assertCurrent: async () => {
      await readCurrentOwner();
    },
  };
  const result = await withGrGitRuntime(runtime, () =>
    prepareGrCampaignPublicationSource({
      root: policy.custody.root,
      campaignId: policy.campaign.id,
      baseCommit: policy.baseCommit,
      baseTree: policy.baseTree,
      baseBundleDigest: policy.baseBundleDigest,
      sourceManifestDigest: policy.sourceManifestDigest,
      sourceTreeProofDigest: policy.sourceTreeProofDigest,
      expectedCandidateTree: policy.expectedCandidateTree,
      paths: policy.campaign.paths,
      commits: policy.campaign.commits,
      ...(policy.campaign.publication ? { publication: policy.campaign.publication } : {}),
      ...(policy.retainedPrefix ? { retainedPrefix: policy.retainedPrefix } : {}),
      grantedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    }),
  );
  await readCurrentOwner();
  const claim = await lstat(policy.custody.root + "/.git/gr-publication-preparation");
  if (
    !claim.isDirectory() ||
    claim.isSymbolicLink() ||
    claim.uid !== 995 ||
    claim.gid !== 985 ||
    (claim.mode & 0o7777) !== 0o700
  )
    throw denied();
  return retirement ? { ...result, retirement } : result;
}

async function retireUnusedExecution(
  policy: GrOwnerPublicationPolicy,
  assertCurrent: () => Promise<unknown>,
) {
  const expected = policy.retireUnusedExecution!;
  const launch = await document("/etc/reliverse/gr/owner-launch.json", 0, 2 * 1024 ** 2);
  const signing = await document("/etc/reliverse/gr/reviewer-signing.json", 0, 2 * 1024 ** 2);
  const bridge = await document("/etc/reliverse/gr/native-review-bridge.json", 0, 2 * 1024 ** 2);
  if (
    launch.digest !== expected.launchPolicyDigest ||
    signing.digest !== expected.signingPolicyDigest ||
    bridge.digest !== expected.bridgePolicyDigest
  )
    throw denied();
  const old = signing.value as unknown as GrCampaignReviewerSigningPolicy;
  assertGrCampaignReviewerSigningPolicy(old);
  if (
    old.bindings.plan.base.commit.oid !== policy.baseCommit ||
    old.bindings.plan.frozen?.candidateTree.oid === policy.expectedCandidateTree ||
    old.bindings.review.ownerPrincipalId !== policy.ownerAuth.principalId
  )
    throw denied();
  const gateId = createDeterministicGatehouseId("gate", old.intent.id);
  const home = `/var/lib/reliverse/gr/gatehouse/${old.bindings.plan.campaignFingerprint}`;
  const directory = `${home}/gates/${gateId}`;
  // Fixed bundled module, not policy-selected code or mutable source execution.
  const { assertGrOwnerGateHome } = await import("./owner-launch");
  const runtime = createGatehouseRuntime({ home });
  let revoked = false;
  const inspectGate = async () =>
    inspectGrNativeUnlockedGate(directory, async () => {
      await assertGrOwnerGateHome(home);
      const inventory: Record<string, string> = {};
      const fences: Array<{ path: string; identity: string }> = [];
      const identity = (s: BigIntStats) => `${s.dev}:${s.ino}:${s.ctimeNs}:${s.mtimeNs}:${s.size}`;
      const visit = async (dir: string, prefix = "") => {
        for (const name of await readdir(dir)) {
          const relative = prefix + name;
          const s = await lstat(`${dir}/${name}`, { bigint: true });
          fences.push({ path: `${dir}/${name}`, identity: identity(s) });
          if (s.isDirectory()) await visit(`${dir}/${name}`, relative + "/");
          else inventory[relative] = (await document(`${dir}/${name}`, 995, 65536)).digest;
        }
      };
      await visit(directory);
      if (
        !revoked &&
        (fingerprintGatehouseValue(inventory) !== expected.gateInventoryDigest ||
          inventory["gate.json"] !== expected.gateDigest)
      )
        throw denied();
      const inspection = (await runtime.inspectGate(gateId)) ?? null;
      for (const fence of fences)
        if (identity(await lstat(fence.path, { bigint: true })) !== fence.identity) throw denied();
      await assertGrOwnerGateHome(home);
      return inspection;
    });
  return retireGrUnusedCampaignGate({
    signing: old,
    ownerPrincipalId: policy.ownerAuth.principalId,
    reason: expected.reason,
    assertCurrent: async () => {
      await assertCurrent();
    },
    gatehouse: {
      inspectGate: async () => (await inspectGate()) ?? undefined,
      revoke: async (input) => {
        const result = await runtime.revoke(input);
        revoked = true;
        return result;
      },
    },
  });
}
