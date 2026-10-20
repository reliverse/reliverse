import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  createGrNativeReviewBridge,
  parseGrNativeReviewRequest,
  type GrNativeReviewReceipt,
  type GrNativeReviewPeer,
} from "./native-review-bridge";
import type { GrCampaignReview } from "./review";
import {
  assertGrCampaignReviewerSigningPolicy,
  signGrCampaignReviewerDecision,
  type GrCampaignReviewerSigningPolicy,
  type GrCampaignReviewerSigningPorts,
} from "./reviewer-signing";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-reviewer-signing-"));
  roots.push(root);
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(
      [
        "git",
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
    if (r.exitCode !== 0) throw Error(r.stderr.toString());
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
      campaignId: "signing-fixture",
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
    description: "Source fixture only",
    capabilities: [
      {
        id: "fixture.check",
        title: "Check",
        description: "Fixture check",
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
  const executionFingerprint = "fixture-only-quality-closure";
  const quality = await runQualityCandidateVerification(createQualityRegistry([suite]), {
    runId: "fixture-quality",
    createdAt: "2026-10-18T00:00:00.000Z",
    target: { kind: "repository", id: "fixture", root, snapshot: candidateFingerprint },
    candidateFingerprint,
    executionFingerprint,
    observeCandidateFingerprint: async () => candidateFingerprint,
    observeExecutionFingerprint: async () => executionFingerprint,
    checks: [
      {
        request: { capabilityId: "fixture.check", providerId: "fixture.check.builtin" },
        suiteFingerprint: suite.manifestFingerprint,
        providerVersion: "1.0.0",
      },
    ],
  });
  const owner = `prn_${"a".repeat(32)}`,
    reviewer = `prn_${"b".repeat(32)}`;
  const evidence = {
    schema: "gr.campaign-review-evidence.v0" as const,
    campaignFingerprint: plan.campaignFingerprint,
    candidateTree: plan.frozen!.candidateTree.oid,
    reviewerPrincipalId: reviewer,
    manifestDigest: fingerprintGatehouseValue("manifest"),
    treeProofDigest: fingerprintGatehouseValue("proof"),
    reportDigest: fingerprintGatehouseValue("report"),
    proofScope: "candidate-source-only" as const,
  };
  const review: GrCampaignReview = {
    ownerPrincipalId: owner,
    reviewerPrincipalId: reviewer,
    credentialId: "credential.reviewer",
    publicKeyDigest: fingerprintGatehouseValue("key"),
    actorBindingDigest: fingerprintGatehouseValue("binding"),
    executionIdentityDigest: fingerprintGatehouseValue("execution"),
    evidenceDigest: fingerprintGatehouseValue(evidence),
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
    executionFingerprint,
    executorFingerprint: "fixture-GR-closure",
    review,
  };
  let time = Date.parse("2026-10-18T00:00:00.000Z"),
    active = true,
    signs = 0,
    checks = 0;
  const now = () => new Date(time);
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
      expiresAt: "2026-10-18T01:00:00.000Z",
      requester: { id: owner, kind: "human" },
      actor: { id: "service.gr", kind: "service" },
      accountableSystem: { id: "service.gr", kind: "service" },
      policy: {
        id: "policy.fixture",
        digest: fingerprintGatehouseValue("fixture-policy"),
        authority: {
          kind: "all-of",
          independence: "distinct-perspectives",
          principalIds: [owner, reviewer],
        },
      },
    },
  });
  const gateId = (await gatehouse.submitIntent(intent)).gate.id;
  const policy: GrCampaignReviewerSigningPolicy = {
    schema: "gr.campaign-reviewer-signing-policy.v0",
    bindings,
    evidence,
    intent,
    credentialExpiresAt: "2026-10-19T00:00:00.000Z",
  };
  const sign = (
    input: {
      credentialId: string;
      gateId: string;
      intentDigest: string;
      decision: "approve" | "deny";
      expiresAt: string;
    },
    principalId: string,
    secret: string,
  ) =>
    createGatehouseEndorsementSubmission({
      ...input,
      principalId,
      issuedAt: now().toISOString(),
      assurance: {
        profile: "fixture",
        evidenceDigest: fingerprintGatehouseValue("fixture"),
        deviceBound: false,
        userPresence: false,
        userVerification: false,
      },
      proof: {
        profile: "fixture",
        signature: (signedDigest) =>
          signStaticGatehouseEndorsement({
            credentialId: input.credentialId,
            signedDigest,
            secret,
          }),
      },
    });
  const ports: GrCampaignReviewerSigningPorts = {
    now,
    verifier,
    assertCurrent: async () => {
      checks++;
      if (!active) throw Error("fixture-revoked");
    },
    inspectGate: async (id) => (await gatehouse.inspectGate(id)) ?? null,
    sign: async (input) => {
      signs++;
      return sign(input, reviewer, "fixture-reviewer");
    },
  };
  return {
    policy,
    ports,
    gateId,
    gatehouse,
    signs: () => signs,
    checks: () => checks,
    revoke: () => {
      active = false;
    },
    expire: () => {
      time = Date.parse(intent.expiresAt);
    },
    endorseOwner: () =>
      gatehouse.submitEndorsement(
        sign(
          {
            credentialId: "credential.owner",
            gateId,
            intentDigest: intent.digest,
            decision: "approve",
            expiresAt: intent.expiresAt,
          },
          owner,
          "fixture-owner",
        ),
      ),
  };
}

