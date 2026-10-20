import {
  createCapabilityRuntime,
  defineOperation,
  implementOperation,
  type CapAuthorityVerifier,
  type CapRef,
  type OperationActor,
  type OperationDefinition,
  defineCapEngine,
  defineCapEngineBinding,
} from "@reliverse/cap";
import { invokeBoundCapOperation, type BoundCapEngine } from "@reliverse/cap/invocation";
import {
  createGatehouseActionIntent,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  commitGrCampaignStep,
  fingerprintGrJson,
  GrError,
  pushGrCampaign,
  withGrGitRuntime,
  type GrGitRuntime,
  type GrCampaignPlanV0,
} from "@reliverse/gr";
import {
  assertQualityCandidateVerificationReceipt,
  normalizeJson,
  type QualityCandidateVerificationReceipt,
} from "@reliverse/quality";
import { repoCommitOperation, repoPushOperation } from "@reliverse/repo-cap";

import {
  normalizeGrCampaignReview,
  guardGrCampaignReviewGatehouse,
  type GrCampaignReview,
  type GrCampaignReviewPorts,
} from "./review";

export const GR_CAMPAIGN_EXECUTOR_CLASS = "gr.campaign.v0" as const;
export type GrCampaignAction =
  | { readonly kind: "commit"; readonly commitId: string; readonly expectedBeforeCommit: string }
  | {
      readonly kind: "push";
      readonly expectedHead: string;
      readonly remote: string;
      readonly ref: string;
      readonly remoteUrl: string;
    };
type Bindings = {
  readonly review?: GrCampaignReview;
  readonly plan: GrCampaignPlanV0;
  readonly action: GrCampaignAction;
  readonly quality: QualityCandidateVerificationReceipt;
  readonly qualityPolicyFingerprint: string;
  readonly executionFingerprint: string;
  readonly executorFingerprint: string;
};
type GatehousePort = Pick<
  GatehouseRuntime,
  "inspectGate" | "issueLease" | "consumeLease" | "recordExecution"
>;

function bindings(input: Bindings) {
  if (!input.executorFingerprint)
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "The trusted host must bind its admitted GR executor closure.",
    );
  const { campaignFingerprint, ...semantic } = input.plan;
  if (
    !input.plan.frozen ||
    campaignFingerprint !== fingerprintGrJson(semantic, "gr.campaign-plan.v0")
  )
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Governed Campaign execution requires an intact frozen plan.",
    );
  const tree = input.plan.frozen.candidateTree;
  assertQualityCandidateVerificationReceipt(input.quality, {
    candidateFingerprint: `git-tree:${tree.algorithm}:${tree.oid}`,
    policyFingerprint: input.qualityPolicyFingerprint,
    executionFingerprint: input.executionFingerprint,
  });
  const action = input.action;
  if (action.kind === "push" && !action.ref.startsWith("refs/heads/"))
    throw new GrError(
      "GR_INVALID_ARTIFACT",
      "Governed push requires a fully qualified branch ref.",
    );
  if (
    action.kind === "commit" &&
    !input.plan.scope.commits.some((spec) => spec.id === action.commitId)
  )
    throw new GrError("GR_INVALID_ARTIFACT", "Governed commit is not assigned by the frozen plan.");
  const operation = `gr.campaign.${input.action.kind}`;
  const review = input.review ? normalizeGrCampaignReview(input.review) : undefined;
  const parameters = normalizeJson({
    ...(review ? { review: { ...review } } : {}),
    root: input.plan.repository.root,
    campaignId: input.plan.campaignId,
    campaignFingerprint,
    candidateTree: tree,
    action: input.action,
    qualityReceiptFingerprint: input.quality.receiptFingerprint,
    qualityPolicyFingerprint: input.qualityPolicyFingerprint,
    executionFingerprint: input.executionFingerprint,
    executorFingerprint: input.executorFingerprint,
    publicationMode:
      input.action.kind === "push" ? "strict-fast-forward-exact-old-cas" : "local-commit",
  });
  return {
    operation,
    parameters,
    scope: { campaignFingerprint, operation },
    preconditions: {
      ...(review ? { review: { ...review } } : {}),
      baseCommit: input.plan.base.commit.oid,
      candidateTree: tree,
      action: input.action,
      qualityReceiptFingerprint: input.quality.receiptFingerprint,
      executorFingerprint: input.executorFingerprint,
    },
  };
}

