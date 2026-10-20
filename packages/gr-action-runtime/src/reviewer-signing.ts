import {
  assertGatehouseActionIntent,
  assertGatehouseEndorsementSubmission,
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
  type GatehouseEndorsementSubmission,
  type GatehouseGateInspection,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseEndorsementVerifier } from "@reliverse/gatehouse-runtime";
import { GrError } from "@reliverse/gr";

import { createGrCampaignActionIntent } from "./campaign";
import { normalizeGrCampaignReview, type GrCampaignReview } from "./review";

/** Public evidence references, not a new review ledger or an authentication claim.
 * A final reviewer decision must cover these exact bytes and the exact Gate intent. */
export interface GrCampaignReviewEvidence {
  readonly schema: "gr.campaign-review-evidence.v0";
  readonly campaignFingerprint: string;
  readonly candidateTree: string;
  readonly reviewerPrincipalId: string;
  readonly manifestDigest: string;
  readonly treeProofDigest: string;
  readonly reportDigest: string;
  readonly proofScope: "candidate-source-only";
}

export interface GrCampaignReviewerSigningPolicy {
  readonly schema: "gr.campaign-reviewer-signing-policy.v0";
  readonly bindings: Omit<
    Parameters<typeof createGrCampaignActionIntent>[0],
    "authority" | "review"
  > & {
    readonly review: GrCampaignReview;
  };
  readonly evidence: GrCampaignReviewEvidence;
  readonly intent: GatehouseActionIntent;
  readonly credentialExpiresAt: string;
}
const deny = () => new GrError("GR_NOT_AUTHORIZED", "GR_REVIEWER_SIGNING_UNVERIFIED");

export function assertGrCampaignReviewerSigningPolicy(p: GrCampaignReviewerSigningPolicy) {
  const review = normalizeGrCampaignReview(p.bindings.review);
  assertGatehouseActionIntent(p.intent);
  const expected = createGrCampaignActionIntent({ ...p.bindings, authority: p.intent });
  const e = p.evidence;
  const authority = p.intent.policy.authority;
  if (
    p.schema !== "gr.campaign-reviewer-signing-policy.v0" ||
    fingerprintGatehouseValue(expected) !== fingerprintGatehouseValue(p.intent) ||
    p.intent.requester.kind !== "human" ||
    p.intent.requester.id !== review.ownerPrincipalId ||
    authority.kind !== "all-of" ||
    authority.independence !== "distinct-perspectives" ||
    ![review.ownerPrincipalId, review.reviewerPrincipalId].every((id) =>
      authority.principalIds.includes(id),
    ) ||
    p.intent.requestedCapability.maxAttempts !== 1 ||
    !Number.isFinite(Date.parse(p.credentialExpiresAt)) ||
    Date.parse(p.credentialExpiresAt) < Date.parse(p.intent.expiresAt) ||
    e.schema !== "gr.campaign-review-evidence.v0" ||
    e.proofScope !== "candidate-source-only" ||
    !/^[a-f0-9]{64}$/.test(e.campaignFingerprint) ||
    !/^[a-f0-9]{40}$/.test(e.candidateTree) ||
    e.campaignFingerprint !== p.bindings.plan.campaignFingerprint ||
    e.candidateTree !== p.bindings.plan.frozen?.candidateTree.oid ||
    e.reviewerPrincipalId !== review.reviewerPrincipalId ||
    ![e.manifestDigest, e.treeProofDigest, e.reportDigest].every((d) =>
      /^sha256:[a-f0-9]{64}$/.test(d),
    ) ||
    fingerprintGatehouseValue(e) !== review.evidenceDigest
  )
    throw deny();
}

export interface GrCampaignReviewerSigningPorts {
  readonly now: () => Date;
  /** Independently admitted native adapter must check actual UID/closure, completed
   * enrollment, active canonical identities/key/UF status, revocation, private-key
   * custody and the exact manifest/tree proof/report bytes. No request-side facts. */
  readonly assertCurrent: (policy: GrCampaignReviewerSigningPolicy) => Promise<void>;
  /** Canonical trusted Gatehouse port, not a courier-supplied inspection snapshot. */
  readonly inspectGate: (id: string) => Promise<GatehouseGateInspection | null>;
  readonly verifier: GatehouseEndorsementVerifier;
  /** Host closes over the fixed admitted private credential path. This port gets
   * only the exact bounded fields, never arbitrary caller payload/path/Principal. */
  readonly sign: (input: {
    readonly credentialId: string;
    readonly gateId: string;
    readonly intentDigest: string;
    readonly decision: "approve" | "deny";
    readonly expiresAt: string;
  }) => Promise<GatehouseEndorsementSubmission>;
}

