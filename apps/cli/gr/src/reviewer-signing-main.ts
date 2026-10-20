import { createLocalGatehouseP256Endorsement } from "@reliverse/gatehouse-p256";
import {
  fingerprintGatehouseValue,
  type GatehouseGateInspection,
  type GatehouseVerifiedEndorsement,
} from "@reliverse/gatehouse-protocol";
import {
  signGrCampaignReviewerDecision,
  assertGrCampaignReviewerSigningPolicy,
  type GrCampaignReviewerSigningPolicy,
} from "@reliverse/gr-action-runtime";
import { readRvsReviewerProtectedDocument as document } from "@reliverse/rvs-systemd-ubuntu";

import {
  GR_REVIEW_SIGNER_POLICY,
  GR_REVIEW_SIGNER_EXECUTABLE,
  inspectGrReviewerPrivateMetadata,
} from "./native-review-bridge";
import { connectGrNativeReview } from "./native-review-client";

export async function runGrNativeReviewerSigning(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--identity")
    return {
      schema: "gr.native-review-signer.v0",
      credentialCreation: false,
      gateSubmission: false,
      gitExecutionAdmitted: false,
    };
  if (
    args.length !== 1 ||
    !["approve", "deny"].includes(args[0]!) ||
    process.getuid?.() !== 994 ||
    process.geteuid?.() !== 994 ||
    process.execPath !== GR_REVIEW_SIGNER_EXECUTABLE
  )
    throw new Error("GR_NATIVE_REVIEW_SIGNER_NOT_ADMITTED");
  const decision = args[0] as "approve" | "deny";
  const loaded = await document(GR_REVIEW_SIGNER_POLICY, 0, 2 * 1024 ** 2);
  const policy = loaded.value as unknown as GrCampaignReviewerSigningPolicy;
  assertGrCampaignReviewerSigningPolicy(policy);
  const channel = await connectGrNativeReview("reviewer");
  try {
    const pin = fingerprintGatehouseValue(policy);
    if (
      pin !== fingerprintGatehouseValue(channel.policy.signing) ||
      loaded.digest !== channel.policy.signingPolicyFileDigest
    )
      throw new Error("GR_NATIVE_REVIEW_POLICY_CHANGED");
    const current = async () => {
      if ((await document(GR_REVIEW_SIGNER_POLICY, 0, 2 * 1024 ** 2)).digest !== loaded.digest)
        throw new Error("GR_NATIVE_REVIEW_POLICY_CHANGED");
      await inspectGrReviewerPrivateMetadata(policy.bindings.review.credentialId);
      const r = await channel.request({ operation: "inspect" });
      if (r.signingPolicyDigest !== pin) throw new Error("GR_NATIVE_REVIEW_POLICY_CHANGED");
      return r.inspection as GatehouseGateInspection;
    };
    await current();
    const reserved = await channel.request({ operation: "begin", decision });
    if (typeof reserved.nonce !== "string" || reserved.signingPolicyDigest !== pin)
      throw new Error("GR_NATIVE_REVIEW_RESERVATION_INVALID");
    const result = await signGrCampaignReviewerDecision(policy, decision, {
      now: () => new Date(),
      assertCurrent: async () => {
        await current();
      },
      inspectGate: async () => current(),
      sign: (input) =>
        createLocalGatehouseP256Endorsement({
          ...input,
          authorityHome:
            "/var/lib/reliverse/actors/reliverse-zed-b/campaign-reviewer-credential/private",
        }),
      verifier: {
        id: "gr-native-root-review-verifier",
        verify: async ({ endorsement }) => {
          const verified = await channel.request({
            operation: "verify",
            nonce: reserved.nonce as string,
            endorsement,
          });
          return verified.endorsement as GatehouseVerifiedEndorsement;
        },
      },
    });
    const completion = await channel.request({
      operation: "finish",
      nonce: reserved.nonce,
      endorsement: result.endorsement,
    });
    const receipt = completion.receipt as {
      outcome?: string;
      endorsementDigest?: string;
      signingPolicyDigest?: string;
    };
    if (
      !receipt ||
      receipt.outcome !== "completed" ||
      receipt.endorsementDigest !== fingerprintGatehouseValue(result.endorsement) ||
      receipt.signingPolicyDigest !== pin
    )
      throw new Error("GR_NATIVE_REVIEW_COMPLETION_INVALID");
    return { ...result, nativeReceipt: receipt };
  } finally {
    channel.close();
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runGrNativeReviewerSigning(process.argv.slice(2))));
  } catch {
    console.error("GR_NATIVE_REVIEW_SIGNING_HELD_NO_RETRY");
    process.exitCode = 1;
  }
}
