import { randomUUID } from "node:crypto";

import type { AuthSessionV0 } from "@reliverse/auth";
import { createCapAuthority } from "@reliverse/cap";
import { GrError, type GrGitRuntime } from "@reliverse/gr";

import {
  createGrCampaignOwnerCommitHost,
  createGrCampaignOwnerPushHost,
  inspectGrCampaignAction,
  inspectGrCampaignOwnerAction,
  type GrCampaignAction,
} from "./campaign";
import {
  guardGrCampaignReviewGatehouse,
  normalizeGrCampaignReview,
  type GrCampaignReviewPorts,
} from "./review";

export const GR_OWNER_AUTH_ISSUER = "gr.protected-owner-terminal";
export const GR_OWNER_AUTH_AUDIENCE = "gr.owner-control";
export const GR_OWNER_AUTH_RESOURCE = "github:reliverse/reliverse";
const denied = () => new GrError("GR_NOT_AUTHORIZED", "GR_OWNER_EXECUTION_AUTH_UNVERIFIED");
export interface GrOwnerExecutionAuthPin {
  readonly principalId: string;
  readonly sessionId: string;
  readonly author: { readonly name: string; readonly email: string };
}

/** Checks canonical Auth metadata supplied by the protected store adapter. This
 * function is not a verifier for caller JSON, nor a Cap/Gate grant issuer. */
export function assertGrOwnerExecutionSession(
  session: AuthSessionV0,
  pin: GrOwnerExecutionAuthPin,
  now: Date,
) {
  if (
    !/^prn_[a-f0-9]{32}$/.test(pin.principalId) ||
    !/^auth_session_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      pin.sessionId,
    ) ||
    session.schema !== "reliverse.auth.session.v0" ||
    session.id !== pin.sessionId ||
    session.status !== "active" ||
    session.principal.id !== pin.principalId ||
    session.principal.kind !== "human" ||
    session.client.id !== "os-user.uid-995" ||
    session.client.kind !== "confidential" ||
    session.issuer !== GR_OWNER_AUTH_ISSUER ||
    session.assurance !== "verified" ||
    JSON.stringify(session.scopes) !== JSON.stringify(["identity.observe"]) ||
    JSON.stringify(session.audiences) !== JSON.stringify([GR_OWNER_AUTH_AUDIENCE]) ||
    JSON.stringify(session.resources) !== JSON.stringify([GR_OWNER_AUTH_RESOURCE]) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(Date.parse(session.createdAt)) ||
    Date.parse(session.createdAt) > now.getTime() ||
    !session.expiresAt ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= now.getTime() ||
    Date.parse(session.expiresAt) - Date.parse(session.createdAt) > 5 * 3600000
  )
    throw denied();
}

type Input = Omit<
  Parameters<typeof createGrCampaignOwnerCommitHost>[0],
  "authority" | "capRef" | "actor" | "action"
> & {
  readonly action: GrCampaignAction;
  readonly review: NonNullable<Parameters<typeof createGrCampaignOwnerCommitHost>[0]["review"]>;
  readonly reviewPorts: GrCampaignReviewPorts;
  readonly ownerAuth: GrOwnerExecutionAuthPin;
};

/** Native startup owns both canonical readers. Identity-only Auth is necessary,
 * never sufficient: only a freshly reverified exact Gate quorum can back the
 * in-memory, one-operation/one-Campaign/one-invocation CapRef used internally.
 * No CapRef is created for preview or returned to a courier. */