/** Exact-intent signing composition only. It cannot load/admit its own native
 * ports, generate/enroll a key, issue/consume a lease or execute a Git effect. */
export async function signGrCampaignReviewerDecision(
  input: GrCampaignReviewerSigningPolicy,
  decision: "approve" | "deny",
  ports: GrCampaignReviewerSigningPorts,
) {
  if (decision !== "approve" && decision !== "deny") throw deny();
  const policy = structuredClone(input);
  assertGrCampaignReviewerSigningPolicy(policy);
  const pin = fingerprintGatehouseValue(policy);
  const review = normalizeGrCampaignReview(policy.bindings.review);
  const gateId = createDeterministicGatehouseId("gate", policy.intent.id);
  const current = async () => {
    assertGrCampaignReviewerSigningPolicy(policy);
    if (fingerprintGatehouseValue(policy) !== pin) throw deny();
    const now = ports.now().getTime();
    if (
      !Number.isFinite(now) ||
      Date.parse(policy.intent.createdAt) > now ||
      Date.parse(policy.intent.expiresAt) <= now ||
      Date.parse(policy.credentialExpiresAt) <= now
    )
      throw deny();
    await ports.assertCurrent(structuredClone(policy));
    const inspection = structuredClone(await ports.inspectGate(gateId));
    if (
      !inspection ||
      inspection.effectiveStatus !== "pending" ||
      inspection.gate.status !== "pending" ||
      inspection.gate.id !== gateId ||
      inspection.gate.intentId !== policy.intent.id ||
      inspection.gate.intentDigest !== policy.intent.digest ||
      inspection.gate.policyId !== policy.intent.policy.id ||
      inspection.gate.policyDigest !== policy.intent.policy.digest ||
      fingerprintGatehouseValue(inspection.gate.authority) !==
        fingerprintGatehouseValue(policy.intent.policy.authority) ||
      fingerprintGatehouseValue(inspection.intent) !== fingerprintGatehouseValue(policy.intent) ||
      inspection.lease ||
      inspection.consumption ||
      inspection.execution ||
      inspection.revocations.length ||
      inspection.endorsements.some((e) => e.principalId === review.reviewerPrincipalId)
    )
      throw deny();
    return inspection;
  };
  await current();
  // No retry loop. A signing/verification failure cannot be reported as success;
  // native attempt/custody history remains the responsibility of the owning host.
  const submitted = structuredClone(
    await ports.sign({
      credentialId: review.credentialId,
      gateId,
      intentDigest: policy.intent.digest,
      decision,
      expiresAt: policy.intent.expiresAt,
    }),
  );
  assertGatehouseEndorsementSubmission(submitted);
  const instant = ports.now().getTime();
  if (
    submitted.gateId !== gateId ||
    submitted.intentDigest !== policy.intent.digest ||
    submitted.principalId !== review.reviewerPrincipalId ||
    submitted.credentialId !== review.credentialId ||
    submitted.decision !== decision ||
    !Number.isFinite(instant) ||
    !Number.isFinite(Date.parse(submitted.issuedAt)) ||
    Date.parse(submitted.issuedAt) < Date.parse(policy.intent.createdAt) ||
    Date.parse(submitted.issuedAt) > instant ||
    !Number.isFinite(Date.parse(submitted.expiresAt)) ||
    Date.parse(submitted.expiresAt) <= instant ||
    Date.parse(submitted.expiresAt) > Date.parse(policy.intent.expiresAt) ||
    Date.parse(submitted.expiresAt) > Date.parse(policy.credentialExpiresAt)
  )
    throw deny();
  const inspection = await current();
  const verified = await ports.verifier.verify({
    endorsement: submitted,
    gate: inspection.gate,
    intent: inspection.intent,
  });
  const { verification, ...confirmed } = verified;
  if (
    !verification ||
    fingerprintGatehouseValue(confirmed) !== fingerprintGatehouseValue(submitted)
  )
    throw deny();
  await current();
  return {
    schema: "gr.campaign-reviewer-decision.v0" as const,
    evidence: structuredClone(policy.evidence),
    endorsement: submitted,
    credentialCreated: false as const,
    gateSubmitted: false as const,
    leaseConsumed: false as const,
    campaignApproved: false as const,
  };
}