test("exact reviewer signing returns only verified courier; canonical submission and lease remain separate", async () => {
  const x = await fixture();
  const result = await signGrCampaignReviewerDecision(x.policy, "approve", x.ports);
  expect(x.signs()).toBe(1);
  expect(x.checks()).toBe(3);
  expect(result).toMatchObject({
    credentialCreated: false,
    gateSubmitted: false,
    leaseConsumed: false,
    campaignApproved: false,
  });
  expect((await x.gatehouse.inspectGate(x.gateId))?.endorsements).toHaveLength(0);
  await x.endorseOwner();
  await x.gatehouse.submitEndorsement(result.endorsement);
  expect((await x.gatehouse.inspectGate(x.gateId))?.effectiveStatus).toBe("quorum-satisfied");
  await expect(signGrCampaignReviewerDecision(x.policy, "approve", x.ports)).rejects.toThrow(
    "SIGNING_UNVERIFIED",
  );
  expect(x.signs()).toBe(1);
});

test("explicit denial grants no Git authority", async () => {
  const x = await fixture();
  const result = await signGrCampaignReviewerDecision(x.policy, "deny", x.ports);
  expect(result.endorsement.decision).toBe("deny");
  expect(result.campaignApproved).toBe(false);
  expect((await x.gatehouse.inspectGate(x.gateId))?.consumption).toBeUndefined();
});

test("signing rejects changed evidence/candidate, credential expiry, requester and owner-only policy", async () => {
  const x = await fixture();
  const variants = [
    {
      ...x.policy,
      evidence: { ...x.policy.evidence, reportDigest: fingerprintGatehouseValue("other report") },
    },
    { ...x.policy, evidence: { ...x.policy.evidence, candidateTree: "0".repeat(40) } },
    { ...x.policy, credentialExpiresAt: "2026-10-17T00:00:00.000Z" },
    {
      ...x.policy,
      intent: createGrCampaignActionIntent({
        ...x.policy.bindings,
        authority: {
          ...x.policy.intent,
          requester: { id: x.policy.bindings.review.reviewerPrincipalId, kind: "agent" },
        },
      }),
    },
    {
      ...x.policy,
      intent: createGrCampaignActionIntent({
        ...x.policy.bindings,
        authority: {
          ...x.policy.intent,
          policy: {
            ...x.policy.intent.policy,
            authority: {
              kind: "all-of",
              independence: "distinct-perspectives",
              principalIds: [x.policy.bindings.review.ownerPrincipalId],
            },
          },
        },
      }),
    },
  ];
  for (const p of variants) expect(() => assertGrCampaignReviewerSigningPolicy(p)).toThrow();
  expect(x.signs()).toBe(0);
});

