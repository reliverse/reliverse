import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AuthSessionV0 } from "@reliverse/auth";
import {
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  createStaticGatehouseEndorsementVerifier,
  signStaticGatehouseEndorsement,
} from "@reliverse/gatehouse-runtime/testkit";
import { createGrCampaignPlan, freezeGrCampaignPlan } from "@reliverse/gr";
import {
  createQualityRegistry,
  defineQualitySuite,
  runQualityCandidateVerification,
} from "@reliverse/quality";

import { createGrCampaignActionIntent } from "./campaign";
import {
  createGrAuthenticatedReviewedOwnerHost,
  assertGrOwnerExecutionSession,
} from "./owner-authorization";
import type { GrCampaignReview } from "./review";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const owner = `prn_${"a".repeat(32)}` as const;
const reviewer = `prn_${"b".repeat(32)}` as const;
const author = { name: "Fixture", email: "fixture@example.invalid" };
const sessionId = "auth_session_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = () => new Date("2026-10-18T20:00:00Z");
const digest = (v: string) => fingerprintGatehouseValue(v);
async function fixture(approve = true) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-owner-authz-"));
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
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git("init", "-q");
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await writeFile(path.join(root, "core.txt"), "base\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  const plan = await freezeGrCampaignPlan({
    root,
    plan: await createGrCampaignPlan({
      root,
      campaignId: "owner-auth-fixture",
      baseRevision: "HEAD",
      paths: ["core.txt"],
      commits: [{ id: "core", title: "fixture candidate", paths: ["core.txt"] }],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const suite = defineQualitySuite({
    id: "fixture",
    title: "Fixture",
    description: "Not production RQ",
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
        title: "Engine",
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
    target: { kind: "repository", id: "fixture", root, snapshot: candidateFingerprint },
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
  const review: GrCampaignReview = {
    ownerPrincipalId: owner,
    reviewerPrincipalId: reviewer,
    credentialId: "credential.reviewer",
    publicKeyDigest: digest("key"),
    actorBindingDigest: digest("binding"),
    executionIdentityDigest: digest("identity"),
    evidenceDigest: digest("evidence"),
  };
  const bindings = {
    plan,
    action: {
      kind: "commit" as const,
      commitId: "core",
      expectedBeforeCommit: plan.base.commit.oid,
    },
    quality,
    qualityPolicyFingerprint: quality.policyFingerprint,
    executionFingerprint: "fixture-quality",
    executorFingerprint: "fixture-owner-closure",
    review,
  };
  const verifier = createStaticGatehouseEndorsementVerifier({
    credentials: {
      "credential.owner": { principalId: owner, secret: "fixture-owner" },
      "credential.reviewer": { principalId: reviewer, secret: "fixture-reviewer" },
    },
    now,
  });
  const gatehouse = createGatehouseRuntime({
    home: path.join(root, ".private", "gatehouse"),
    endorsementVerifier: verifier,
    now,
  });
  const intent = createGrCampaignActionIntent({
    ...bindings,
    authority: {
      createdAt: now().toISOString(),
      expiresAt: "2026-10-18T21:00:00Z",
      requester: { id: owner, kind: "human" },
      actor: { id: "service.gr", kind: "service" },
      accountableSystem: { id: "service.gr", kind: "service" },
      policy: {
        id: "policy.fixture",
        digest: digest("policy"),
        authority: {
          kind: "all-of",
          independence: "distinct-perspectives",
          principalIds: [owner, reviewer],
        },
      },
    },
  });
  const gateId = (await gatehouse.submitIntent(intent)).gate.id;
  const endorse = async (id: string, credentialId: string, secret: string) => {
    await gatehouse.submitEndorsement(
      createGatehouseEndorsementSubmission({
        gateId,
        intentDigest: intent.digest,
        principalId: id,
        credentialId,
        decision: "approve",
        issuedAt: now().toISOString(),
        expiresAt: intent.expiresAt,
        nonce: `nonce_${id}`,
        assurance: {
          profile: "fixture",
          evidenceDigest: digest("fixture"),
          deviceBound: false,
          userPresence: false,
          userVerification: false,
        },
        proof: {
          profile: "fixture",
          signature: (signedDigest) =>
            signStaticGatehouseEndorsement({ credentialId, signedDigest, secret }),
        },
      }),
    );
  };
  if (approve) {
    await endorse(owner, "credential.owner", "fixture-owner");
    await endorse(reviewer, "credential.reviewer", "fixture-reviewer");
  }
  let active = true,
    reads = 0,
    nativeChecks = 0,
    consumed = 0;
  let session: AuthSessionV0 | undefined = {
    schema: "reliverse.auth.session.v0",
    id: sessionId,
    principal: { id: owner, kind: "human" },
    client: { id: "os-user.uid-995", kind: "confidential" },
    issuer: "gr.protected-owner-terminal",
    scopes: ["identity.observe"],
    audiences: ["gr.owner-control"],
    resources: ["github:reliverse/reliverse"],
    assurance: "verified",
    status: "active",
    createdAt: now().toISOString(),
    expiresAt: "2026-10-18T22:00:00Z",
  };
  let afterConsumption = () => {};
  const input = {
    ...bindings,
    contextRoot: root,
    ownerUid: 995,
    gateId,
    attemptId: "attempt:fixture-owner",
    ownerAuth: { principalId: owner, sessionId, author },
    gitRuntime: {
      root,
      executable: "/usr/bin/git",
      closureFingerprint: bindings.executorFingerprint,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/",
        LC_ALL: "C",
        GIT_AUTHOR_NAME: author.name,
        GIT_COMMITTER_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_EMAIL: author.email,
      },
      assertCurrent: async () => {
        nativeChecks++;
      },
    },
    gatehouse: {
      ...gatehouse,
      consumeLease: async (request: Parameters<typeof gatehouse.consumeLease>[0]) => {
        consumed++;
        const result = await gatehouse.consumeLease(request);
        afterConsumption();
        return result;
      },
    },
    reviewPorts: {
      now,
      verifier,
      assertCustodyCurrent: async () => {
        if (!active) throw new Error("REVIEW_CUSTODY_REVOKED");
      },
    },
  };
  const ports = {
    now,
    readCurrentOwner: async () => {
      reads++;
      return session && structuredClone(session);
    },
  };
  const host = () => createGrAuthenticatedReviewedOwnerHost(input, ports);
  return {
    input,
    ports,
    host,
    git,
    gatehouse,
    gateId,
    setSession: (v: AuthSessionV0 | undefined) => {
      session = v;
    },
    getSession: () => session!,
    revokeReview: () => {
      active = false;
    },
    afterConsumption: (fn: () => void) => {
      afterConsumption = fn;
    },
    counts: () => ({ reads, nativeChecks, consumed }),
  };
}

test("Auth plus exact independent quorum executes one fixture commit and exposes no CapRef", async () => {
  const f = await fixture(),
    h = f.host();
  expect((await h.inspect()).gateStatus).toBe("quorum-satisfied");
  expect(f.counts().consumed).toBe(0);
  expect("capRef" in h).toBe(false);
  await h.execute();
  expect(f.counts().consumed).toBe(1);
  expect(f.counts().reads).toBeGreaterThan(4);
  expect(f.git("show", "HEAD:core.txt")).toBe("candidate");
  expect((await f.gatehouse.inspectGate(f.gateId))?.execution?.outcome).toBe("completed");
  await expect(h.execute()).rejects.toThrow("AUTH_UNVERIFIED");
  expect(f.counts().consumed).toBe(1);
});
test("identity-only Auth cannot replace missing owner/reviewer Gate approval", async () => {
  const f = await fixture(false),
    before = f.git("rev-parse", "HEAD"),
    h = f.host();
  expect((await h.inspect()).gateStatus).toBe("pending");
  await expect(h.execute()).rejects.toThrow("AUTH_UNVERIFIED");
  expect(f.counts().consumed).toBe(0);
  expect(f.git("rev-parse", "HEAD")).toBe(before);
});
test("wrong issuer/audience/resource/session/Principal/expiry denies before lease consumption", async () => {
  const f = await fixture(),
    good = structuredClone(f.getSession());
  for (const changed of [
    undefined,
    { ...good, audiences: ["rvs.owner-control"] },
    { ...good, resources: ["other"] },
    { ...good, issuer: "rvs.protected-owner-ssh" },
    { ...good, id: "auth_session_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { ...good, principal: { id: reviewer, kind: "human" as const } },
    { ...good, expiresAt: now().toISOString() },
    { ...good, scopes: ["repo.commit"] },
  ]) {
    f.setSession(changed);
    await expect(f.host().execute()).rejects.toThrow("AUTH_UNVERIFIED");
  }
  expect(f.counts().consumed).toBe(0);
});
test("review custody revocation is not bypassed by a current owner Auth session", async () => {
  const f = await fixture();
  f.revokeReview();
  await expect(f.host().execute()).rejects.toThrow("REVIEW_CUSTODY_REVOKED");
  expect(f.counts().consumed).toBe(0);
});
test("Auth revocation after consumption blocks Git and preserves uncertain execution without replay", async () => {
  const f = await fixture(),
    before = f.git("rev-parse", "HEAD"),
    h = f.host();
  f.afterConsumption(() => f.setSession(undefined));
  await expect(h.execute()).rejects.toThrow("AUTH_UNVERIFIED");
  expect(f.counts().consumed).toBe(1);
  expect(f.git("rev-parse", "HEAD")).toBe(before);
  expect((await f.gatehouse.inspectGate(f.gateId))?.execution?.outcome).toBe("outcome-unknown");
  await expect(h.execute()).rejects.toThrow("AUTH_UNVERIFIED");
  expect(f.counts().consumed).toBe(1);
});
test("concurrent execution cannot create a second internal grant or consume twice", async () => {
  const f = await fixture(),
    h = f.host();
  const results = await Promise.allSettled([h.execute(), h.execute()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.counts().consumed).toBe(1);
});
test("public author, owner identity and native runtime context are pinned before composing a host", async () => {
  const f = await fixture();
  expect(() =>
    createGrAuthenticatedReviewedOwnerHost({ ...f.input, ownerUid: 1000 }, f.ports),
  ).toThrow("AUTH_UNVERIFIED");
  expect(() =>
    createGrAuthenticatedReviewedOwnerHost(
      { ...f.input, ownerAuth: { ...f.input.ownerAuth, principalId: reviewer } },
      f.ports,
    ),
  ).toThrow("AUTH_UNVERIFIED");
  expect(() =>
    createGrAuthenticatedReviewedOwnerHost(
      {
        ...f.input,
        gitRuntime: {
          ...f.input.gitRuntime,
          env: { ...f.input.gitRuntime.env, GIT_AUTHOR_EMAIL: "other@example.invalid" },
        },
      },
      f.ports,
    ),
  ).toThrow("AUTH_UNVERIFIED");
  expect(() =>
    assertGrOwnerExecutionSession(f.getSession(), f.input.ownerAuth, new Date(Number.NaN)),
  ).toThrow("AUTH_UNVERIFIED");
});
