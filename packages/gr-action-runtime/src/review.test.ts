import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  createStaticGatehouseEndorsementVerifier,
  signStaticGatehouseEndorsement,
} from "@reliverse/gatehouse-runtime/testkit";

import {
  guardGrCampaignReviewGatehouse,
  normalizeGrCampaignReview,
  type GrCampaignReview,
} from "./review";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const owner = `prn_${"a".repeat(32)}`,
  reviewer = `prn_${"b".repeat(32)}`;
const digest = (value: string) => fingerprintGatehouseValue(value);
const review: GrCampaignReview = {
  ownerPrincipalId: owner,
  reviewerPrincipalId: reviewer,
  credentialId: "credential.reviewer",
  publicKeyDigest: digest("fixture-key"),
  actorBindingDigest: digest("fixture-binding"),
  executionIdentityDigest: digest("fixture-execution"),
  evidenceDigest: digest("fixture-review-results"),
};
async function fixture(
  options: { ownerOnly?: boolean; alternativeCredential?: boolean; pending?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-reviewed-gate-"));
  roots.push(root);
  let time = Date.parse("2026-10-18T00:00:00Z"),
    custody = true,
    credentialActive = true;
  const now = () => new Date(time);
  const credentials = {
    "credential.owner": { principalId: owner, secret: "fixture-owner-only" },
    "credential.reviewer": { principalId: reviewer, secret: "fixture-reviewer-only" },
    "credential.alternative": { principalId: reviewer, secret: "fixture-alternative-only" },
  };
  const signatureVerifier = createStaticGatehouseEndorsementVerifier({ credentials, now });
  const verifier = {
    id: signatureVerifier.id,
    verify(input: Parameters<typeof signatureVerifier.verify>[0]) {
      if (!credentialActive) throw Error("fixture-credential-revoked");
      return signatureVerifier.verify(input);
    },
  };
  const runtime = createGatehouseRuntime({ home: root, endorsementVerifier: verifier, now });
  const intent = createGatehouseActionIntent({
    createdAt: now().toISOString(),
    expiresAt: "2026-10-18T01:00:00Z",
    requester: { id: owner, kind: "human" },
    actor: { id: owner, kind: "human" },
    accountableSystem: { id: "service.gr", kind: "service" },
    action: { kind: "gr.campaign.commit", effectClass: "git.commit", authorityImpact: "none" },
    target: {
      kind: "repository",
      id: "fixture",
      parameters: { candidateTree: "fixture-tree", review: { ...review } },
    },
    preconditions: { candidateTree: "fixture-tree", review: { ...review } },
    requestedCapability: {
      capability: "gr.campaign.commit",
      executorClass: "gr.campaign.v0",
      scope: { fixture: true },
    },
    policy: {
      id: "policy.fixture",
      digest: digest("fixture-policy"),
      authority: {
        kind: "all-of",
        independence: "distinct-perspectives",
        principalIds: options.ownerOnly ? [owner] : [owner, reviewer],
      },
    },
    presentation: {
      title: "Fixture",
      summary: "Not native admission",
      consequences: ["Fixture only"],
    },
    risk: "high",
    reversibility: "reversible",
  });
  const gateId = (await runtime.submitIntent(intent)).gate.id;
  if (!options.pending)
    for (const principalId of intent.policy.authority.principalIds) {
      const credentialId =
        principalId === owner
          ? "credential.owner"
          : options.alternativeCredential
            ? "credential.alternative"
            : "credential.reviewer";
      await runtime.submitEndorsement(
        createGatehouseEndorsementSubmission({
          gateId,
          intentDigest: intent.digest,
          principalId,
          credentialId,
          decision: "approve",
          issuedAt: now().toISOString(),
          expiresAt: "2026-10-18T00:30:00Z",
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
              signStaticGatehouseEndorsement({
                credentialId,
                signedDigest,
                secret: credentials[credentialId].secret,
              }),
          },
        }),
      );
    }
  const ports = {
    now,
    verifier,
    assertCustodyCurrent: async () => {
      if (!custody) throw Error("fixture-custody-revoked");
    },
  };
  const guarded = guardGrCampaignReviewGatehouse(runtime, review, ports);
  const issue = () =>
    guarded.issueLease({ gateId, preconditionDigest: intent.preconditions.digest });
  return {
    root,
    runtime,
    intent,
    gateId,
    guarded,
    issue,
    ports,
    expire: () => {
      time += 31 * 60 * 1000;
    },
    revokeCustody: () => {
      custody = false;
    },
    revokeCredential: () => {
      credentialActive = false;
    },
  };
}
function consume(
  lease: Awaited<ReturnType<ReturnType<typeof guardGrCampaignReviewGatehouse>["issueLease"]>>,
) {
  return {
    attemptId: "attempt.fixture",
    leaseId: lease.id,
    intentDigest: lease.intentDigest,
    capability: lease.capability,
    executorClass: lease.executorClass,
    preconditionDigest: lease.preconditionDigest,
    scopeDigest: lease.scopeDigest,
    targetDigest: lease.targetDigest,
  };
}