/** A trusted host supplies the frozen bindings and authority verifier, never request JSON.
 * This adapter is not executor admission, identity enrollment or a grant issuer.
 */
export function createGrCampaignCapabilityRuntime(
  host: Bindings & {
    readonly gatehouse: GatehousePort;
    readonly authority: CapAuthorityVerifier;
    readonly operationVocabulary?: "repo";
  },
) {
  const bound = {
    ...host,
    ...(host.review ? { review: normalizeGrCampaignReview(host.review) } : {}),
    plan: normalizeJson(host.plan) as unknown as GrCampaignPlanV0,
    action: normalizeJson(host.action) as unknown as GrCampaignAction,
    quality: normalizeJson(host.quality) as unknown as QualityCandidateVerificationReceipt,
  };
  const b = bindings(bound);
  const operation: OperationDefinition<
    { readonly gateId: string; readonly attemptId: string },
    unknown
  > =
    host.operationVocabulary === "repo"
      ? host.action.kind === "commit"
        ? repoCommitOperation
        : repoPushOperation
      : defineOperation<{ readonly gateId: string; readonly attemptId: string }, unknown>({
          id: b.operation,
          modes: ["apply"],
          requiresApply: true,
          idempotency: "not-idempotent",
          effects: host.action.kind === "commit" ? ["git.commit"] : ["git.push"],
          authority: { required: [b.operation] },
        });
  return createCapabilityRuntime({
    authority: {
      authorize(ref, operation, actor) {
        const authority = host.authority.authorize(ref, operation, actor);
        if (!authority.scopes.includes(bound.plan.campaignFingerprint))
          throw new GrError(
            "GR_NOT_AUTHORIZED",
            "Cap authority does not cover this exact frozen Campaign.",
          );
        return authority;
      },
    },
    createServices: () => ({}),
    registrations: [
      {
        operation,
        source: {
          id: GR_CAMPAIGN_EXECUTOR_CLASS,
          kind: "embedded",
          digest: host.executorFingerprint,
        },
        implementation: implementOperation(operation, {
          execute: async (context, request) => {
            context.assertApplied();
            if (
              !request ||
              typeof request.gateId !== "string" ||
              typeof request.attemptId !== "string" ||
              Object.keys(request).some((key) => key !== "gateId" && key !== "attemptId")
            )
              throw new GrError(
                "GR_INVALID_ARTIFACT",
                "Cap Campaign input accepts only exact Gate and attempt IDs.",
              );
            const receipt = await executeApprovedGrCampaignAction({
              ...bound,
              gateId: request.gateId,
              attemptId: request.attemptId,
            });
            return host.operationVocabulary === "repo"
              ? { operation: operation.id, receipt }
              : receipt;
          },
        }),
      },
    ],
  });
}

/** New semantic contracts wrap the existing exact GR/Gate executor; legacy intents are not renamed. */
export function createGrRepoCampaignBinding(
  host: Parameters<typeof createGrCampaignCapabilityRuntime>[0] & {
    readonly gitRuntime: GrGitRuntime;
    readonly capRef: CapRef;
    readonly actor: OperationActor;
  },
): BoundCapEngine {
  if (
    host.gitRuntime.root !== host.plan.repository.root ||
    host.gitRuntime.closureFingerprint !== host.executorFingerprint
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Repo Engine requires exact admitted Git/executor custody.",
    );
  const operationId = host.action.kind === "commit" ? "repo.commit" : "repo.push";
  const capability = createGrCampaignCapabilityRuntime({ ...host, operationVocabulary: "repo" });
  const gitRuntime = Object.freeze({
    ...host.gitRuntime,
    env: Object.freeze({ ...host.gitRuntime.env }),
  });
  return {
    engine: defineCapEngine({
      schema: "reliverse.cap.engine.v0",
      engineId: "gr",
      version: "0.1.0",
      capabilityIds: ["repo"],
      provides: [{ operationId, modes: ["apply"] }],
      runtimeKinds: ["builtin"],
      targetKinds: ["repository"],
    }),
    binding: defineCapEngineBinding({
      schema: "reliverse.cap.engine-binding.v0",
      bindingId: `${operationId}@${host.plan.campaignFingerprint}`,
      engineId: "gr",
      capabilityId: "repo",
      operationIds: [operationId],
      implementationId: GR_CAMPAIGN_EXECUTOR_CLASS,
      implementationVersion: "0.1.0",
      runtimeKind: "builtin",
      targetRef: host.plan.repository.root,
      source: { kind: "host", id: GR_CAMPAIGN_EXECUTOR_CLASS, digest: host.executorFingerprint },
    }),
    runtime: {
      call: (operation, input, options) =>
        withGrGitRuntime(gitRuntime, async () => {
          await gitRuntime.assertCurrent();
          return capability.call(operation, input, options);
        }),
    },
    callOptions: { capRef: host.capRef, actor: { ...host.actor } },
  };
}