test("revocation/expiry before signing and revocation during signing release no result", async () => {
  const x = await fixture();
  x.revoke();
  await expect(signGrCampaignReviewerDecision(x.policy, "approve", x.ports)).rejects.toThrow(
    "fixture-revoked",
  );
  expect(x.signs()).toBe(0);
  const y = await fixture();
  y.expire();
  await expect(signGrCampaignReviewerDecision(y.policy, "approve", y.ports)).rejects.toThrow();
  expect(y.signs()).toBe(0);
  const z = await fixture();
  await expect(
    signGrCampaignReviewerDecision(z.policy, "approve", {
      ...z.ports,
      sign: async (input) => {
        const signed = await z.ports.sign(input);
        z.revoke();
        return signed;
      },
    }),
  ).rejects.toThrow("fixture-revoked");
  expect(z.signs()).toBe(1);
});

test("post-verification revocation or substituted verifier output releases no result", async () => {
  const x = await fixture();
  await expect(
    signGrCampaignReviewerDecision(x.policy, "approve", {
      ...x.ports,
      verifier: {
        id: x.ports.verifier.id,
        verify: async (input) => {
          const verified = await x.ports.verifier.verify(input);
          x.revoke();
          return verified;
        },
      },
    }),
  ).rejects.toThrow("fixture-revoked");
  expect(x.signs()).toBe(1);
  const y = await fixture();
  await expect(
    signGrCampaignReviewerDecision(y.policy, "approve", {
      ...y.ports,
      verifier: {
        id: y.ports.verifier.id,
        verify: async (input) => ({ ...(await y.ports.verifier.verify(input)), decision: "deny" }),
      },
    }),
  ).rejects.toThrow("SIGNING_UNVERIFIED");
  expect(y.signs()).toBe(1);
});

test("missing canonical Gate or substituted signing payload fails closed without retry", async () => {
  const x = await fixture();
  await expect(
    signGrCampaignReviewerDecision(x.policy, "approve", {
      ...x.ports,
      inspectGate: async () => null,
    }),
  ).rejects.toThrow();
  expect(x.signs()).toBe(0);
  await expect(
    signGrCampaignReviewerDecision(x.policy, "approve", {
      ...x.ports,
      sign: async (input) =>
        x.ports.sign({ ...input, intentDigest: fingerprintGatehouseValue("foreign intent") }),
    }),
  ).rejects.toThrow();
  expect(x.signs()).toBe(1);
});