test("review references refuse shared identity and unpinned execution evidence", () => {
  expect(() => normalizeGrCampaignReview({ ...review, reviewerPrincipalId: owner })).toThrow(
    "REVIEW_UNVERIFIED",
  );
  expect(() =>
    normalizeGrCampaignReview({ ...review, executionIdentityDigest: "label:zed-b" }),
  ).toThrow("REVIEW_UNVERIFIED");
  expect(Object.isFrozen(normalizeGrCampaignReview(review))).toBe(true);
});
test("signed envelopes reach canonical Gate consumption without any reviewer transport or signer port", async () => {
  const f = await fixture();
  const lease = await f.issue();
  const first = await f.guarded.consumeLease(consume(lease));
  expect((await f.runtime.inspectGate(f.gateId))?.consumption?.leaseId).toBe(lease.id);
  expect((await f.guarded.consumeLease(consume(lease))).id).toBe(first.id);
});
test("pending review remains inspectable but cannot issue a lease", async () => {
  const f = await fixture({ pending: true });
  expect((await f.guarded.inspectGate(f.gateId))?.effectiveStatus).toBe("pending");
  await expect(f.issue()).rejects.toThrow();
  expect((await f.runtime.inspectGate(f.gateId))?.lease).toBeUndefined();
});
for (const options of [{ ownerOnly: true }, { alternativeCredential: true }])
  test(`review refuses policy/credential substitution ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    await expect(f.issue()).rejects.toThrow("REVIEW_UNVERIFIED");
    expect((await f.runtime.inspectGate(f.gateId))?.lease).toBeUndefined();
  });
test("changed evidence cannot reuse the same signed action", async () => {
  const f = await fixture();
  const guarded = guardGrCampaignReviewGatehouse(
    f.runtime,
    { ...review, evidenceDigest: digest("changed") },
    f.ports,
  );
  await expect(guarded.inspectGate(f.gateId)).rejects.toThrow("REVIEW_UNVERIFIED");
});
test("current credential revocation invalidates stored verification before lease issuance", async () => {
  const f = await fixture();
  f.revokeCredential();
  await expect(f.issue()).rejects.toThrow("fixture-credential-revoked");
  expect((await f.runtime.inspectGate(f.gateId))?.lease).toBeUndefined();
});
test("review expiration is checked even when stored quorum status has not changed", async () => {
  const f = await fixture();
  f.expire();
  await expect(f.issue()).rejects.toThrow("REVIEW_UNVERIFIED");
});
test("custody revocation between lease issuance and consumption preserves an unconsumed lease", async () => {
  const f = await fixture();
  const lease = await f.issue();
  f.revokeCustody();
  await expect(f.guarded.consumeLease(consume(lease))).rejects.toThrow("fixture-custody-revoked");
  expect((await f.runtime.inspectGate(f.gateId))?.consumption).toBeUndefined();
});
test("a lease issued outside the guarded composition cannot be adopted through request claims", async () => {
  const f = await fixture();
  const lease = await f.runtime.issueLease({
    gateId: f.gateId,
    preconditionDigest: f.intent.preconditions.digest,
  });
  await expect(f.guarded.consumeLease(consume(lease))).rejects.toThrow("REVIEW_UNVERIFIED");
});
test("mutated courier signature is rejected despite a retained verification label", async () => {
  const f = await fixture();
  const guarded = guardGrCampaignReviewGatehouse(
    {
      ...f.runtime,
      inspectGate: async (id) => {
        const inspection = structuredClone(await f.runtime.inspectGate(id))!;
        Object.assign(inspection.endorsements.find((e) => e.principalId === reviewer)!.proof, {
          signature: "forged",
        });
        return inspection;
      },
    },
    review,
    f.ports,
  );
  await expect(
    guarded.issueLease({ gateId: f.gateId, preconditionDigest: f.intent.preconditions.digest }),
  ).rejects.toThrow();
});
test("verifier cannot substitute signed evidence or authority", async () => {
  const f = await fixture();
  const guarded = guardGrCampaignReviewGatehouse(f.runtime, review, {
    ...f.ports,
    verifier: {
      id: "fixture-substitution",
      verify: async (input) => ({ ...(await f.ports.verifier.verify(input)), principalId: owner }),
    },
  });
  await expect(
    guarded.issueLease({ gateId: f.gateId, preconditionDigest: f.intent.preconditions.digest }),
  ).rejects.toThrow("REVIEW_UNVERIFIED");
});
test("recording a completed effect does not depend on still-active reviewer custody", async () => {
  const f = await fixture();
  const lease = await f.issue();
  const consumption = await f.guarded.consumeLease(consume(lease));
  f.revokeCustody();
  const receipt = await f.guarded.recordExecution({
    gateId: f.gateId,
    leaseId: lease.id,
    consumptionId: consumption.id,
    attemptId: consumption.attemptId,
    outcome: "outcome-unknown",
    uncertainty: "fixture effect needs readback",
  });
  expect(receipt.outcome).toBe("outcome-unknown");
});

test("retained intent digest cannot conceal changed review payload bytes", async () => {
  const f = await fixture();
  const changed = { ...review, evidenceDigest: digest("unreviewed successor") };
  const guarded = guardGrCampaignReviewGatehouse(
    {
      ...f.runtime,
      inspectGate: async (id) => {
        const inspection = structuredClone(await f.runtime.inspectGate(id))!;
        Object.assign(inspection.intent.preconditions.facts!, { review: changed });
        Object.assign(inspection.intent.target.parameters!, { review: changed });
        return inspection;
      },
    },
    changed,
    f.ports,
  );
  await expect(
    guarded.issueLease({ gateId: f.gateId, preconditionDigest: f.intent.preconditions.digest }),
  ).rejects.toThrow();
  expect((await f.runtime.inspectGate(f.gateId))?.lease).toBeUndefined();
});
