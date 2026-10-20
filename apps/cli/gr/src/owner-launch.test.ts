import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AuthSessionV0 } from "@reliverse/auth";
import {
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import { createGrCampaignPlan, freezeGrCampaignPlan, fingerprintGrJson } from "@reliverse/gr";
import {
  createGrCampaignActionIntent,
  createGrNativeReviewBridge,
  type GrNativeReviewPeer,
  type GrNativeReviewReceipt,
  renderGrOwnerNativeGitConfig,
  type GrCampaignReviewerSigningPolicy,
} from "@reliverse/gr-action-runtime";
import {
  createQualityRegistry,
  defineQualitySuite,
  runQualityCandidateVerification,
} from "@reliverse/quality";

import {
  assertGrNativeReviewHostPolicy,
  assertGrNativeReviewOwnerGateLock,
  inspectGrNativeCourierGate,
  GR_REVIEW_MAX_LIFETIME_MS,
  type GrNativeReviewHostPolicy,
} from "./native-review-bridge";
import { createGrNativeOwnerReviewPorts } from "./native-review-client";
import {
  assertGrOwnerLaunchPolicy,
  assertGrOwnerGateHome,
  composeGrOwnerLaunchHost,
  guardGrOwnerGateLocation,
  runGrOwnerLaunch,
  type GrOwnerLaunchPolicy,
} from "./owner-launch";
import {
  assertGrOwnerPublicationPolicy,
  assertGrOwnerPreparationChild,
  type GrOwnerPreparationChild,
  GR_OWNER_PUBLICATION_ROOT,
} from "./owner-publication";
import { retireGrUnusedCampaignGate, assertGrOwnerUnusedExecution } from "./owner-retirement";

const roots: string[] = [];
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});
const hash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}` as const;
const owner = `prn_${"a".repeat(32)}` as const,
  reviewer = `prn_${"b".repeat(32)}` as const;
const now = () => new Date("2026-10-19T10:00:00Z");

async function fixture(expiresAt = "2026-10-19T11:00:00Z", campaignId = "fixture") {
  const root = await mkdtemp(path.join(tmpdir(), "gr-launch-"));
  roots.push(root);
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(
      [
        "/usr/bin/git",
        "--no-pager",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgSign=false",
        ...args,
      ],
      { cwd: root, env: { ...process.env, GIT_EDITOR: "true" } },
    );
    if (p.exitCode !== 0) throw Error(p.stderr.toString());
  };
  git("init", "-q");
  await writeFile(path.join(root, "core.txt"), "base\n");
  git("add", "core.txt");
  git("commit", "-qm", "base");
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  const raw = await freezeGrCampaignPlan({
    root,
    plan: await createGrCampaignPlan({
      root,
      campaignId,
      baseRevision: "HEAD",
      paths: ["core.txt"],
      commits: [
        {
          id: campaignId === "fixture-retirement" ? "rq-source" : "core",
          title: "fixture",
          paths: ["core.txt"],
        },
      ],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  // Synthetic policy location only. No /var/lib workspace or native custody is
  // created/proven by these tests; actual fixture commit proof lives in runtime.
  const { campaignFingerprint: _, ...semantic } = raw;
  const data = {
    ...semantic,
    repository: { ...semantic.repository, root: "/var/lib/reliverse/gr/publication/fixture" },
  };
  const plan = { ...data, campaignFingerprint: fingerprintGrJson(data, "gr.campaign-plan.v0") };
  const suite = defineQualitySuite({
    id: "fixture",
    title: "Fixture",
    description: "Fixture, not production RQ",
    capabilities: [
      {
        id: "fixture.check",
        title: "Check",
        description: "Fixture",
        operations: ["check"],
        defaultProvider: "fixture.check.builtin",
        providers: ["fixture.check.builtin"],
      },
    ],
    providers: [
      {
        id: "fixture.check.builtin",
        capabilityId: "fixture.check",
        title: "Fixture",
        version: "1.0.0",
        operations: ["check"],
        determinism: "deterministic",
      },
    ],
    rules: [],
    checks: { "fixture.check": () => [] },
  });
  const candidateFingerprint = `git-tree:sha1:${plan.frozen!.candidateTree.oid}`;
  const quality = await runQualityCandidateVerification(createQualityRegistry([suite]), {
    runId: "fixture",
    createdAt: now().toISOString(),
    target: {
      kind: "repository",
      id: "fixture",
      root: plan.repository.root,
      snapshot: candidateFingerprint,
    },
    candidateFingerprint,
    executionFingerprint: "fixture-quality",
    observeCandidateFingerprint: async () => candidateFingerprint,
    observeExecutionFingerprint: async () => "fixture-quality",
    checks: [
      {
        request: { capabilityId: "fixture.check", providerId: "fixture.check.builtin" },
        suiteFingerprint: suite.manifestFingerprint,
        providerVersion: "1.0.0",
      },
    ],
  });
  const evidence = {
    schema: "gr.campaign-review-evidence.v0" as const,
    campaignFingerprint: plan.campaignFingerprint,
    candidateTree: plan.frozen!.candidateTree.oid,
    reviewerPrincipalId: reviewer,
    manifestDigest: hash("manifest"),
    treeProofDigest: hash("proof"),
    reportDigest: hash("report"),
    proofScope: "candidate-source-only" as const,
  };
  const review = {
    ownerPrincipalId: owner,
    reviewerPrincipalId: reviewer,
    credentialId: "credential.reviewer",
    publicKeyDigest: hash("key"),
    actorBindingDigest: hash("binding"),
    executionIdentityDigest: hash("identity"),
    evidenceDigest: fingerprintGatehouseValue(evidence),
  };
  const bindings = {
    plan,
    action: {
      kind: "commit" as const,
      commitId: campaignId === "fixture-retirement" ? "rq-source" : "core",
      expectedBeforeCommit: plan.base.commit.oid,
    },
    quality,
    qualityPolicyFingerprint: quality.policyFingerprint,
    executionFingerprint: "fixture-quality",
    executorFingerprint: hash("closure"),
    review,
  };
  const intent = createGrCampaignActionIntent({
    ...bindings,
    authority: {
      createdAt: now().toISOString(),
      expiresAt,
      requester: { id: owner, kind: "human" },
      actor: { id: "service.gr", kind: "service" },
      accountableSystem: { id: "service.gr", kind: "service" },
      policy: {
        id: "fixture",
        digest: hash("policy"),
        authority: {
          kind: "all-of",
          independence: "distinct-perspectives",
          principalIds: [owner, reviewer],
        },
      },
    },
  });
  const signing: GrCampaignReviewerSigningPolicy = {
    schema: "gr.campaign-reviewer-signing-policy.v0",
    bindings,
    evidence,
    intent,
    credentialExpiresAt: "2026-10-20T00:00:00Z",
  };
  const remoteUrl = "git@github.com:reliverse/reliverse.git";
  const author = { name: "Fixture", email: "fixture@example.invalid" };
  const policy: GrOwnerLaunchPolicy = {
    schema: "gr.owner-launch.host.v0",
    createdAt: now().toISOString(),
    expiresAt: intent.expiresAt,
    bridgePolicyDigest: hash("bridge"),
    signingPolicyDigest: fingerprintGatehouseValue(signing) as `sha256:${string}`,
    authPolicyDigest: hash("auth"),
    ownerAuth: {
      principalId: owner,
      sessionId: "auth_session_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      author,
    },
    custody: {
      ownerUid: 995,
      ownerGid: 985,
      producerUid: 1000,
      reviewerUid: 994,
      author,
      launcherExecutable: "/usr/lib/reliverse/gr/owner-launch",
      root: plan.repository.root,
      credentialDirectory: "/var/lib/reliverse/gr/credentials/fixture",
      privateKeyFile: "/var/lib/reliverse/gr/credentials/fixture/key",
      knownHostsFile: "/var/lib/reliverse/gr/credentials/fixture/known_hosts",
      knownHostsDigest: hash("hosts"),
      gitConfigDigest: hash(renderGrOwnerNativeGitConfig(remoteUrl)),
      remoteUrl,
      gitExecutable: "/usr/bin/git",
      sshExecutable: "/usr/bin/ssh",
      closureFingerprint: bindings.executorFingerprint,
      artifacts: ["/usr/bin/git", "/usr/bin/ssh", "/usr/lib/reliverse/gr/owner-launch"].map(
        (path) => ({ path, digest: hash(path) }),
      ),
    },
  };
  const session: AuthSessionV0 = {
    schema: "reliverse.auth.session.v0",
    id: policy.ownerAuth.sessionId,
    status: "active",
    principal: { id: owner, kind: "human" },
    client: { id: "os-user.uid-995", kind: "confidential" },
    issuer: "gr.protected-owner-terminal",
    assurance: "verified",
    scopes: ["identity.observe"],
    audiences: ["gr.owner-control"],
    resources: ["github:reliverse/reliverse"],
    createdAt: now().toISOString(),
    expiresAt: intent.expiresAt,
  };
  return { root, policy, signing, session };
}

for (const mode of [
  "live",
  "expired",
  "foreign-owner",
  "lease",
  "consumed",
  "execution",
  "race",
  "auth",
  "post-auth",
  "repeat",
] as const) {
  test(`approved-unused retirement: ${mode}`, async () => {
    const f = await fixture("2026-10-19T11:00:00Z", "fixture-retirement");
    let instant = now();
    const runtime = createGatehouseRuntime({
      home: path.join(f.root, "retirement-gatehouse"),
      now: () => instant,
      endorsementVerifier: {
        id: "fixture",
        verify: async ({ endorsement }) => ({
          ...endorsement,
          verification: {
            verifierId: "fixture",
            verifiedAt: now().toISOString(),
            evidenceDigest: hash("fixture"),
          },
        }),
      },
    });
    const { gate } = await runtime.submitIntent(f.signing.intent);
    for (const principalId of [owner, reviewer])
      await runtime.submitEndorsement(
        createGatehouseEndorsementSubmission({
          gateId: gate.id,
          intentDigest: f.signing.intent.digest,
          principalId,
          credentialId: principalId === owner ? "credential.owner" : "credential.reviewer",
          decision: "approve",
          issuedAt: now().toISOString(),
          expiresAt: f.signing.intent.expiresAt,
          assurance: {
            profile: "fixture",
            evidenceDigest: hash("fixture"),
            deviceBound: false,
            userPresence: false,
            userVerification: false,
          },
          proof: { profile: "fixture", signature: () => "fixture" },
        }),
      );
    const before = await runtime.inspectGate(gate.id);
    const issue = () =>
      runtime.issueLease({
        gateId: gate.id,
        preconditionDigest: f.signing.intent.preconditions.digest,
      });
    if (["lease", "consumed", "execution"].includes(mode)) {
      const lease = await issue();
      if (mode !== "lease") {
        const consumed = await runtime.consumeLease({
          leaseId: lease.id,
          attemptId: "attempt.fixture",
          targetDigest: lease.targetDigest,
          capability: lease.capability,
          executorClass: lease.executorClass,
          scopeDigest: lease.scopeDigest,
          intentDigest: lease.intentDigest,
          preconditionDigest: lease.preconditionDigest,
        });
        if (mode === "execution")
          await runtime.recordExecution({
            gateId: gate.id,
            consumptionId: consumed.id,
            leaseId: lease.id,
            attemptId: "attempt.fixture",
            outcome: "completed",
          });
      }
    }
    if (mode === "expired") instant = new Date(f.signing.intent.expiresAt);
    let authChecks = 0;
    const run = () =>
      retireGrUnusedCampaignGate({
        signing: f.signing,
        reason: "fixture approved-unused disposition",
        ownerPrincipalId: mode === "foreign-owner" ? reviewer : owner,
        assertCurrent: async () => {
          authChecks++;
          if (mode === "auth" || (mode === "post-auth" && authChecks === 3))
            throw Error("fixture Auth revoked");
        },
        gatehouse: {
          inspectGate: runtime.inspectGate,
          revoke: async (input) => {
            if (mode === "race") await issue();
            return runtime.revoke(input);
          },
        },
      });
    if (["live", "expired", "repeat", "post-auth"].includes(mode)) {
      if (mode === "post-auth") await expect(run()).rejects.toThrow("fixture Auth revoked");
      else expect((await run()).outcome).toBe("completed");
      const after = await runtime.inspectGate(gate.id);
      expect(after?.effectiveStatus).toBe("revoked");
      expect(after?.endorsements).toEqual(before?.endorsements);
      expect(after?.decisions).toEqual(before?.decisions);
      expect(after?.approvalBundle).toEqual(before?.approvalBundle);
      expect(after?.lease).toBeUndefined();
      expect(after?.consumption).toBeUndefined();
      expect(after?.execution).toBeUndefined();
      if (mode === "repeat") {
        await expect(run()).rejects.toThrow();
        expect((await runtime.inspectGate(gate.id))?.revocations).toHaveLength(1);
      }
    } else {
      await expect(run()).rejects.toThrow();
      const after = await runtime.inspectGate(gate.id);
      expect(after?.revocations).toHaveLength(0);
      if (mode === "race") expect(after?.lease).toBeDefined();
    }
  });
}

test("unused retirement expectation accepts seven hash bindings and an explicit reason", () => {
  const expected: Record<string, string> = Object.fromEntries(
    [
      "launchPolicyDigest",
      "signingPolicyDigest",
      "bridgePolicyDigest",
      "gateDigest",
      "nativeCompletionDigest",
      "nativeSealDigest",
      "gateInventoryDigest",
    ].map((key) => [key, hash(key)]),
  );
  expected.reason = "fixture approved-unused disposition";
  expect(() =>
    assertGrOwnerUnusedExecution(
      expected as unknown as Parameters<typeof assertGrOwnerUnusedExecution>[0],
    ),
  ).not.toThrow();
  for (const changed of [
    { ...expected, extra: hash("extra") },
    { ...expected, gateInventoryDigest: "wrong" },
  ])
    expect(() =>
      assertGrOwnerUnusedExecution(
        changed as unknown as Parameters<typeof assertGrOwnerUnusedExecution>[0],
      ),
    ).toThrow();
});

test("native policy accepts the full two-hour lifetime but never exceeds its cap or signed intent", async () => {
  const f = await fixture("2026-10-19T13:00:00Z");
  const policy: GrNativeReviewHostPolicy = {
    schema: "gr.native-review.host.v0",
    createdAt: now().toISOString(),
    expiresAt: new Date(now().getTime() + GR_REVIEW_MAX_LIFETIME_MS).toISOString(),
    signing: f.signing,
    signingPolicyFileDigest: hash("signing-file"),
    unitDigest: hash("unit"),
    appArmorDigest: hash("apparmor"),
    ownerCredentialId: "credential.owner",
    ownerPublicKeyDigest: hash("owner-key"),
    artifacts: [
      "/usr/lib/reliverse/gr/native-review-bridge",
      "/usr/lib/reliverse/reviewer/sign-campaign-review",
      "/usr/lib/reliverse/gr/owner-launch",
    ].map((path) => ({ path, digest: hash(path) })),
    links: [],
    principalDigests: { owner: hash("owner"), reviewer: hash("reviewer") },
    principalDirectory: "/srv/principals",
    producerHome: "/srv/producer",
    evidenceFiles: [
      {
        path: "/var/lib/reliverse/gr/review-evidence/fixture/manifest.json",
        digest: hash("manifest"),
      },
      {
        path: "/var/lib/reliverse/gr/review-evidence/fixture/tree-proof.json",
        digest: hash("proof"),
      },
      {
        path: "/var/lib/reliverse/gr/review-evidence/fixture/report.md",
        digest: hash("report"),
      },
    ],
  };
  expect(() => assertGrNativeReviewHostPolicy(policy)).not.toThrow();
  for (const expiresAt of [
    new Date(now().getTime() + GR_REVIEW_MAX_LIFETIME_MS + 1).toISOString(),
    now().toISOString(),
    new Date(now().getTime() - 1).toISOString(),
    "invalid",
  ])
    expect(() => assertGrNativeReviewHostPolicy({ ...policy, expiresAt })).toThrow();
  expect(() => assertGrNativeReviewHostPolicy({ ...policy, createdAt: "invalid" })).toThrow();
  const shorter = await fixture("2026-10-19T11:00:00Z");
  expect(() => assertGrNativeReviewHostPolicy({ ...policy, signing: shorter.signing })).toThrow();
  expect(() =>
    assertGrNativeReviewHostPolicy({
      ...policy,
      signing: { ...f.signing, credentialExpiresAt: "2026-10-19T11:00:00Z" },
    }),
  ).toThrow();
});

test("launcher policy binds exact signing, native custody, author, session and closure", async () => {
  const f = await fixture();
  assertGrOwnerLaunchPolicy(f.policy, f.signing);
  for (const change of [
    (p: GrOwnerLaunchPolicy) => ({ ...p, signingPolicyDigest: hash("foreign") }),
    (p: GrOwnerLaunchPolicy) => ({ ...p, ownerAuth: { ...p.ownerAuth, principalId: reviewer } }),
    (p: GrOwnerLaunchPolicy) => ({
      ...p,
      ownerAuth: { ...p.ownerAuth, sessionId: "expired-output-is-not-a-session" },
    }),
    (p: GrOwnerLaunchPolicy) => ({
      ...p,
      ownerAuth: { ...p.ownerAuth, author: { ...p.ownerAuth.author, name: "other" } },
    }),
    (p: GrOwnerLaunchPolicy) => ({
      ...p,
      custody: { ...p.custody, closureFingerprint: hash("foreign") },
    }),
    (p: GrOwnerLaunchPolicy) => ({
      ...p,
      custody: { ...p.custody, root: "/var/lib/reliverse/gr/publication/other" },
    }),
    (p: GrOwnerLaunchPolicy) => ({ ...p, expiresAt: "2026-10-20T00:00:00Z" }),
  ])
    expect(() => assertGrOwnerLaunchPolicy(change(f.policy), f.signing)).toThrow();
});

test("typed launcher preview grants no lease; expired Auth blocks apply before Gate mutation", async () => {
  const f = await fixture();
  const gatehouse = createGatehouseRuntime({ home: path.join(f.root, "gatehouse"), now });
  const submitted = await gatehouse.submitIntent(f.signing.intent);
  let expired = false,
    custody = 0;
  const host = composeGrOwnerLaunchHost(f.policy, f.signing, {
    gatehouse,
    now,
    attemptId: "attempt.fixture",
    readCurrentOwner: async () => ({
      ...f.session,
      ...(expired ? { expiresAt: now().toISOString() } : {}),
    }),
    gitRuntime: {
      root: f.policy.custody.root,
      executable: "/usr/bin/git",
      closureFingerprint: f.signing.bindings.executorFingerprint,
      env: {
        GIT_AUTHOR_NAME: "Fixture",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      assertCurrent: async () => {},
    },
    reviewPorts: {
      now,
      assertCustodyCurrent: async () => {
        custody++;
      },
      verifier: {
        id: "fixture-unused",
        verify: async () => {
          throw Error("no signatures in preview");
        },
      },
    },
  });
  expect((await host.inspect()).gateStatus).toBe("pending");
  expect(custody).toBeGreaterThan(0);
  expect((await gatehouse.inspectGate(submitted.gate.id))?.lease).toBeUndefined();
  expired = true;
  await expect(host.execute()).rejects.toThrow("AUTH_UNVERIFIED");
  expect((await gatehouse.inspectGate(submitted.gate.id))?.consumption).toBeUndefined();
  await expect(host.execute()).rejects.toThrow("AUTH_UNVERIFIED");
});

test("native owner verifies submissions under its writer lock and rechecks quorum unlocked before lease", async () => {
  const f = await fixture();
  const home = path.join(f.root, "gatehouse");
  const peer: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: process.pid,
    instance: `${process.pid}:5678`,
    executableDigest: hash("fixture-owner"),
  };
  const bridgeClosureDigest = hash("fixture-bridge");
  const routes: boolean[] = [];
  const verified: string[] = [];
  const noMutation = async () => {
    throw Error("inspection must not mutate native journal");
  };
  let receipt: GrNativeReviewReceipt;
  const bridge = createGrNativeReviewBridge(
    {
      signing: f.signing,
      bridgeClosureDigest,
      expiresAt: f.signing.intent.expiresAt,
    },
    {
      now,
      assertCurrent: async () => {},
      inspectGate: async (ownerPeer) => {
        const directory = path.join(home, "gates", gate.id);
        return inspectGrNativeCourierGate(directory, ownerPeer, async (heldOwnerLock) => {
          routes.push(heldOwnerLock);
          // Portable fixture validates the actual Gatehouse lock protocol; production
          // additionally checks protected 995 filesystem ownership and document custody.
          if (heldOwnerLock) {
            const lock = JSON.parse(
              await readFile(path.join(directory, ".lock", "lock.json"), "utf8"),
            );
            assertGrNativeReviewOwnerGateLock(lock, ownerPeer, now());
          } else {
            await expect(lstat(path.join(directory, ".lock"))).rejects.toMatchObject({
              code: "ENOENT",
            });
          }
          return (await gatehouse.inspectGate(gate.id)) ?? null;
        });
      },
      verifier: {
        id: "fixture-native",
        verify: async ({ endorsement }) => {
          verified.push(endorsement.id);
          return {
            ...endorsement,
            verification: {
              verifierId: "fixture-native",
              verifiedAt: now().toISOString(),
              evidenceDigest: hash("fixture-verification"),
            },
          };
        },
      },
      journal: {
        read: async () => receipt,
        reserve: noMutation,
        complete: noMutation,
        seal: noMutation,
        hold: noMutation,
      },
    },
  );
  const connection = bridge.connection();
  const nativePorts = createGrNativeOwnerReviewPorts({
    // This channel fixture uses only signing bindings; it is not native host admission.
    policy: { signing: f.signing } as GrNativeReviewHostPolicy,
    request: async (request) => connection(request, peer),
    close: () => {},
  });
  const gatehouse = createGatehouseRuntime({
    home,
    now,
    endorsementVerifier: nativePorts.verifier,
  });
  const { gate } = await gatehouse.submitIntent(f.signing.intent);
  const endorsement = (principalId: string, credentialId: string) =>
    createGatehouseEndorsementSubmission({
      gateId: gate.id,
      intentDigest: f.signing.intent.digest,
      principalId,
      credentialId,
      decision: "approve",
      issuedAt: now().toISOString(),
      expiresAt: f.signing.intent.expiresAt,
      assurance: {
        profile: "fixture",
        evidenceDigest: hash("fixture-evidence"),
        deviceBound: false,
        userPresence: false,
        userVerification: false,
      },
      proof: { profile: "fixture", signature: () => "fixture-signature" },
    });
  const reviewerEndorsement = endorsement(reviewer, f.signing.bindings.review.credentialId);
  const ownerEndorsement = endorsement(owner, "credential.owner");
  receipt = {
    schema: "gr.native-review-attempt.v0",
    outcome: "completed",
    nonce: "native_review_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    decision: "approve",
    gateId: gate.id,
    intentDigest: f.signing.intent.digest,
    signingPolicyDigest: fingerprintGatehouseValue(f.signing),
    bridgeClosureDigest,
    reviewer: { ...peer, uid: 994, gid: 984 },
    reservedAt: now().toISOString(),
    completedAt: now().toISOString(),
    endorsementDigest: fingerprintGatehouseValue(reviewerEndorsement),
  };
  await gatehouse.submitEndorsement(reviewerEndorsement);
  expect((await gatehouse.inspectGate(gate.id))?.effectiveStatus).toBe("partially-endorsed");
  await gatehouse.submitEndorsement(ownerEndorsement);
  expect(routes).toEqual([true, true]);
  const host = composeGrOwnerLaunchHost(f.policy, f.signing, {
    gatehouse,
    now,
    attemptId: "attempt.fixture-inspect",
    readCurrentOwner: async () => f.session,
    gitRuntime: {
      root: f.policy.custody.root,
      executable: "/usr/bin/git",
      closureFingerprint: f.signing.bindings.executorFingerprint,
      env: {
        GIT_AUTHOR_NAME: "Fixture",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      assertCurrent: async () => {},
    },
    reviewPorts: { ...nativePorts, now },
  });
  routes.length = 0;
  verified.length = 0;
  expect((await host.inspect()).gateStatus).toBe("quorum-satisfied");
  expect(routes.length).toBeGreaterThanOrEqual(4);
  expect(routes.every((held) => !held)).toBe(true);
  expect(verified).toEqual([ownerEndorsement.id, reviewerEndorsement.id]);
  const inspection = await gatehouse.inspectGate(gate.id);
  expect(inspection?.endorsements).toHaveLength(2);
  expect(inspection?.lease).toBeUndefined();
  expect(inspection?.consumption).toBeUndefined();
  expect(inspection?.execution).toBeUndefined();
  await expect(lstat(path.join(home, "gates", gate.id, ".lock"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("protected store wrapper checks placement before/after operations but does not block execution recording on Auth expiry", async () => {
  const f = await fixture();
  const runtime = createGatehouseRuntime({ home: path.join(f.root, "gatehouse"), now });
  let reads = 0,
    fail = false;
  const gate = guardGrOwnerGateLocation(runtime, async () => {
    reads++;
    if (fail) throw Error("custody changed");
  });
  const created = await gate.submitIntent(f.signing.intent);
  expect(reads).toBe(2);
  fail = true;
  await expect(gate.inspectGate(created.gate.id)).rejects.toThrow("custody changed");
  expect(reads).toBe(3);
  let recorded = false;
  const recorder = guardGrOwnerGateLocation(
    {
      ...runtime,
      recordExecution: async () => {
        recorded = true;
        throw Error("fixture reached durable recorder without Auth guard");
      },
    },
    async () => {},
  );
  await expect(
    recorder.recordExecution({} as Parameters<typeof runtime.recordExecution>[0]),
  ).rejects.toThrow("reached durable recorder");
  expect(recorded).toBe(true);
  await expect(assertGrOwnerGateHome(f.root)).rejects.toThrow("NOT_ADMITTED");
});

test("publication preparation requires explicit campaign data and exact native Auth/custody", async () => {
  const f = await fixture();
  const p = {
    schema: "gr.owner-publication.host.v0" as const,
    createdAt: f.policy.createdAt,
    expiresAt: f.policy.expiresAt,
    custody: { ...f.policy.custody, root: GR_OWNER_PUBLICATION_ROOT },
    links: [],
    ownerAuth: f.policy.ownerAuth,
    authPolicyDigest: hash("auth"),
    baseCommit: f.signing.bindings.plan.base.commit.oid,
    baseTree: f.signing.bindings.plan.base.tree.oid,
    baseBundleDigest: hash("base"),
    sourceManifestDigest: hash("source"),
    sourceTreeProofDigest: hash("proof"),
    expectedCandidateTree: f.signing.bindings.plan.frozen!.candidateTree.oid,
    campaign: { id: f.signing.bindings.plan.campaignId, ...f.signing.bindings.plan.scope },
  };
  assertGrOwnerPublicationPolicy(p);
  assertGrOwnerPublicationPolicy({
    ...p,
    custody: { ...p.custody, root: `${GR_OWNER_PUBLICATION_ROOT}-${p.expectedCandidateTree}` },
  });
  expect(() =>
    assertGrOwnerPublicationPolicy({
      ...p,
      custody: { ...p.custody, root: `${GR_OWNER_PUBLICATION_ROOT}-${"0".repeat(40)}` },
    }),
  ).toThrow();
  expect(p.campaign.paths).toEqual(f.signing.bindings.plan.scope.paths);
  expect(() =>
    assertGrOwnerPublicationPolicy({
      ...p,
      custody: { ...p.custody, root: "/home/producer/repo" },
    }),
  ).toThrow();
  expect(() =>
    assertGrOwnerPublicationPolicy({
      ...p,
      ownerAuth: { ...p.ownerAuth, author: { name: "other", email: "other@example.invalid" } },
    }),
  ).toThrow();
  expect(() =>
    assertGrOwnerPublicationPolicy({
      ...p,
      links: [{ path: "/home/producer/lib", target: "mutable" }],
    }),
  ).toThrow();
});

test("only the exact root-delegated native child may reach preparation, not a direct racer or replay", () => {
  const child: GrOwnerPreparationChild = {
    schema: "gr.owner-publication.child.v0",
    operation: "prepare-source",
    policyDigest: hash("policy"),
    root: GR_OWNER_PUBLICATION_ROOT,
    candidateTree: "a".repeat(40),
    bootId: "12345678-1234-1234-1234-123456789abc",
    childPid: 88,
    childStart: "123",
    parentPid: 77,
    parentStart: "100",
    lockDevice: 1,
    lockInode: 2,
  };
  const expected = {
    policyDigest: child.policyDigest,
    root: child.root,
    candidateTree: child.candidateTree,
    pid: 88,
    ppid: 77,
    parentUid: 0,
    childStart: "123",
    parentStart: "100",
    bootId: child.bootId,
    lock: { uid: 0, mode: 0o40755, dev: 1, ino: 2, directory: true },
  };
  let claims = 0;
  const enter = (observed: typeof expected) => {
    assertGrOwnerPreparationChild(child, observed);
    claims++;
  };
  expect(() => enter({ ...expected, pid: 99 })).toThrow("NOT_ADMITTED");
  expect(claims).toBe(0);
  enter(expected);
  expect(claims).toBe(1);
  for (const change of [
    { ppid: 1 },
    { parentUid: 995 },
    { childStart: "124" },
    { parentStart: "101" },
    { bootId: "87654321-1234-1234-1234-123456789abc" },
    { policyDigest: hash("other") },
    { candidateTree: "b".repeat(40) },
    { root: GR_OWNER_PUBLICATION_ROOT + "-other" },
    { lock: { ...expected.lock, ino: 3 } },
    { lock: { ...expected.lock, uid: 995 } },
    { lock: { ...expected.lock, mode: 0o40777 } },
    { lock: { ...expected.lock, directory: false } },
  ])
    expect(() => assertGrOwnerPreparationChild(child, { ...expected, ...change })).toThrow(
      "NOT_ADMITTED",
    );
});

test("source/producer startup refuses before courier, native policy or private store access", async () => {
  expect(await runGrOwnerLaunch(["--identity"])).toMatchObject({
    authenticationIssuer: false,
    signing: false,
    gitExecutionAdmitted: false,
  });
  let reads = 0;
  for (const args of [
    ["status"],
    ["prepare"],
    ["prepare-source"],
    ["endorse"],
    ["commit", "--interactive", "--apply"],
    ["push", "--interactive", "--apply"],
    ["push", "--plan", "/tmp/plan.json"],
  ]) {
    await expect(
      runGrOwnerLaunch(args, async () => {
        reads++;
        throw Error("courier must not be read");
      }),
    ).rejects.toThrow("NOT_ADMITTED");
  }
  expect(reads).toBe(0);
});
