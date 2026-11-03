import {
  assertGatehouseActionIntent,
  createGatehouseActionIntent,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
  type GatehouseJson,
} from "@reliverse/gatehouse-protocol";

export const GATEHOUSE_BOUNDED_PLAN_SCHEMA = "gatehouse.bounded-plan.v0" as const;
export interface GatehouseBoundedPlan {
  readonly schema: typeof GATEHOUSE_BOUNDED_PLAN_SCHEMA;
  readonly entries: readonly { readonly semantics: GatehouseJson; readonly maxUses: number }[];
}
export interface GatehouseBoundedPlanClaim {
  readonly schema: "gatehouse.bounded-plan-claim.v0";
  readonly id: string;
  readonly planGateId: string;
  readonly planDigest: string;
  readonly approvalBundleId: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly semanticDigest: string;
  readonly reservedAt: string;
  readonly expiresAt: string;
}

/** Only protocol identity/time and explicitly informational correlation are excluded.
 * Unknown fields, including nested scope and precondition fields, remain bound. */
export function fingerprintGatehouseIntentSemantics(intent: GatehouseActionIntent): string {
  return fingerprintGatehouseValue(projectGatehouseIntentSemantics(intent));
}
export function projectGatehouseIntentSemantics(intent: GatehouseActionIntent): GatehouseJson {
  assertGatehouseActionIntent(intent);
  const {
    id: _id,
    digest: _digest,
    nonce: _nonce,
    createdAt: _created,
    expiresAt: _expires,
    correlation,
    ...facts
  } = intent;
  const { runId: _run, traceId: _trace, ...semanticCorrelation } = correlation ?? {};
  return {
    ...facts,
    ...(Object.keys(semanticCorrelation).length ? { correlation: semanticCorrelation } : {}),
  } as unknown as GatehouseJson;
}

export function readGatehouseBoundedPlan(intent: GatehouseActionIntent): GatehouseBoundedPlan {
  assertGatehouseActionIntent(intent);
  const value = intent.requestedCapability.scope as unknown as GatehouseBoundedPlan;
  if (
    intent.action.kind !== "gatehouse.bounded-plan" ||
    intent.action.effectClass !== "gatehouse.authority" ||
    intent.action.authorityImpact !== "expand" ||
    intent.requestedCapability.capability !== "gatehouse.bounded-plan" ||
    intent.requestedCapability.executorClass !== "gatehouse-runtime" ||
    value?.schema !== GATEHOUSE_BOUNDED_PLAN_SCHEMA ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > 16 ||
    Object.keys(value).some((key) => !["schema", "entries"].includes(key))
  )
    throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
  if (
    !["high", "critical"].includes(intent.risk) ||
    intent.requestedCapability.maxAttempts !== 1 ||
    intent.target.kind !== "bounded-plan" ||
    intent.target.id !== fingerprintGatehouseValue(value) ||
    fingerprintGatehouseValue(intent.target.parameters) !== fingerprintGatehouseValue(value) ||
    fingerprintGatehouseValue(intent.preconditions.facts) !==
      fingerprintGatehouseValue({ planDigest: fingerprintGatehouseValue(value) })
  )
    throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
  const digests = new Set<string>();
  let uses = 0;
  for (const entry of value.entries) {
    if (
      !entry ||
      Object.keys(entry).some((key) => !["semantics", "maxUses"].includes(key)) ||
      !Number.isSafeInteger(entry.maxUses) ||
      entry.maxUses < 1 ||
      entry.maxUses > 100 ||
      !entry.semantics ||
      typeof entry.semantics !== "object" ||
      Array.isArray(entry.semantics)
    )
      throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
    const digest = fingerprintGatehouseValue(entry.semantics);
    if (digests.has(digest)) throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
    digests.add(digest);
    uses += entry.maxUses;
  }
  if (uses > 100 || Date.parse(intent.expiresAt) - Date.parse(intent.createdAt) > 86_400_000)
    throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
  return value;
}

export function createGatehouseBoundedPlanIntent(input: {
  readonly entries: readonly { readonly intent: GatehouseActionIntent; readonly maxUses: number }[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly title: string;
  readonly summary: string;
}): GatehouseActionIntent {
  const first = input.entries[0]?.intent;
  if (!first) throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
  for (const { intent } of input.entries) {
    assertGatehouseActionIntent(intent);
    if (
      intent.action.authorityImpact !== "none" ||
      !["low", "moderate"].includes(intent.risk) ||
      !["reversible", "compensatable"].includes(intent.reversibility) ||
      intent.requestedCapability.maxAttempts !== 1 ||
      intent.action.kind.startsWith("gatehouse.") ||
      Date.parse(input.expiresAt) > Date.parse(intent.expiresAt) ||
      fingerprintGatehouseValue({
        requester: intent.requester,
        actor: intent.actor,
        accountableSystem: intent.accountableSystem,
        authority: intent.policy.authority,
      }) !==
        fingerprintGatehouseValue({
          requester: first.requester,
          actor: first.actor,
          accountableSystem: first.accountableSystem,
          authority: first.policy.authority,
        })
    )
      throw new Error("GATEHOUSE_BOUNDED_PLAN_INVALID");
  }
  const plan: GatehouseBoundedPlan = {
    schema: GATEHOUSE_BOUNDED_PLAN_SCHEMA,
    entries: input.entries.map(({ intent, maxUses }) => ({
      semantics: projectGatehouseIntentSemantics(intent),
      maxUses,
    })),
  };
  const intent = createGatehouseActionIntent({
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    action: {
      kind: "gatehouse.bounded-plan",
      effectClass: "gatehouse.authority",
      authorityImpact: "expand",
    },
    requester: first.requester,
    actor: first.actor,
    accountableSystem: first.accountableSystem,
    target: {
      kind: "bounded-plan",
      id: fingerprintGatehouseValue(plan),
      parameters: plan as unknown as GatehouseJson,
    },
    preconditions: { planDigest: fingerprintGatehouseValue(plan) },
    requestedCapability: {
      capability: "gatehouse.bounded-plan",
      executorClass: "gatehouse-runtime",
      maxAttempts: 1,
      scope: plan as unknown as GatehouseJson,
    },
    policy: {
      id: "gatehouse.bounded-plan.v0",
      digest: fingerprintGatehouseValue({ plan, authority: first.policy.authority }),
      authority: first.policy.authority,
    },
    presentation: {
      title: input.title,
      summary: input.summary,
      consequences: [
        "Only the exact reviewed semantic envelopes are permitted, with their declared finite use limits.",
        "Each concrete action receives a fresh one-shot lease. Claims are never refunded, including failed or uncertain outcomes.",
        "Actions are serialized. Expiry, revocation, denial, or a failed/uncertain predecessor blocks further use.",
      ],
    },
    reversibility: "reversible",
    risk: "high",
  });
  readGatehouseBoundedPlan(intent);
  return intent;
}