async function bridgeFixture() {
  const f = await fixture();
  let reservation: GrNativeReviewReceipt | undefined,
    completion: GrNativeReviewReceipt | undefined,
    held = false,
    sealed = false,
    reservations = 0;
  const journal = {
    reserve: async (r: GrNativeReviewReceipt) => {
      if (reservation) throw Error("fixture existing attempt");
      reservation = structuredClone(r);
      reservations++;
    },
    complete: async (r: GrNativeReviewReceipt) => {
      if (held || completion || reservation?.nonce !== r.nonce) throw Error("fixture held");
      completion = structuredClone(r);
    },
    seal: async (nonce: string) => {
      if (held || sealed || completion?.nonce !== nonce) throw Error("fixture unsealed/held");
      sealed = true;
    },
    hold: async (nonce: string) => {
      if (reservation?.nonce !== nonce) throw Error("foreign claim");
      held = true;
    },
    read: async () => {
      if (held) throw Error("fixture held");
      return sealed && completion ? structuredClone(completion) : undefined;
    },
  };
  const peer: GrNativeReviewPeer = {
    uid: 994,
    gid: 984,
    pid: 1234,
    instance: "1234:5678",
    executableDigest: fingerprintGatehouseValue("fixture signer"),
  };
  const ownerPeer: GrNativeReviewPeer = {
    uid: 995,
    gid: 985,
    pid: 2345,
    instance: "2345:6789",
    executableDigest: fingerprintGatehouseValue("fixture owner"),
  };
  const ports = {
    now: f.ports.now,
    assertCurrent: () => f.ports.assertCurrent(f.policy),
    inspectGate: () => f.ports.inspectGate(f.gateId),
    verifier: f.ports.verifier,
    journal,
  };
  const input = {
    signing: f.policy,
    bridgeClosureDigest: fingerprintGatehouseValue("fixture root closure"),
    expiresAt: "2026-10-18T00:15:00Z",
  };
  const bridge = createGrNativeReviewBridge(input, ports);
  const sign = () =>
    f.ports.sign({
      credentialId: f.policy.bindings.review.credentialId,
      gateId: f.gateId,
      intentDigest: f.policy.intent.digest,
      decision: "approve",
      expiresAt: f.policy.intent.expiresAt,
    });
  return {
    ...f,
    bridge,
    ports,
    input,
    peer,
    ownerPeer,
    sign,
    state: () => ({ reservation, completion, held, sealed, reservations }),
  };
}

