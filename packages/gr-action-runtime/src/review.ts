import {
  assertGatehouseActionIntent,
  assertGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseGateInspection,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseEndorsementVerifier, GatehouseRuntime } from "@reliverse/gatehouse-runtime";
import { GrError } from "@reliverse/gr";

/** Public references only. Included in the action intent signed by both authorities;
 * checksums describe evidence, they do not authenticate execution or admit custody. */
export interface GrCampaignReview {
  readonly ownerPrincipalId: string;
  readonly reviewerPrincipalId: string;
  readonly credentialId: string;
  readonly publicKeyDigest: string;
  readonly actorBindingDigest: string;
  readonly executionIdentityDigest: string;
  readonly evidenceDigest: string;
}

export interface GrCampaignReviewPorts {
  readonly verifier: GatehouseEndorsementVerifier;
  readonly now: () => Date;
  /** Independently load canonical Principals/binding, credential/key pin and actual
   * reviewer execution admission. Producer execution must not be able to obtain
   * or invoke the reviewer signer. Never accept these facts from courier JSON. */
  readonly assertCustodyCurrent: (review: GrCampaignReview) => Promise<void>;
}

const denied = () => new GrError("GR_NOT_AUTHORIZED", "GR_CAMPAIGN_REVIEW_UNVERIFIED");

export function normalizeGrCampaignReview(input: GrCampaignReview): GrCampaignReview {
  if (
    !input ||
    !/^prn_[a-f0-9]{32}$/.test(input.ownerPrincipalId) ||
    !/^prn_[a-f0-9]{32}$/.test(input.reviewerPrincipalId) ||
    input.ownerPrincipalId === input.reviewerPrincipalId ||
    typeof input.credentialId !== "string" ||
    !/^[a-z0-9][a-z0-9._:/-]*$/i.test(input.credentialId) ||
    ![
      input.publicKeyDigest,
      input.actorBindingDigest,
      input.executionIdentityDigest,
      input.evidenceDigest,
    ].every((value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value))
  )
    throw denied();
  return Object.freeze({
    ownerPrincipalId: input.ownerPrincipalId,
    reviewerPrincipalId: input.reviewerPrincipalId,
    credentialId: input.credentialId,
    publicKeyDigest: input.publicKeyDigest,
    actorBindingDigest: input.actorBindingDigest,
    executionIdentityDigest: input.executionIdentityDigest,
    evidenceDigest: input.evidenceDigest,
  });
}

type GatehousePort = Pick<
  GatehouseRuntime,
  "inspectGate" | "issueLease" | "consumeLease" | "recordExecution"
>;

/** Courier-independent composition, not a new signer, quorum resolver or ledger.
 * The admitted host owns these ports and the canonical protected Gatehouse store.
 * A previously stored `verification` label cannot replace current verification. */