/** Request metadata is not authenticated actor identity or endorsement. */
export function createGrCampaignActionIntent(
  input: Bindings & {
    readonly authority: Pick<
      Parameters<typeof createGatehouseActionIntent>[0],
      "createdAt" | "expiresAt" | "requester" | "actor" | "accountableSystem" | "policy"
    >;
  },
) {
  const b = bindings(input);
  return createGatehouseActionIntent({
    ...input.authority,
    action: {
      kind: b.operation,
      effectClass: input.action.kind === "commit" ? "git.commit" : "git.push",
      authorityImpact: "none",
    },
    target: { kind: "repository", id: input.plan.repository.fingerprint, parameters: b.parameters },
    preconditions: b.preconditions,
    requestedCapability: {
      capability: b.operation,
      executorClass: GR_CAMPAIGN_EXECUTOR_CLASS,
      scope: b.scope,
    },
    presentation: {
      title: `GR Campaign ${input.action.kind}`,
      summary: `Exact frozen ${input.plan.campaignId} action.`,
      consequences: [
        input.action.kind === "commit"
          ? "Create one reviewed semantic commit."
          : "Publish the exact reviewed final HEAD; no automatic retry.",
      ],
    },
    reversibility: input.action.kind === "commit" ? "reversible" : "irreversible",
    risk: "high",
  });
}

/** A host composition binds one push; CLI input cannot select another plan or destination.
 * Admission and authenticated Cap issuance remain the host's responsibility.
 */
function createGrCampaignOwnerMutationHost(
  input: Bindings & {
    readonly contextRoot: string;
    readonly gitRuntime: GrGitRuntime;
    readonly ownerUid: number;
    readonly gatehouse: GatehousePort;
    readonly authority: CapAuthorityVerifier;
    readonly capRef: CapRef;
    readonly actor: OperationActor;
    readonly gateId: string;
    readonly attemptId: string;
  },
) {
  if (
    !input.gitRuntime ||
    input.gitRuntime.closureFingerprint !== input.executorFingerprint ||
    input.gitRuntime.root !== input.plan.repository.root
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Owner push requires the exact admitted Git/executor closure and repository root.",
    );

  if (!Number.isSafeInteger(input.ownerUid) || input.ownerUid <= 0)
    throw new GrError("GR_NOT_AUTHORIZED", "An exact non-root owner UID is required.");
  const bound = {
    ...input,
    ...(input.review ? { review: normalizeGrCampaignReview(input.review) } : {}),
    plan: normalizeJson(input.plan) as unknown as GrCampaignPlanV0,
    action: normalizeJson(input.action) as unknown as typeof input.action,
    quality: normalizeJson(input.quality) as unknown as QualityCandidateVerificationReceipt,
    actor: { ...input.actor },
    gitRuntime: Object.freeze({
      ...input.gitRuntime,
      env: Object.freeze({ ...input.gitRuntime.env }),
    }),
  };
  const binding = createGrRepoCampaignBinding(bound);
  const operation =
    bound.action.kind === "push" ? ("repo.push" as const) : ("repo.commit" as const);
  return Object.freeze({
    operation,
    contextRoot: input.contextRoot,
    ownerUid: input.ownerUid,
    async inspect() {
      await bound.gitRuntime.assertCurrent();
      return inspectGrCampaignOwnerAction(bound);
    },
    async execute() {
      return withGrGitRuntime(bound.gitRuntime, async () => {
        await bound.gitRuntime.assertCurrent();
        return invokeBoundCapOperation([binding], {
          capabilityId: "repo",
          operationId: operation,
          engineId: "gr",
          mode: "apply",
          apply: true,
          targetRef: bound.plan.repository.root,
          input: { gateId: bound.gateId, attemptId: bound.attemptId },
        });
      });
    },
  });
}

/** Shared nonmutating preview; authentication hosts must not mint a CapRef merely
 * to inspect an exact Gate action. */
