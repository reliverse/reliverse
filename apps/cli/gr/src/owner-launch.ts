import { randomUUID } from "node:crypto";
import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertGatehouseEndorsementSubmission,
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
  type GatehouseEndorsementSubmission,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime, type GatehouseRuntime } from "@reliverse/gatehouse-runtime";
import type { GrGitRuntime } from "@reliverse/gr";
import {
  assertGrCampaignReviewerSigningPolicy,
  assertGrOwnerNativeCustodySpec,
  createGrOwnerNativeGitRuntime,
  createGrAuthenticatedReviewedOwnerHost,
  type GrCampaignReviewerSigningPolicy,
  type GrOwnerNativeCustody,
  type GrOwnerExecutionAuthPin,
} from "@reliverse/gr-action-runtime";
import {
  assertRvsReviewerRootDirectory,
  readRvsReviewerProtectedDocument as document,
} from "@reliverse/rvs-systemd-ubuntu";

import {
  GR_REVIEW_OWNER_EXECUTABLE,
  GR_REVIEW_BRIDGE_POLICY,
  assertGrNativeReviewHostPolicy,
} from "./native-review-bridge";
import { connectGrNativeReview, createGrNativeOwnerReviewPorts } from "./native-review-client";
import { createGrOwnerExecutionAuthReader } from "./owner-auth-reader";
import { runGrOwnerPublicationPreparation } from "./owner-publication";
import { dispatchGrOwnerCommit, dispatchGrOwnerPush } from "./owner-push";

export const GR_OWNER_LAUNCH_POLICY = "/etc/reliverse/gr/owner-launch.json";
const denied = () => new Error("GR_OWNER_LAUNCH_NOT_ADMITTED");
type Digest = `sha256:${string}`;
export interface GrOwnerLaunchPolicy {
  readonly schema: "gr.owner-launch.host.v0";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly bridgePolicyDigest: Digest;
  readonly signingPolicyDigest: Digest;
  readonly authPolicyDigest: Digest;
  readonly ownerAuth: GrOwnerExecutionAuthPin;
  readonly custody: GrOwnerNativeCustody;
}

/** Admission supplies this policy from a fixed root-owned location, never argv.
 * Exact signing/GR bindings are reused, not copied into a second action schema. */
export function assertGrOwnerLaunchPolicy(
  p: GrOwnerLaunchPolicy,
  signing: GrCampaignReviewerSigningPolicy,
) {
  assertGrCampaignReviewerSigningPolicy(signing);
  assertGrOwnerNativeCustodySpec(p.custody);
  const b = signing.bindings;
  const begin = Date.parse(p.createdAt),
    end = Date.parse(p.expiresAt);
  if (
    p.schema !== "gr.owner-launch.host.v0" ||
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    end <= begin ||
    end > Date.parse(signing.intent.expiresAt) ||
    ![p.bridgePolicyDigest, p.signingPolicyDigest, p.authPolicyDigest].every((d) =>
      /^sha256:[a-f0-9]{64}$/.test(d),
    ) ||
    p.signingPolicyDigest !== fingerprintGatehouseValue(signing) ||
    p.custody.ownerUid !== 995 ||
    p.custody.ownerGid !== 985 ||
    p.custody.producerUid !== 1000 ||
    p.custody.reviewerUid !== 994 ||
    p.custody.launcherExecutable !== GR_REVIEW_OWNER_EXECUTABLE ||
    p.custody.root !== b.plan.repository.root ||
    p.custody.closureFingerprint !== b.executorFingerprint ||
    p.custody.remoteUrl !== "git@github.com:reliverse/reliverse.git" ||
    p.ownerAuth.principalId !== b.review.ownerPrincipalId ||
    !/^auth_session_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      p.ownerAuth.sessionId,
    ) ||
    fingerprintGatehouseValue(p.ownerAuth.author) !== fingerprintGatehouseValue(p.custody.author) ||
    (b.action.kind === "push" &&
      (b.action.remote !== "origin" ||
        b.action.ref !== "refs/heads/main" ||
        b.action.remoteUrl !== p.custody.remoteUrl))
  )
    throw denied();
}

/** Typed assembly shared by native startup and owning fixtures. These are trusted
 * programmatic ports, not loadable modules or policy-selected implementations. */