export function guardGrCampaignReviewGatehouse(
  gatehouse: GatehousePort,
  input: GrCampaignReview,
  ports: GrCampaignReviewPorts,
): GatehousePort {
  const review = normalizeGrCampaignReview(input);
  const leases = new Map<string, string>();
  const { verifier, now, assertCustodyCurrent } = ports;
  const inspectGate = async (gateId: string) => {
    await assertCustodyCurrent(review);
    const inspection = await gatehouse.inspectGate(gateId);
    if (!inspection) throw denied();
    const { gate, intent, approvalBundle } = inspection;
    assertGatehouseActionIntent(intent);
    const authority = intent.policy.authority;
    const facts = intent.preconditions.facts as { review?: unknown } | null;
    const parameters = intent.target.parameters as { review?: unknown } | null;
    if (
      gate.id !== gateId ||
      gate.intentDigest !== intent.digest ||
      gate.policyDigest !== intent.policy.digest ||
      gate.policyId !== intent.policy.id ||
      fingerprintGatehouseValue(facts?.review ?? null) !== fingerprintGatehouseValue(review) ||
      fingerprintGatehouseValue(parameters?.review ?? null) !== fingerprintGatehouseValue(review) ||
      authority.kind !== "all-of" ||
      ![review.ownerPrincipalId, review.reviewerPrincipalId].every((id) =>
        authority.principalIds.includes(id),
      ) ||
      fingerprintGatehouseValue(gate.authority) !== fingerprintGatehouseValue(authority)
    )
      throw denied();
    if (["quorum-satisfied", "lease-issued"].includes(inspection.effectiveStatus)) {
      const instant = now().getTime();
      if (
        !Number.isFinite(instant) ||
        !approvalBundle ||
        approvalBundle.status !== "quorum-satisfied" ||
        gate.approvalBundleId !== approvalBundle.id ||
        approvalBundle.gateId !== gateId ||
        approvalBundle.intentDigest !== intent.digest ||
        approvalBundle.policyDigest !== intent.policy.digest ||
        fingerprintGatehouseValue(approvalBundle.authority) !== fingerprintGatehouseValue(authority)
      )
        throw denied();
      // Gatehouse remains responsible for quorum. Reverify its accepted signatures
      // against current enrollment/revocation before granting a Git effect.
      for (const principalId of authority.principalIds) {
        const accepted = inspection.endorsements.filter(
          (e) =>
            e.principalId === principalId && approvalBundle.acceptedEndorsementIds.includes(e.id),
        );
        if (!accepted.length) throw denied();
        for (const endorsement of accepted) {
          const { verification: previousVerification, ...submitted } = endorsement;
          assertGatehouseEndorsementSubmission(submitted);
          if (
            endorsement.gateId !== gateId ||
            endorsement.intentDigest !== intent.digest ||
            endorsement.decision !== "approve" ||
            !Number.isFinite(Date.parse(endorsement.issuedAt)) ||
            Date.parse(endorsement.issuedAt) > instant ||
            !Number.isFinite(Date.parse(endorsement.expiresAt)) ||
            Date.parse(endorsement.expiresAt) <= instant ||
            (principalId === review.reviewerPrincipalId &&
              endorsement.credentialId !== review.credentialId)
          )
            throw denied();
          const verified = await verifier.verify({ endorsement: submitted, gate, intent });
          // Verifier may refresh its own timestamp, never substitute signed fields.
          const { verification: currentVerification, ...confirmed } = verified;
          if (
            !previousVerification ||
            !currentVerification ||
            fingerprintGatehouseValue(submitted) !== fingerprintGatehouseValue(confirmed)
          )
            throw denied();
        }
      }
      if (Date.parse(gate.expiresAt) <= instant || !Number.isFinite(Date.parse(gate.expiresAt)))
        throw denied();
      await assertCustodyCurrent(review);
    }
    return inspection;
  };
  return Object.freeze({
    inspectGate,
    async issueLease(request: Parameters<GatehouseRuntime["issueLease"]>[0]) {
      await inspectGate(request.gateId);
      const lease = await gatehouse.issueLease(request);
      if (lease.gateId !== request.gateId) throw denied();
      leases.set(lease.id, request.gateId);
      return lease;
    },
    async consumeLease(request: Parameters<GatehouseRuntime["consumeLease"]>[0]) {
      const inspection: GatehouseGateInspection = await inspectGateForLease(request.leaseId);
      if (inspection.lease?.id !== request.leaseId) throw denied();
      return gatehouse.consumeLease(request);
    },
    // Recording a completed/uncertain effect must remain possible after revocation.
    recordExecution: (request: Parameters<GatehouseRuntime["recordExecution"]>[0]) =>
      gatehouse.recordExecution(request),
  });

  async function inspectGateForLease(leaseId: string) {
    // Gatehouse consume input has no gateId. Resolve only leases issued by THIS
    // guarded port, not by scanning a store or accepting request-side identity.
    const gateId = leases.get(leaseId);
    if (!gateId) throw denied();
    return inspectGate(gateId);
  }
}