export async function inspectGrCampaignOwnerAction(
  bound: Bindings & { readonly gatehouse: GatehousePort; readonly gateId: string },
) {
  const gate = await inspectGrCampaignAction(bound);
  const operation =
    bound.action.kind === "push" ? ("repo.push" as const) : ("repo.commit" as const);
  return {
    operation: `gr.campaign.${bound.action.kind}`,
    capOperation: operation,
    campaignId: bound.plan.campaignId,
    candidateTree: { ...bound.plan.frozen!.candidateTree },
    campaignFingerprint: bound.plan.campaignFingerprint,
    ...(bound.review ? { review: { ...bound.review } } : {}),
    ...(bound.action.kind === "push"
      ? {
          remote: bound.action.remoteUrl,
          ref: bound.action.ref,
          expectedOld: bound.plan.base.commit.oid,
          newHead: bound.action.expectedHead,
        }
      : {
          commitId: bound.action.commitId,
          expectedBeforeCommit: bound.action.expectedBeforeCommit,
        }),
    executorFingerprint: bound.executorFingerprint,
    qualityReceiptFingerprint: bound.quality.receiptFingerprint,
    gateId: bound.gateId,
    gateStatus: gate.effectiveStatus,
    automaticRetry: false,
  };
}

export function createGrCampaignOwnerPushHost(
  input: Parameters<typeof createGrCampaignOwnerMutationHost>[0] & {
    readonly action: Extract<GrCampaignAction, { kind: "push" }>;
  },
) {
  if (input.action.kind !== "push")
    throw new GrError("GR_NOT_AUTHORIZED", "Owner push cannot bind a commit.");
  return createGrCampaignOwnerMutationHost(input);
}
export function createGrCampaignOwnerCommitHost(
  input: Parameters<typeof createGrCampaignOwnerMutationHost>[0] & {
    readonly action: Extract<GrCampaignAction, { kind: "commit" }>;
  },
) {
  if (input.action.kind !== "commit")
    throw new GrError("GR_NOT_AUTHORIZED", "Owner commit cannot bind a push.");
  return createGrCampaignOwnerMutationHost(input);
}

/** Production review composition over the existing Gate/signature protocol. The
 * trusted host must supply actual protected execution/key custody admission. */
export function createGrCampaignReviewedOwnerCommitHost(
  input: Parameters<typeof createGrCampaignOwnerCommitHost>[0] & {
    readonly review: GrCampaignReview;
    readonly reviewPorts: GrCampaignReviewPorts;
  },
) {
  return createGrCampaignOwnerCommitHost({
    ...input,
    gatehouse: guardGrCampaignReviewGatehouse(input.gatehouse, input.review, input.reviewPorts),
  });
}

export function createGrCampaignReviewedOwnerPushHost(
  input: Parameters<typeof createGrCampaignOwnerPushHost>[0] & {
    readonly review: GrCampaignReview;
    readonly reviewPorts: GrCampaignReviewPorts;
  },
) {
  return createGrCampaignOwnerPushHost({
    ...input,
    gatehouse: guardGrCampaignReviewGatehouse(input.gatehouse, input.review, input.reviewPorts),
  });
}

/** Read-only exact Gate inspection; not lease issuance or execution permission. */
export async function inspectGrCampaignAction(
  input: Bindings & { readonly gatehouse: GatehousePort; readonly gateId: string },
) {
  const plan = input.plan;
  const action = input.action;
  const b = bindings(input);
  const gate = await input.gatehouse.inspectGate(input.gateId);
  if (
    !gate ||
    gate.intent.action.kind !== b.operation ||
    gate.intent.action.effectClass !== (action.kind === "commit" ? "git.commit" : "git.push") ||
    gate.intent.risk !== "high" ||
    gate.intent.target.kind !== "repository" ||
    gate.intent.target.id !== plan.repository.fingerprint ||
    gate.intent.target.parametersDigest !== fingerprintGatehouseValue(b.parameters) ||
    gate.intent.preconditions.digest !== fingerprintGatehouseValue(b.preconditions) ||
    gate.intent.requestedCapability.capability !== b.operation ||
    gate.intent.requestedCapability.executorClass !== GR_CAMPAIGN_EXECUTOR_CLASS ||
    gate.intent.requestedCapability.scopeDigest !== fingerprintGatehouseValue(b.scope)
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Campaign action does not match the canonical Gate intent.",
    );
  return gate;
}

/** Trusted host injection only: caller effect strings, labels and hashes are not Gate authority.
 * The host must separately admit startup/custody and authentic RQ proof before live use.
 */