test("native bridge binds process instance and endorsement without signing, submitting or consuming Gate authority", async () => {
  const f = await bridgeFixture(),
    reviewer = f.bridge.connection();
  const observed: (GrNativeReviewPeer | undefined)[] = [];
  const inspect = f.ports.inspectGate;
  f.ports.inspectGate = async (owner?: GrNativeReviewPeer) => {
    observed.push(owner);
    return inspect();
  };
  expect((await reviewer({ operation: "inspect" }, f.peer)).operation).toBe("inspect");
  expect(observed.at(-1)).toBeUndefined();
  expect(f.state().reservations).toBe(0);
  const begin = await reviewer({ operation: "begin", decision: "approve" }, f.peer);
  const e = await f.sign();
  expect(
    (await reviewer({ operation: "verify", nonce: begin.nonce as string, endorsement: e }, f.peer))
      .operation,
  ).toBe("verify");
  await reviewer({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer);
  expect(f.state().completion?.outcome).toBe("completed");
  expect(f.state().sealed).toBe(false);
  await expect(
    f.bridge.connection()({ operation: "verify-courier", endorsement: e }, f.ownerPeer),
  ).rejects.toThrow("BRIDGE_REFUSED");
  await reviewer.seal();
  expect(f.state().sealed).toBe(true);
  expect(f.state().reservations).toBe(1);
  expect((await f.gatehouse.inspectGate(f.gateId))?.endorsements).toHaveLength(0);
  await expect(f.bridge.connection()({ operation: "current" }, f.ownerPeer)).rejects.toThrow(
    "BRIDGE_REFUSED",
  );
  // Owner receives only a verified public courier; Gatehouse persists it separately.
  const verified = await f.bridge.connection()(
    { operation: "verify-courier", endorsement: e },
    f.ownerPeer,
  );
  expect(verified.operation).toBe("verify-courier");
  expect(observed.at(-1)).toEqual(f.ownerPeer);
  await f.gatehouse.submitEndorsement(e);
  expect((await f.bridge.connection()({ operation: "current" }, f.ownerPeer)).operation).toBe(
    "current",
  );
  expect(observed.at(-1)).toBeUndefined();
  expect((await f.gatehouse.inspectGate(f.gateId))?.consumption).toBeUndefined();
});

test("concurrent hold invalidates stale owner journal reads before response publication", async () => {
  for (const operation of ["current", "verify-courier"] as const) {
    const f = await bridgeFixture();
    let release!: () => void, entered!: () => void;
    const paused = new Promise<void>((r) => {
      entered = r;
    });
    const resume = new Promise<void>((r) => {
      release = r;
    });
    const original = f.ports.journal.read;
    const bridge = createGrNativeReviewBridge(f.input, {
      ...f.ports,
      journal: {
        ...f.ports.journal,
        read: async () => {
          const stale = await original();
          entered();
          await resume;
          return stale;
        },
        hold: async () => {
          throw Error("fixture hold persistence unavailable");
        },
      },
    });
    const reviewer = bridge.connection();
    const begin = await reviewer({ operation: "begin", decision: "approve" }, f.peer);
    const e = await f.sign();
    await reviewer({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer);
    await reviewer.seal();
    await f.gatehouse.submitEndorsement(e);
    const owner = bridge.connection();
    const response = owner(
      operation === "current" ? { operation } : { operation, endorsement: e },
      f.ownerPeer,
    );
    void response.catch(() => {});
    await paused;
    await expect(reviewer.hold()).rejects.toThrow("persistence unavailable");
    release();
    await expect(response).rejects.toThrow("BRIDGE_REFUSED");
    expect(() => owner.assertPublishable()).toThrow("BRIDGE_REFUSED");
  }
});

test("hold after core result invalidates the host's final synchronous publication check", async () => {
  const f = await bridgeFixture(),
    reviewer = f.bridge.connection();
  const begin = await reviewer({ operation: "begin", decision: "approve" }, f.peer);
  const e = await f.sign();
  await reviewer({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer);
  await reviewer.seal();
  const owner = f.bridge.connection();
  expect(
    (await owner({ operation: "verify-courier", endorsement: e }, f.ownerPeer)).operation,
  ).toBe("verify-courier");
  owner.assertPublishable();
  await reviewer.hold();
  expect(() => owner.assertPublishable()).toThrow("BRIDGE_REFUSED");
});

test("signature alone cannot claim native provenance and owner cannot drive reviewer signing phases", async () => {
  const f = await bridgeFixture(),
    e = await f.sign();
  await expect(
    f.bridge.connection()({ operation: "verify-courier", endorsement: e }, f.ownerPeer),
  ).rejects.toThrow("BRIDGE_REFUSED");
  await expect(
    f.bridge.connection()({ operation: "begin", decision: "approve" }, f.ownerPeer),
  ).rejects.toThrow("BRIDGE_REFUSED");
  await expect(f.bridge.connection()({ operation: "current" }, f.peer)).rejects.toThrow(
    "BRIDGE_REFUSED",
  );
  expect(f.state().reservations).toBe(0);
});

test("peer PID/starttime substitution holds the original claim and cannot be resumed on another connection", async () => {
  const f = await bridgeFixture(),
    c = f.bridge.connection();
  const begin = await c({ operation: "begin", decision: "approve" }, f.peer),
    e = await f.sign();
  await expect(
    c(
      { operation: "finish", nonce: begin.nonce as string, endorsement: e },
      { ...f.peer, instance: "1234:changed" },
    ),
  ).rejects.toThrow("BRIDGE_REFUSED");
  expect(f.state().held).toBe(true);
  await expect(
    f.bridge.connection()({ operation: "begin", decision: "approve" }, f.peer),
  ).rejects.toThrow("BRIDGE_REFUSED");
  expect(f.state().reservations).toBe(1);
  expect(f.state().completion).toBeUndefined();
});

test("nonce borrowing, wrong decision and current custody revocation cannot release a completed proof", async () => {
  for (const mode of ["nonce", "decision", "revocation"]) {
    const f = await bridgeFixture(),
      c = f.bridge.connection();
    const begin = await c(
        { operation: "begin", decision: mode === "decision" ? "deny" : "approve" },
        f.peer,
      ),
      e = await f.sign();
    if (mode === "revocation") f.revoke();
    await expect(
      c(
        {
          operation: "finish",
          nonce:
            mode === "nonce"
              ? "native_review_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              : (begin.nonce as string),
          endorsement: e,
        },
        f.peer,
      ),
    ).rejects.toThrow("BRIDGE_REFUSED");
    expect(f.state().held).toBe(true);
    expect(f.state().completion).toBeUndefined();
  }
});

test("completion publication uncertainty remains held even if completion bytes were written", async () => {
  const f = await bridgeFixture(),
    original = f.ports.journal.complete;
  const bridge = createGrNativeReviewBridge(f.input, {
    ...f.ports,
    journal: {
      ...f.ports.journal,
      complete: async (r) => {
        await original(r);
        throw Error("fixture fsync failure");
      },
    },
  });
  const c = bridge.connection(),
    begin = await c({ operation: "begin", decision: "approve" }, f.peer),
    e = await f.sign();
  await expect(
    c({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer),
  ).rejects.toThrow("BRIDGE_REFUSED");
  expect(f.state().completion?.outcome).toBe("completed");
  expect(f.state().held).toBe(true);
  await f.gatehouse.submitEndorsement(e);
  await expect(bridge.connection()({ operation: "current" }, f.ownerPeer)).rejects.toThrow(
    "BRIDGE_REFUSED",
  );
});

test("post-peer failure remains fenced even when persisting a held marker fails", async () => {
  const f = await bridgeFixture();
  const bridge = createGrNativeReviewBridge(f.input, {
    ...f.ports,
    journal: {
      ...f.ports.journal,
      hold: async () => {
        throw Error("fixture disk full");
      },
    },
  });
  const c = bridge.connection(),
    begin = await c({ operation: "begin", decision: "approve" }, f.peer),
    e = await f.sign();
  await c({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer);
  await expect(c.hold()).rejects.toThrow("disk full");
  await expect(c.seal()).rejects.toThrow("BRIDGE_REFUSED");
  await f.gatehouse.submitEndorsement(e);
  expect(f.state().completion?.outcome).toBe("completed");
  expect(f.state().sealed).toBe(false);
  await expect(bridge.connection()({ operation: "current" }, f.ownerPeer)).rejects.toThrow(
    "BRIDGE_REFUSED",
  );
});

test("seal failure cannot be retried or replaced by completion bytes", async () => {
  const f = await bridgeFixture();
  const bridge = createGrNativeReviewBridge(f.input, {
    ...f.ports,
    journal: {
      ...f.ports.journal,
      seal: async () => {
        throw Error("fixture seal failure");
      },
    },
  });
  const c = bridge.connection(),
    begin = await c({ operation: "begin", decision: "approve" }, f.peer),
    e = await f.sign();
  await c({ operation: "finish", nonce: begin.nonce as string, endorsement: e }, f.peer);
  await expect(c.seal()).rejects.toThrow("BRIDGE_REFUSED");
  await expect(c.seal()).rejects.toThrow("BRIDGE_REFUSED");
  expect(f.state().held).toBe(true);
  expect(f.state().sealed).toBe(false);
});

test("native bridge expiry and malformed/authority-bearing wire requests fail closed", async () => {
  const f = await bridgeFixture();
  f.expire();
  await expect(f.bridge.connection()({ operation: "inspect" }, f.peer)).rejects.toThrow(
    "BRIDGE_REFUSED",
  );
  for (const text of [
    '{"operation":"inspect","pid":1234}\n',
    '{"operation":"begin","decision":"approve","uid":994}\n',
    '{"operation":"sign"}\n',
    '{"operation":"inspect"}\n{"operation":"current"}\n',
    '{"operation":"inspect"}',
    "x".repeat(16385),
  ]) {
    expect(() => parseGrNativeReviewRequest(new TextEncoder().encode(text))).toThrow();
  }
  expect(parseGrNativeReviewRequest(new TextEncoder().encode('{"operation":"inspect"}\n'))).toEqual(
    { operation: "inspect" },
  );
});