export function composeGrOwnerLaunchHost(
  policy: GrOwnerLaunchPolicy,
  signing: GrCampaignReviewerSigningPolicy,
  ports: Parameters<typeof createGrAuthenticatedReviewedOwnerHost>[1] & {
    readonly gitRuntime: GrGitRuntime;
    readonly gatehouse: Parameters<typeof createGrAuthenticatedReviewedOwnerHost>[0]["gatehouse"];
    readonly reviewPorts: Parameters<
      typeof createGrAuthenticatedReviewedOwnerHost
    >[0]["reviewPorts"];
    readonly attemptId: string;
  },
) {
  assertGrOwnerLaunchPolicy(policy, signing);
  return createGrAuthenticatedReviewedOwnerHost(
    {
      ...signing.bindings,
      ownerAuth: policy.ownerAuth,
      ownerUid: policy.custody.ownerUid,
      contextRoot: policy.custody.root,
      gitRuntime: ports.gitRuntime,
      gateId: createDeterministicGatehouseId("gate", signing.intent.id),
      attemptId: ports.attemptId,
      gatehouse: ports.gatehouse,
      reviewPorts: ports.reviewPorts,
    },
    ports,
  );
}

/** Canonical Gatehouse owns schemas/locking/lifecycle. This adapter checks only
 * native placement/custody before and after its supported operations. */
export async function assertGrOwnerGateHome(home: string) {
  if (!/^\/var\/lib\/reliverse\/gr\/gatehouse\/[a-f0-9]{64}$/.test(home)) throw denied();
  await assertRvsReviewerRootDirectory(path.dirname(home));
  const visit = async (dir: string, depth: number, budget: { remaining: number }) => {
    const s = await lstat(dir);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== 995 ||
      s.gid !== 985 ||
      (s.mode & 0o7777) !== 0o700 ||
      depth > 5
    )
      throw denied();
    for (const name of await readdir(dir)) {
      if (--budget.remaining < 0 || !/^[A-Za-z0-9_.-]+$/.test(name) || name === ".lock")
        throw denied();
      const file = path.join(dir, name),
        st = await lstat(file);
      if (st.isDirectory() && !st.isSymbolicLink()) await visit(file, depth + 1, budget);
      else if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.uid !== 995 ||
        st.gid !== 985 ||
        st.nlink !== 1 ||
        (st.mode & 0o7777) !== 0o600 ||
        st.size > 2 * 1024 ** 2
      )
        throw denied();
    }
  };
  await visit(home, 0, { remaining: 1024 });
}

export function guardGrOwnerGateLocation(
  runtime: GatehouseRuntime,
  assertLocation: () => Promise<void>,
) {
  const guarded =
    <A extends unknown[], R>(f: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      await assertLocation();
      const result = await f(...args);
      await assertLocation();
      return result;
    };
  return {
    inspectGate: guarded(runtime.inspectGate.bind(runtime)),
    submitIntent: guarded(runtime.submitIntent.bind(runtime)),
    submitEndorsement: guarded(runtime.submitEndorsement.bind(runtime)),
    issueLease: guarded(runtime.issueLease.bind(runtime)),
    consumeLease: guarded(runtime.consumeLease.bind(runtime)),
    // Deliberately no Auth/time/quorum check here: record an effect even if its
    // authorization expired/revoked after consumption. No replay is granted.
    recordExecution: guarded(runtime.recordExecution.bind(runtime)),
  };
}

/** Native/source startup guard happens before policy, Auth, credential or socket
 * access. --identity reports metadata only and never admits this executable. */
