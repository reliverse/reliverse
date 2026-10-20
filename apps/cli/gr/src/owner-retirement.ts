import {
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseRuntime } from "@reliverse/gatehouse-runtime";
import type { GrCampaignReviewerSigningPolicy } from "@reliverse/gr-action-runtime";

export interface GrOwnerUnusedExecution {
  readonly launchPolicyDigest: string;
  readonly signingPolicyDigest: string;
  readonly bridgePolicyDigest: string;
  readonly gateDigest: string;
  readonly nativeCompletionDigest: string;
  readonly nativeSealDigest: string;
  readonly gateInventoryDigest: string;
  readonly reason: string;
}

export function assertGrOwnerUnusedExecution(value: GrOwnerUnusedExecution) {
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "bridgePolicyDigest,gateDigest,gateInventoryDigest,launchPolicyDigest,nativeCompletionDigest,nativeSealDigest,reason,signingPolicyDigest" ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    value.reason.length > 1024 ||
    Object.entries(value).some(
      ([key, s]) => key !== "reason" && (typeof s !== "string" || !/^sha256:[a-f0-9]{64}$/.test(s)),
    )
  )
    throw Error("GR_UNUSED_EXECUTION_EXPECTATION_INVALID");
}

/** Revocation grants no execution authority. Exact-state CAS is checked by the
 * owning Gatehouse API under its writer lock, not by a separate JSON writer. */
export async function retireGrUnusedCampaignGate(input: {
  readonly signing: GrCampaignReviewerSigningPolicy;
  readonly ownerPrincipalId: string;
  readonly reason: string;
  readonly gatehouse: Pick<GatehouseRuntime, "inspectGate" | "revoke">;
  readonly assertCurrent: () => Promise<void>;
}) {
  await input.assertCurrent();
  const { signing, gatehouse, ownerPrincipalId } = input;
  const gateId = createDeterministicGatehouseId("gate", signing.intent.id);
  const before = await gatehouse.inspectGate(gateId);
  const plan = signing.bindings.plan;
  const review = signing.bindings.review;
  if (
    !before ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 1024 ||
    signing.bindings.action.kind !== "commit" ||
    signing.bindings.action.commitId !== plan.scope.commits[0]?.id ||
    signing.bindings.action.expectedBeforeCommit !== plan.base.commit.oid ||
    ownerPrincipalId !== review.ownerPrincipalId ||
    before.gate.status !== "quorum-satisfied" ||
    !["quorum-satisfied", "expired"].includes(before.effectiveStatus) ||
    before.gate.id !== gateId ||
    before.gate.intentDigest !== signing.intent.digest ||
    fingerprintGatehouseValue(before.intent) !== fingerprintGatehouseValue(signing.intent) ||
    before.lease ||
    before.consumption ||
    before.execution ||
    before.revocations.length ||
    before.endorsements.length !== 2 ||
    before.decisions.length !== 2 ||
    before.approvalBundle?.status !== "quorum-satisfied" ||
    before.approvalBundle.acceptedEndorsementIds.length !== 2 ||
    before.approvalBundle.rejectedEndorsementIds.length ||
    ![review.ownerPrincipalId, review.reviewerPrincipalId].every(
      (id) =>
        before.endorsements.filter(
          (e) =>
            e.principalId === id &&
            e.decision === "approve" &&
            before.approvalBundle!.acceptedEndorsementIds.includes(e.id),
        ).length === 1,
    )
  )
    throw Error("GR_UNUSED_EXECUTION_STATE_INVALID_NO_RETRY");
  await input.assertCurrent();
  const revocation = await gatehouse.revoke({
    gateId,
    actor: { id: ownerPrincipalId, kind: "human" },
    reason: input.reason,
    expectedInspectionDigest: fingerprintGatehouseValue(before),
  });
  await input.assertCurrent();
  const after = await gatehouse.inspectGate(gateId);
  if (
    !after ||
    after.effectiveStatus !== "revoked" ||
    after.lease ||
    after.consumption ||
    after.execution ||
    after.revocations.length !== 1 ||
    after.revocations[0]?.id !== revocation.id ||
    fingerprintGatehouseValue(after.endorsements) !==
      fingerprintGatehouseValue(before.endorsements) ||
    fingerprintGatehouseValue(after.decisions) !== fingerprintGatehouseValue(before.decisions) ||
    fingerprintGatehouseValue(after.approvalBundle) !==
      fingerprintGatehouseValue(before.approvalBundle)
  )
    throw Error("GR_UNUSED_RETIREMENT_OUTCOME_REQUIRES_RECONCILIATION_NO_RETRY");
  return {
    schema: "gr.campaign-unused-retirement.v0" as const,
    gateId,
    intentDigest: signing.intent.digest,
    revocation,
    outcome: "completed" as const,
    authorityGranted: false as const,
    commitPerformed: false as const,
    pushPerformed: false as const,
  };
}