export async function executeApprovedGrCampaignAction(
  input: Bindings & {
    readonly gatehouse: GatehousePort;
    readonly gateId: string;
    readonly attemptId: string;
  },
) {
  if (!input.gateId || !input.attemptId)
    throw new GrError("GR_NOT_AUTHORIZED", "Exact Gate and attempt identities are required.");
  const plan = normalizeJson(input.plan) as unknown as GrCampaignPlanV0;
  const action = normalizeJson(input.action) as unknown as GrCampaignAction;
  const quality = normalizeJson(input.quality) as unknown as QualityCandidateVerificationReceipt;
  const b = bindings({ ...input, plan, action, quality });
  const gate = await inspectGrCampaignAction({ ...input, plan, action, quality });
  if (gate.effectiveStatus !== "quorum-satisfied" && gate.effectiveStatus !== "lease-issued")
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Campaign requires independent current Gate approval; consumed/uncertain history grants no retry.",
    );
  const intent = gate.intent;
  const lease = await input.gatehouse.issueLease({
    gateId: input.gateId,
    preconditionDigest: intent.preconditions.digest,
  });
  if (
    lease.gateId !== input.gateId ||
    lease.intentDigest !== intent.digest ||
    lease.capability !== b.operation ||
    lease.executorClass !== GR_CAMPAIGN_EXECUTOR_CLASS ||
    lease.targetDigest !== intent.target.digest ||
    lease.scopeDigest !== intent.requestedCapability.scopeDigest ||
    lease.preconditionDigest !== intent.preconditions.digest
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Issued Campaign lease does not match the exact Gate bindings.",
    );
  const consumed = await input.gatehouse.consumeLease({
    attemptId: input.attemptId,
    leaseId: lease.id,
    capability: b.operation,
    executorClass: GR_CAMPAIGN_EXECUTOR_CLASS,
    intentDigest: intent.digest,
    preconditionDigest: intent.preconditions.digest,
    scopeDigest: intent.requestedCapability.scopeDigest,
    targetDigest: intent.target.digest,
  });
  if (
    consumed.gateId !== input.gateId ||
    consumed.leaseId !== lease.id ||
    consumed.attemptId !== input.attemptId ||
    consumed.intentDigest !== intent.digest ||
    consumed.capability !== b.operation ||
    consumed.executorClass !== GR_CAMPAIGN_EXECUTOR_CLASS ||
    consumed.targetDigest !== intent.target.digest ||
    consumed.scopeDigest !== intent.requestedCapability.scopeDigest ||
    consumed.preconditionDigest !== intent.preconditions.digest
  )
    throw new GrError(
      "GR_NOT_AUTHORIZED",
      "Campaign lease consumption does not match the retained exact attempt.",
    );
  let result;
  try {
    result =
      action.kind === "commit"
        ? await commitGrCampaignStep({
            root: plan.repository.root,
            plan,
            commitId: action.commitId,
            expectedBeforeCommit: action.expectedBeforeCommit,
            grantedEffects: ["filesystem.read", "git.read", "git.write"],
          })
        : await pushGrCampaign({
            root: plan.repository.root,
            plan,
            remote: action.remote,
            ref: action.ref,
            expectedRemoteUrl: action.remoteUrl,
            expectedHead: action.expectedHead,
            grantedEffects: ["git.read", "git.write", "network.write"],
          });
  } catch (error) {
    // Do not invent rollback, absence, a second attempt, or a parallel GR receipt ledger.
    await input.gatehouse
      .recordExecution({
        gateId: input.gateId,
        attemptId: input.attemptId,
        leaseId: lease.id,
        consumptionId: consumed.id,
        outcome: "outcome-unknown",
        uncertainty:
          "GR did not obtain a verified consequential result; inspect retained Git/Gate state before reconciliation.",
      })
      .catch(() => undefined);
    throw error;
  }
  try {
    const execution = await input.gatehouse.recordExecution({
      gateId: input.gateId,
      attemptId: input.attemptId,
      leaseId: lease.id,
      consumptionId: consumed.id,
      outcome: "completed",
      resultDigest: fingerprintGatehouseValue(result),
    });
    return { result, execution };
  } catch (error) {
    const failure = new GrError(
      "GR_STALE_STATE",
      "GR result exists but Gate finalization is unverified; no automatic retry.",
      { outcome: "uncertain" },
    );
    failure.cause = error;
    throw failure;
  }
}
