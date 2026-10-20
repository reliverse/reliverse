import { randomUUID } from "node:crypto";

import {
  assertGatehouseEndorsementSubmission,
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
  type GatehouseEndorsementSubmission,
  type GatehouseGateInspection,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseEndorsementVerifier } from "@reliverse/gatehouse-runtime";
import { GrError } from "@reliverse/gr";

import {
  assertGrCampaignReviewerSigningPolicy,
  type GrCampaignReviewerSigningPolicy,
} from "./reviewer-signing";

const denied = () => new GrError("GR_NOT_AUTHORIZED", "GR_NATIVE_REVIEW_BRIDGE_REFUSED");
export interface GrNativeReviewPeer {
  readonly uid: 994 | 995;
  readonly gid: 984 | 985;
  readonly pid: number;
  /** Kernel-held peer PID + /proc starttime, never request data. */
  readonly instance: string;
  readonly executableDigest: string;
}
export interface GrNativeReviewReceipt {
  readonly schema: "gr.native-review-attempt.v0";
  readonly outcome: "outcome-unknown" | "completed";
  readonly nonce: string;
  readonly decision: "approve" | "deny";
  readonly gateId: string;
  readonly intentDigest: string;
  readonly signingPolicyDigest: string;
  readonly bridgeClosureDigest: string;
  readonly reviewer: GrNativeReviewPeer;
  readonly reservedAt: string;
  readonly endorsementDigest?: string;
  readonly completedAt?: string;
}
export type GrNativeReviewRequest =
  | { readonly operation: "inspect" | "current" }
  | { readonly operation: "begin"; readonly decision: "approve" | "deny" }
  | { readonly operation: "verify-courier"; readonly endorsement: GatehouseEndorsementSubmission }
  | {
      readonly operation: "verify" | "finish";
      readonly nonce: string;
      readonly endorsement: GatehouseEndorsementSubmission;
    };

export function parseGrNativeReviewRequest(bytes: Uint8Array): GrNativeReviewRequest {
  if (!bytes.byteLength || bytes.byteLength > 16384) throw denied();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.endsWith("\n") || text.indexOf("\n") !== text.length - 1) throw denied();
  const r = JSON.parse(text) as GrNativeReviewRequest;
  if (!r || typeof r !== "object" || Array.isArray(r)) throw denied();
  const fields = Object.keys(r).sort().join(",");
  if (
    (["inspect", "current"].includes(r.operation) && fields === "operation") ||
    (r.operation === "begin" &&
      fields === "decision,operation" &&
      ["approve", "deny"].includes(r.decision)) ||
    (r.operation === "verify-courier" && fields === "endorsement,operation") ||
    (["verify", "finish"].includes(r.operation) &&
      fields === "endorsement,nonce,operation" &&
      "nonce" in r &&
      typeof r.nonce === "string" &&
      /^native_review_[a-f0-9-]{36}$/.test(r.nonce))
  ) {
    if ("endorsement" in r) assertGatehouseEndorsementSubmission(r.endorsement);
    return r;
  }
  throw denied();
}

export interface GrNativeReviewBridgePorts {
  readonly now: () => Date;
  /** Root-admitted bridge/closure, canonical identities/enrollment/key status,
   * private metadata and exact manifest/tree proof/report checks. No key reads. */
  readonly assertCurrent: () => Promise<void>;
  /** Only courier verification may read under this exact kernel-attested owner's
   * canonical Gatehouse lock. Reviewer/current reads still reject all locks. */
  readonly inspectGate: (owner?: GrNativeReviewPeer) => Promise<GatehouseGateInspection | null>;
  readonly verifier: GatehouseEndorsementVerifier;
  readonly journal: {
    /** Exclusive create + fsync. Existing/partial/unknown attempts never resume. */
    reserve(receipt: GrNativeReviewReceipt): Promise<void>;
    /** Exclusive completion, preserving reservation. */
    complete(receipt: GrNativeReviewReceipt): Promise<void>;
    /** Release publication fence only after host's held-peer post-check succeeds. */
    seal(nonce: string): Promise<void>;
    read(): Promise<GrNativeReviewReceipt | undefined>;
    /** Known failed publication/post-observation stays held even if bytes exist. */
    hold(nonce: string): Promise<void>;
  };
}

/** One exact Gate, no signer, Gate mutator, Cap grant or Git port. Every call is
 * inside a kernel-held native peer observation supplied by the admitted host. */