export async function runGrOwnerLaunch(
  args: readonly string[],
  readCourier: () => Promise<GatehouseEndorsementSubmission> = readGrOwnerCourier,
) {
  if (args.length === 1 && args[0] === "--identity")
    return {
      schema: "gr.owner-launch.executor.v0",
      authenticationIssuer: false,
      signing: false,
      gitExecutionAdmitted: false,
    };
  if (args.length === 1 && args[0] === "prepare-source") return runGrOwnerPublicationPreparation();
  const command = args[0];
  const mutation =
    (command === "commit" || command === "push") &&
    args.length === 3 &&
    args[1] === "--interactive" &&
    args[2] === "--apply";
  if (
    !((args.length === 1 && ["status", "prepare", "endorse"].includes(command!)) || mutation) ||
    process.platform !== "linux" ||
    process.getuid?.() !== 995 ||
    process.geteuid?.() !== 995 ||
    process.getgid?.() !== 985 ||
    process.getegid?.() !== 985 ||
    process.execPath !== GR_REVIEW_OWNER_EXECUTABLE ||
    process.umask() !== 0o077 ||
    [
      "BUN_OPTIONS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "SSH_AUTH_SOCK",
    ].some((k) => process.env[k] !== undefined) ||
    (mutation && (!process.stdin.isTTY || !process.stderr.isTTY))
  )
    throw denied();
  const loaded = await document(GR_OWNER_LAUNCH_POLICY, 0, 2 * 1024 ** 2);
  const policy = loaded.value as unknown as GrOwnerLaunchPolicy;
  const bridge = await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2);
  if (bridge.digest !== policy.bridgePolicyDigest) throw denied();
  const bridgePolicy = bridge.value as unknown as Parameters<
    typeof assertGrNativeReviewHostPolicy
  >[0];
  assertGrNativeReviewHostPolicy(bridgePolicy);
  const signing = bridgePolicy.signing;
  assertGrOwnerLaunchPolicy(policy, signing);
  if (Date.parse(policy.expiresAt) > Date.parse(bridgePolicy.expiresAt)) throw denied();
  // The bridge must attest the very same launcher/Git/SSH artifact closure, not a
  // different root-owned binary carrying an equally shaped policy.
  if (
    policy.custody.artifacts.some(
      (a) => !bridgePolicy.artifacts.some((b) => a.path === b.path && a.digest === b.digest),
    )
  )
    throw denied();
  const gitRuntime = createGrOwnerNativeGitRuntime(policy.custody);
  const assertNativeCurrent = async () => {
    if (
      (await document(GR_OWNER_LAUNCH_POLICY, 0, 2 * 1024 ** 2)).digest !== loaded.digest ||
      (await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2)).digest !== bridge.digest ||
      Date.now() < Date.parse(policy.createdAt) ||
      Date.now() >= Date.parse(policy.expiresAt)
    )
      throw denied();
    await gitRuntime.assertCurrent();
    if (mutation) {
      const input = await stat("/proc/self/fd/0"),
        output = await stat("/proc/self/fd/2");
      if (
        !process.stdin.isTTY ||
        !process.stderr.isTTY ||
        !input.isCharacterDevice() ||
        input.uid !== 995 ||
        output.uid !== 995 ||
        input.dev !== output.dev ||
        input.ino !== output.ino
      )
        throw denied();
    }
  };
  const readCurrentOwner = createGrOwnerExecutionAuthReader(
    { ...policy.ownerAuth, authPolicyDigest: policy.authPolicyDigest },
    { now: () => new Date(), assertNativeCurrent },
  );
  await assertNativeCurrent();
  await readCurrentOwner();
  const channel = await connectGrNativeReview("owner");
  try {
    if (fingerprintGatehouseValue(channel.policy) !== fingerprintGatehouseValue(bridgePolicy))
      throw denied();
    const reviewPorts = createGrNativeOwnerReviewPorts(channel);
    const gateId = createDeterministicGatehouseId("gate", signing.intent.id);
    const home = `/var/lib/reliverse/gr/gatehouse/${signing.bindings.plan.campaignFingerprint}`;
    const runtime = createGatehouseRuntime({ home, endorsementVerifier: reviewPorts.verifier });
    const gatehouse = guardGrOwnerGateLocation(runtime, () => assertGrOwnerGateHome(home));
    if (command === "prepare") {
      await readCurrentOwner();
      const result = await gatehouse.submitIntent(signing.intent);
      await readCurrentOwner();
      return result;
    }
    if (command === "endorse") {
      const courier = await readCourier();
      assertGatehouseEndorsementSubmission(courier);
      if (courier.gateId !== gateId || courier.intentDigest !== signing.intent.digest)
        throw denied();
      await readCurrentOwner();
      const result = await gatehouse.submitEndorsement(courier);
      await readCurrentOwner();
      return result;
    }
    if (command === "status") {
      const result = await gatehouse.inspectGate(gateId);
      await readCurrentOwner();
      return {
        schema: "gr.owner-launch.status.v0",
        gate: result,
        authorityGranted: false,
        automaticRetry: false,
      };
    }
    if (command !== signing.bindings.action.kind) throw denied();
    const host = composeGrOwnerLaunchHost(policy, signing, {
      now: () => new Date(),
      readCurrentOwner,
      gitRuntime,
      gatehouse,
      reviewPorts,
      attemptId: `attempt:gr-owner:${randomUUID()}`,
    });
    const input = { root: policy.custody.root, interactive: true, apply: true };
    return command === "commit"
      ? await dispatchGrOwnerCommit(input, host)
      : await dispatchGrOwnerPush(input, host);
  } finally {
    channel.close();
  }
}

async function readGrOwnerCourier(): Promise<GatehouseEndorsementSubmission> {
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(denied()), 30000);
  try {
    for await (const chunk of process.stdin) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > 16384) throw denied();
      chunks.push(b);
    }
    const courier = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assertGatehouseEndorsementSubmission(courier);
    return courier;
  } finally {
    clearTimeout(timer);
  }
}