export function createGrAuthenticatedReviewedOwnerHost(
  input: Input,
  ports: {
    readonly now: () => Date;
    readonly readCurrentOwner: () => Promise<AuthSessionV0 | undefined>;
  },
) {
  const { gitRuntime: suppliedGit, gatehouse: suppliedGate, reviewPorts, ...data } = input;
  const bound = structuredClone(data);
  const review = normalizeGrCampaignReview(bound.review);
  if (
    bound.ownerUid !== 995 ||
    bound.ownerAuth.principalId !== review.ownerPrincipalId ||
    !bound.ownerAuth.author.name.trim() ||
    /[\r\n\0<>]/.test(bound.ownerAuth.author.name) ||
    !/^[^\s@<>\0]+@[^\s@<>\0]+$/.test(bound.ownerAuth.author.email)
  )
    throw denied();
  const baseGit: GrGitRuntime = Object.freeze({
    ...suppliedGit,
    env: Object.freeze({ ...suppliedGit.env }),
  });
  if (
    baseGit.root !== bound.plan.repository.root ||
    baseGit.root !== bound.contextRoot ||
    baseGit.closureFingerprint !== bound.executorFingerprint ||
    baseGit.env.GIT_AUTHOR_NAME !== bound.ownerAuth.author.name ||
    baseGit.env.GIT_COMMITTER_NAME !== bound.ownerAuth.author.name ||
    baseGit.env.GIT_AUTHOR_EMAIL !== bound.ownerAuth.author.email ||
    baseGit.env.GIT_COMMITTER_EMAIL !== bound.ownerAuth.author.email
  )
    throw denied();
  const current = async () => {
    await baseGit.assertCurrent();
    const session = structuredClone(await ports.readCurrentOwner());
    if (!session) throw denied();
    assertGrOwnerExecutionSession(session, bound.ownerAuth, ports.now());
    return session;
  };
  const gitRuntime: GrGitRuntime = Object.freeze({
    ...baseGit,
    assertCurrent: async () => {
      await current();
    },
  });
  const gatehouse = guardGrCampaignReviewGatehouse(suppliedGate, review, reviewPorts);
  const operation =
    bound.action.kind === "commit" ? ("repo.commit" as const) : ("repo.push" as const);
  let attempted = false;
  return Object.freeze({
    operation,
    contextRoot: bound.contextRoot,
    ownerUid: bound.ownerUid,
    async inspect() {
      await current();
      const result = await inspectGrCampaignOwnerAction({ ...bound, gatehouse });
      await current();
      return result;
    },
    async execute() {
      // Reserve before the first await: concurrent/repeated invocation cannot
      // mint a second CapRef, even when the first call fails before consumption.
      if (attempted) throw denied();
      attempted = true;
      await current();
      const approved = await inspectGrCampaignAction({ ...bound, gatehouse });
      const session = await current();
      if (
        !["quorum-satisfied", "lease-issued"].includes(approved.effectiveStatus) ||
        !approved.approvalBundle ||
        approved.approvalBundle.status !== "quorum-satisfied" ||
        approved.intent.policy.authority.independence !== "distinct-perspectives" ||
        approved.intent.requester.kind !== "human" ||
        approved.intent.requester.id !== bound.ownerAuth.principalId ||
        approved.intent.requestedCapability.maxAttempts !== 1 ||
        approved.consumption ||
        approved.execution
      )
        throw denied();
      const instant = ports.now();
      const expiresAt = Math.min(
        Date.parse(session.expiresAt!),
        Date.parse(approved.gate.expiresAt),
      );
      if (!Number.isFinite(expiresAt) || expiresAt <= instant.getTime()) throw denied();
      const issuer = "gr.protected-owner-gate";
      const authority = createCapAuthority({ issuer, now: ports.now });
      const capRef = authority.acceptGrant(
        {
          id: `gr-gate-grant:${randomUUID()}`,
          issuer,
          subject: bound.ownerAuth.principalId,
          capabilityId: "repo",
          operationIds: [operation],
          scopes: [bound.plan.campaignFingerprint],
          issuedAt: instant.toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          maxInvocations: 1,
          decisionReceiptId: approved.approvalBundle.id,
        },
        `gr-gate-cap:${randomUUID()}`,
      );
      const host = {
        ...bound,
        gitRuntime,
        gatehouse,
        authority,
        capRef,
        actor: { id: bound.ownerAuth.principalId, kind: "human" as const },
      };
      return bound.action.kind === "commit"
        ? createGrCampaignOwnerCommitHost({ ...host, action: bound.action }).execute()
        : createGrCampaignOwnerPushHost({ ...host, action: bound.action }).execute();
    },
  });
}