export function createGrNativeReviewBridge(
  input: {
    readonly signing: GrCampaignReviewerSigningPolicy;
    readonly bridgeClosureDigest: string;
    readonly expiresAt: string;
  },
  ports: GrNativeReviewBridgePorts,
) {
  const policy = structuredClone(input);
  assertGrCampaignReviewerSigningPolicy(policy.signing);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(policy.bridgeClosureDigest) ||
    !Number.isFinite(Date.parse(policy.expiresAt)) ||
    Date.parse(policy.expiresAt) > Date.parse(policy.signing.intent.expiresAt)
  )
    throw denied();
  const gateId = createDeterministicGatehouseId("gate", policy.signing.intent.id);
  const signingPolicyDigest = fingerprintGatehouseValue(policy.signing);
  // Shared across sockets. Invalidate synchronously, before any journal I/O can
  // yield; an owner must not publish a previously read completion after a hold.
  let publicationHeld = false;
  const assertPublishable = () => {
    if (publicationHeld) throw denied();
  };
  const inspect = async (pending: boolean, owner?: GrNativeReviewPeer) => {
    const t = ports.now().getTime();
    if (
      !Number.isFinite(t) ||
      t >= Date.parse(policy.expiresAt) ||
      t < Date.parse(policy.signing.intent.createdAt)
    )
      throw denied();
    await ports.assertCurrent();
    const gate = structuredClone(await ports.inspectGate(owner));
    if (
      !gate ||
      gate.gate.id !== gateId ||
      gate.gate.intentDigest !== policy.signing.intent.digest ||
      fingerprintGatehouseValue(gate.intent) !== fingerprintGatehouseValue(policy.signing.intent) ||
      gate.revocations.length ||
      Date.parse(gate.gate.expiresAt) <= ports.now().getTime() ||
      (pending &&
        (gate.gate.status !== "pending" ||
          gate.effectiveStatus !== "pending" ||
          gate.lease ||
          gate.consumption ||
          gate.execution ||
          gate.endorsements.some(
            (e) => e.principalId === policy.signing.bindings.review.reviewerPrincipalId,
          )))
    )
      throw denied();
    await ports.assertCurrent();
    return gate;
  };
  return {
    /** Retain this connection object only for THIS accepted kernel socket. */
    connection() {
      let attempt: GrNativeReviewReceipt | undefined,
        busy = false,
        finished = false,
        readyToSeal = false,
        first: string | undefined;
      const handle = async (r: GrNativeReviewRequest, peer: GrNativeReviewPeer) => {
        if (busy || finished) throw denied();
        busy = true;
        try {
          if (
            !Number.isSafeInteger(peer.pid) ||
            peer.pid <= 0 ||
            !peer.instance ||
            !/^sha256:[a-f0-9]{64}$/.test(peer.executableDigest) ||
            !((peer.uid === 994 && peer.gid === 984) || (peer.uid === 995 && peer.gid === 985))
          )
            throw denied();
          const instance = fingerprintGatehouseValue(peer);
          if (first && first !== instance) throw denied();
          first = instance;
          const reviewer = peer.uid === 994;
          if (r.operation === "inspect") {
            if (!reviewer) throw denied();
            return { operation: "inspect", inspection: await inspect(true), signingPolicyDigest };
          }
          if (r.operation === "current") {
            if (reviewer) throw denied();
            const gate = await inspect(false),
              receipt = await ports.journal.read();
            if (
              !receipt ||
              receipt.schema !== "gr.native-review-attempt.v0" ||
              receipt.outcome !== "completed" ||
              receipt.gateId !== gateId ||
              receipt.intentDigest !== policy.signing.intent.digest ||
              receipt.signingPolicyDigest !== signingPolicyDigest ||
              receipt.bridgeClosureDigest !== policy.bridgeClosureDigest ||
              receipt.reviewer.uid !== 994 ||
              receipt.reviewer.gid !== 984 ||
              !receipt.endorsementDigest ||
              !gate.endorsements.some(
                ({ verification, ...e }) =>
                  verification &&
                  e.principalId === policy.signing.bindings.review.reviewerPrincipalId &&
                  fingerprintGatehouseValue(e) === receipt.endorsementDigest,
              )
            )
              throw denied();
            await ports.assertCurrent();
            assertPublishable();
            return {
              operation: "current",
              receipt,
              gateId,
              signingPolicyDigest,
              authorityGranted: false,
            };
          }
          if (r.operation === "verify-courier") {
            if (reviewer) throw denied();
            const gate = await inspect(false, peer),
              e = structuredClone(r.endorsement);
            assertGatehouseEndorsementSubmission(e);
            if (
              e.gateId !== gateId ||
              e.intentDigest !== policy.signing.intent.digest ||
              ![
                policy.signing.bindings.review.ownerPrincipalId,
                policy.signing.bindings.review.reviewerPrincipalId,
              ].includes(e.principalId)
            )
              throw denied();
            if (e.principalId === policy.signing.bindings.review.reviewerPrincipalId) {
              const receipt = await ports.journal.read();
              if (
                !receipt ||
                receipt.outcome !== "completed" ||
                receipt.signingPolicyDigest !== signingPolicyDigest ||
                receipt.bridgeClosureDigest !== policy.bridgeClosureDigest ||
                receipt.endorsementDigest !== fingerprintGatehouseValue(e)
              )
                throw denied();
            }
            const verified = await ports.verifier.verify({
              endorsement: e,
              gate: gate.gate,
              intent: gate.intent,
            });
            const { verification, ...confirmed } = verified;
            if (
              !verification ||
              fingerprintGatehouseValue(confirmed) !== fingerprintGatehouseValue(e)
            )
              throw denied();
            await ports.assertCurrent();
            assertPublishable();
            return { operation: "verify-courier", endorsement: verified };
          }
          if (!reviewer) throw denied();
          const gate = await inspect(true);
          if (r.operation === "begin") {
            if (attempt) throw denied();
            // Keep a consumed local reservation even if root publication is uncertain.
            attempt = {
              schema: "gr.native-review-attempt.v0",
              outcome: "outcome-unknown",
              nonce: `native_review_${randomUUID()}`,
              decision: r.decision,
              gateId,
              intentDigest: policy.signing.intent.digest,
              signingPolicyDigest,
              bridgeClosureDigest: policy.bridgeClosureDigest,
              reviewer: structuredClone(peer),
              reservedAt: ports.now().toISOString(),
            };
            await ports.journal.reserve(structuredClone(attempt));
            await inspect(true);
            return { operation: "begin", nonce: attempt.nonce, signingPolicyDigest };
          }
          if (r.operation !== "verify" && r.operation !== "finish") throw denied();
          if (
            !attempt ||
            r.nonce !== attempt.nonce ||
            fingerprintGatehouseValue(attempt.reviewer) !== instance
          )
            throw denied();
          const e = structuredClone(r.endorsement);
          assertGatehouseEndorsementSubmission(e);
          if (
            e.gateId !== gateId ||
            e.intentDigest !== policy.signing.intent.digest ||
            e.decision !== attempt.decision ||
            e.principalId !== policy.signing.bindings.review.reviewerPrincipalId ||
            e.credentialId !== policy.signing.bindings.review.credentialId ||
            Date.parse(e.issuedAt) < Date.parse(attempt.reservedAt) ||
            Date.parse(e.issuedAt) > ports.now().getTime() ||
            Date.parse(e.expiresAt) <= ports.now().getTime() ||
            Date.parse(e.expiresAt) > Date.parse(policy.signing.intent.expiresAt)
          )
            throw denied();
          const verified = await ports.verifier.verify({
            endorsement: e,
            gate: gate.gate,
            intent: gate.intent,
          });
          const { verification, ...confirmed } = verified;
          if (
            !verification ||
            fingerprintGatehouseValue(confirmed) !== fingerprintGatehouseValue(e)
          )
            throw denied();
          await inspect(true);
          if (r.operation === "verify") return { operation: "verify", endorsement: verified };
          if (r.operation !== "finish") throw denied();
          // No local resumption after a completion write or final guard fails.
          finished = true;
          const completed = {
            ...attempt,
            outcome: "completed" as const,
            endorsementDigest: fingerprintGatehouseValue(e),
            completedAt: ports.now().toISOString(),
          };
          await ports.journal.complete(completed);
          await inspect(true);
          readyToSeal = true;
          return { operation: "finish", receipt: completed, authorityGranted: false };
        } catch (cause) {
          // A failed frame permanently holds THIS connection/attempt, even if the
          // socket stays open. Durable reservation is never removed or overwritten.
          finished = true;
          readyToSeal = false;
          if (attempt) {
            publicationHeld = true;
            await ports.journal.hold(attempt.nonce).catch(() => undefined);
          }
          throw denied();
        } finally {
          busy = false;
        }
      };
      return Object.assign(handle, {
        // Host calls this after its asynchronous held-peer observation and any
        // sealing, with no further await before serializing/writing the frame.
        assertPublishable,
        seal: async () => {
          if (!attempt || !readyToSeal || busy) throw denied();
          readyToSeal = false;
          try {
            await ports.assertCurrent();
            await ports.journal.seal(attempt.nonce);
          } catch {
            publicationHeld = true;
            await ports.journal.hold(attempt.nonce).catch(() => undefined);
            throw denied();
          }
        },
        hold: async () => {
          finished = true;
          readyToSeal = false;
          if (attempt) {
            publicationHeld = true;
            await ports.journal.hold(attempt.nonce);
          }
        },
      });
    },
  };
}
