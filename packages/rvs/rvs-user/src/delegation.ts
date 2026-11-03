import type { ReliversePrincipalId } from "@reliverse/home";

import type { RvsUserActorRef, RvsUserPrincipalRef } from "./identity";

export const RVS_USER_DELEGATION_SCHEMA = "rvs.user.delegation.v0" as const;
export const RVS_USER_EXECUTION_IDENTITY_SCHEMA = "rvs.user.execution-identity.v0" as const;

export interface RvsUserAuthorityRef {
  readonly kind: "cap-grant" | "gatehouse-execution-lease" | "delegation-claim";
  readonly id: string;
  readonly digest: `sha256:${string}`;
}

export type RvsUserExecutionPlacementKind =
  | "local"
  | "gateway"
  | "process"
  | "wasm"
  | "service"
  | "remote";

export interface RvsUserAuthorityEnvelope {
  readonly capabilities: readonly string[];
  readonly resourceScopes: readonly string[];
  readonly effectClasses: readonly string[];
  readonly executionPlacements: readonly RvsUserExecutionPlacementKind[];
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly maxCostMicros: number;
  readonly remainingDelegationDepth: number;
  readonly redelegation: boolean;
}

export interface RvsUserDelegation {
  readonly schema: typeof RVS_USER_DELEGATION_SCHEMA;
  readonly id: string;
  readonly delegator: RvsUserActorRef;
  readonly delegate: RvsUserActorRef;
  readonly actingFor: RvsUserPrincipalRef;
  readonly parentDelegationId?: string | undefined;
  readonly authorityRefs: readonly RvsUserAuthorityRef[];
  readonly envelope: RvsUserAuthorityEnvelope;
  readonly purpose: string;
  readonly workTurnId?: string | undefined;
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt?: string | undefined;
  readonly revokedByPrincipalId?: ReliversePrincipalId | undefined;
  readonly revocationReason?: string | undefined;
}

export interface RvsUserExecutionPlacement {
  readonly kind: RvsUserExecutionPlacementKind;
  readonly providerId: string;
  readonly targetId: string;
}

export interface RvsUserExecutionMaterialization {
  readonly executionContextId: string;
  readonly placement: RvsUserExecutionPlacement;
  readonly computerId?: string | undefined;
  readonly gatewayId?: string | undefined;
  /** Reference to an independently admitted isolation policy/host binding.
   * Logical identity; never an inferred UID, PID or sandbox guarantee. */
  readonly executionDomain?: RvsUserExecutionDomainBinding | undefined;
}

export interface RvsUserExecutionDomainBinding {
  readonly id: string;
  readonly policyDigest: `sha256:${string}`;
  readonly bindingRef: string;
}

export interface RvsUserExecutionMaterializationEvent extends RvsUserExecutionMaterialization {
  readonly at: string;
}

export interface RvsUserExecutionIdentity {
  readonly schema: typeof RVS_USER_EXECUTION_IDENTITY_SCHEMA;
  readonly id: string;
  readonly actor: RvsUserActorRef;
  readonly actingFor: RvsUserPrincipalRef;
  /** Present for Rse-bound work; deterministic Harness/Cap execution may omit it. */
  readonly workTurnId?: string | undefined;
  readonly runId: string;
  readonly authorityRefs: readonly RvsUserAuthorityRef[];
  readonly delegationIds: readonly string[];
  readonly revision: number;
  readonly materialization: RvsUserExecutionMaterialization;
  readonly materializationHistory: readonly RvsUserExecutionMaterializationEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function token(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/u.test(normalized)) throw new Error(`RVS_USER_TOKEN_INVALID: ${label}`);
  return normalized;
}

function time(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`RVS_USER_TIME_INVALID: ${label}`);
  return value;
}

function boundedInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`RVS_USER_BOUND_INVALID: ${label}`);
  }
  return value;
}

function normalizedSet(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value) => token(value, label));
  return Object.freeze([...new Set(normalized)].sort());
}

function authorityRef(value: RvsUserAuthorityRef): RvsUserAuthorityRef {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.digest)) {
    throw new Error("RVS_USER_AUTHORITY_DIGEST_INVALID");
  }
  return Object.freeze({ ...value, id: token(value.id, "Authority id") });
}

function envelope(value: RvsUserAuthorityEnvelope): RvsUserAuthorityEnvelope {
  return Object.freeze({
    capabilities: normalizedSet(value.capabilities, "Capability"),
    resourceScopes: normalizedSet(value.resourceScopes, "Resource scope"),
    effectClasses: normalizedSet(value.effectClasses, "Effect class"),
    executionPlacements: Object.freeze([...new Set(value.executionPlacements)].sort()),
    expiresAt: time(value.expiresAt, "Delegation expiresAt"),
    maxUses: boundedInteger(value.maxUses, "maxUses"),
    maxCostMicros: boundedInteger(value.maxCostMicros, "maxCostMicros"),
    remainingDelegationDepth: boundedInteger(
      value.remainingDelegationDepth,
      "remainingDelegationDepth",
    ),
    redelegation: value.redelegation,
  });
}

function assertSubset<T>(child: readonly T[], parent: readonly T[], label: string): void {
  const parentSet = new Set(parent);
  if (child.some((item) => !parentSet.has(item))) {
    throw new Error(`RVS_USER_DELEGATION_AMPLIFICATION: ${label}`);
  }
}

function assertAttenuated(child: RvsUserAuthorityEnvelope, parent: RvsUserAuthorityEnvelope): void {
  assertSubset(child.capabilities, parent.capabilities, "capabilities");
  assertSubset(child.resourceScopes, parent.resourceScopes, "resourceScopes");
  assertSubset(child.effectClasses, parent.effectClasses, "effectClasses");
  assertSubset(child.executionPlacements, parent.executionPlacements, "executionPlacements");
  if (Date.parse(child.expiresAt) > Date.parse(parent.expiresAt)) {
    throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: expiresAt");
  }
  if (child.maxUses > parent.maxUses) {
    throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: maxUses");
  }
  if (child.maxCostMicros > parent.maxCostMicros) {
    throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: maxCostMicros");
  }
  if (child.remainingDelegationDepth >= parent.remainingDelegationDepth) {
    throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: remainingDelegationDepth");
  }
  if (child.redelegation && !parent.redelegation) {
    throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: redelegation");
  }
}

export function resolveRvsUserDelegationExpiry(input: {
  readonly duration: string;
  readonly issuedAt: string;
  readonly authorityExpiresAt: readonly string[];
}): string {
  const match = /^([1-9][0-9]*)(h|d)$/u.exec(input.duration);
  if (!match) throw new Error("RVS_USER_DELEGATION_DURATION_INVALID");
  const count = Number(match[1]);
  const milliseconds = count * (match[2] === "h" ? 3_600_000 : 86_400_000);
  const start = Date.parse(time(input.issuedAt, "Delegation issuedAt"));
  const end = start + milliseconds;
  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(milliseconds) ||
    !Number.isSafeInteger(end) ||
    !Number.isFinite(new Date(end).getTime())
  ) {
    throw new Error("RVS_USER_DELEGATION_DURATION_INVALID");
  }
  if (input.authorityExpiresAt.length === 0)
    throw new Error("RVS_USER_DELEGATION_VALIDITY_BOUND_REQUIRED");
  for (const bound of input.authorityExpiresAt) {
    if (end > Date.parse(time(bound, "Authority expiresAt"))) {
      throw new Error("RVS_USER_DELEGATION_AMPLIFICATION: expiresAt");
    }
  }
  return new Date(end).toISOString();
}

export function createRvsUserDelegationForDuration(
  input: Omit<Parameters<typeof createRvsUserDelegation>[0], "envelope" | "createdAt"> & {
    readonly envelope: Omit<RvsUserAuthorityEnvelope, "expiresAt">;
    readonly duration: string;
    readonly authorityExpiresAt: readonly string[];
    readonly createdAt?: string;
  },
): RvsUserDelegation {
  const {
    duration,
    authorityExpiresAt,
    createdAt = new Date().toISOString(),
    envelope: bounds,
    ...identity
  } = input;
  return createRvsUserDelegation({
    ...identity,
    createdAt,
    envelope: {
      ...bounds,
      expiresAt: resolveRvsUserDelegationExpiry({
        duration,
        issuedAt: createdAt,
        authorityExpiresAt,
      }),
    },
  });
}

export function createRvsUserDelegation(input: {
  readonly id: string;
  readonly delegator: RvsUserActorRef;
  readonly delegate: RvsUserActorRef;
  readonly actingFor: RvsUserPrincipalRef;
  readonly authorityRefs: readonly RvsUserAuthorityRef[];
  readonly envelope: RvsUserAuthorityEnvelope;
  readonly purpose: string;
  readonly workTurnId?: string | undefined;
  readonly createdAt?: string | undefined;
}): RvsUserDelegation {
  if (input.authorityRefs.length === 0) throw new Error("RVS_USER_AUTHORITY_REF_REQUIRED");
  const createdAt = time(input.createdAt ?? new Date().toISOString(), "Delegation createdAt");
  const delegatedEnvelope = envelope(input.envelope);
  if (Date.parse(delegatedEnvelope.expiresAt) <= Date.parse(createdAt)) {
    throw new Error("RVS_USER_DELEGATION_EXPIRED_AT_CREATION");
  }
  return Object.freeze({
    schema: RVS_USER_DELEGATION_SCHEMA,
    id: token(input.id, "Delegation id"),
    delegator: Object.freeze({ ...input.delegator }),
    delegate: Object.freeze({ ...input.delegate }),
    actingFor: Object.freeze({ ...input.actingFor }),
    authorityRefs: Object.freeze(input.authorityRefs.map(authorityRef)),
    envelope: delegatedEnvelope,
    purpose: input.purpose.trim() || "delegated work",
    ...(input.workTurnId ? { workTurnId: token(input.workTurnId, "WorkTurn id") } : {}),
    status: "active",
    createdAt,
  });
}

export function assertRvsUserDelegationUsable(
  chain: readonly RvsUserDelegation[],
  at = new Date().toISOString(),
): void {
  if (chain.length === 0) throw new Error("RVS_USER_DELEGATION_CHAIN_REQUIRED");
  const instant = Date.parse(time(at, "Delegation use time"));
  const seen = new Set<string>();
  const root = chain[0];
  const rootAuthority = root?.authorityRefs
    .map((item) => `${item.kind}\0${item.id}\0${item.digest}`)
    .join("\0");
  for (const [index, item] of chain.entries()) {
    if (seen.has(item.id)) throw new Error("RVS_USER_DELEGATION_CHAIN_CYCLE");
    seen.add(item.id);
    if (item.status !== "active") throw new Error("RVS_USER_DELEGATION_REVOKED");
    if (Date.parse(item.createdAt) > instant) throw new Error("RVS_USER_DELEGATION_NOT_YET_ACTIVE");
    if (Date.parse(item.envelope.expiresAt) <= instant) {
      throw new Error("RVS_USER_DELEGATION_EXPIRED");
    }
    const parent = chain[index - 1];
    if (parent) {
      const itemAuthority = item.authorityRefs
        .map((value) => `${value.kind}\0${value.id}\0${value.digest}`)
        .join("\0");
      if (
        item.parentDelegationId !== parent.id ||
        item.delegator.id !== parent.delegate.id ||
        item.actingFor.id !== root?.actingFor.id ||
        itemAuthority !== rootAuthority ||
        Date.parse(item.createdAt) < Date.parse(parent.createdAt)
      ) {
        throw new Error("RVS_USER_DELEGATION_CHAIN_INVALID");
      }
      assertAttenuated(item.envelope, parent.envelope);
    } else if (item.parentDelegationId) {
      throw new Error("RVS_USER_DELEGATION_CHAIN_INCOMPLETE");
    }
  }
}

export function delegateRvsUserAuthority(
  parentChain: readonly RvsUserDelegation[],
  input: {
    readonly id: string;
    readonly delegate: RvsUserActorRef;
    readonly envelope: RvsUserAuthorityEnvelope;
    readonly purpose: string;
    readonly workTurnId?: string | undefined;
    readonly createdAt?: string | undefined;
  },
): RvsUserDelegation {
  if (parentChain.length === 0) throw new Error("RVS_USER_DELEGATION_CHAIN_REQUIRED");
  assertRvsUserDelegationUsable(parentChain, input.createdAt);
  const parent = parentChain.at(-1)!;
  if (!parent.envelope.redelegation || parent.envelope.remainingDelegationDepth === 0) {
    throw new Error("RVS_USER_REDELEGATION_FORBIDDEN");
  }
  const childEnvelope = envelope(input.envelope);
  assertAttenuated(childEnvelope, parent.envelope);
  return Object.freeze({
    ...createRvsUserDelegation({
      ...input,
      delegator: parent.delegate,
      actingFor: parent.actingFor,
      authorityRefs: parent.authorityRefs,
      envelope: childEnvelope,
    }),
    parentDelegationId: parent.id,
  });
}

export function revokeRvsUserDelegation(
  delegation: RvsUserDelegation,
  input: {
    readonly revokedBy: ReliversePrincipalId;
    readonly reason: string;
    readonly at?: string | undefined;
  },
): RvsUserDelegation {
  if (delegation.status === "revoked") return delegation;
  if (input.revokedBy !== delegation.actingFor.id) {
    throw new Error("RVS_USER_DELEGATION_OWNER_REQUIRED");
  }
  const revokedAt = time(input.at ?? new Date().toISOString(), "Delegation revokedAt");
  if (Date.parse(revokedAt) < Date.parse(delegation.createdAt)) {
    throw new Error("RVS_USER_DELEGATION_REVOCATION_TIME_INVALID");
  }
  return Object.freeze({
    ...delegation,
    status: "revoked",
    revokedAt,
    revokedByPrincipalId: input.revokedBy,
    revocationReason: input.reason.trim() || "revoked",
  });
}

function materialization(value: RvsUserExecutionMaterialization): RvsUserExecutionMaterialization {
  const domain = value.executionDomain;
  if (domain && !/^sha256:[a-f0-9]{64}$/.test(domain.policyDigest)) {
    throw new Error("RVS_USER_EXECUTION_DOMAIN_INVALID");
  }
  return Object.freeze({
    executionContextId: token(value.executionContextId, "ExecutionContext id"),
    placement: Object.freeze({
      kind: value.placement.kind,
      providerId: token(value.placement.providerId, "Placement provider id"),
      targetId: token(value.placement.targetId, "Placement target id"),
    }),
    ...(value.computerId ? { computerId: token(value.computerId, "Computer id") } : {}),
    ...(value.gatewayId ? { gatewayId: token(value.gatewayId, "Gateway id") } : {}),
    ...(domain ? { executionDomain: Object.freeze({
      id: token(domain.id, "Execution domain id"), policyDigest: domain.policyDigest,
      bindingRef: token(domain.bindingRef, "Execution domain binding reference"),
    }) } : {}),
  });
}

export function bindRvsUserExecutionIdentity(input: {
  readonly id: string;
  readonly workTurnId?: string | undefined;
  readonly runId: string;
  readonly delegationChain: readonly RvsUserDelegation[];
  readonly materialization: RvsUserExecutionMaterialization;
  readonly at?: string | undefined;
}): RvsUserExecutionIdentity {
  if (input.delegationChain.length === 0) throw new Error("RVS_USER_DELEGATION_REQUIRED");
  const at = time(input.at ?? new Date().toISOString(), "Execution identity createdAt");
  assertRvsUserDelegationUsable(input.delegationChain, at);
  const root = input.delegationChain[0]!;
  const leaf = input.delegationChain.at(-1)!;
  if (leaf.workTurnId && leaf.workTurnId !== input.workTurnId) {
    throw new Error("RVS_USER_WORK_TURN_MISMATCH");
  }
  if (!leaf.envelope.executionPlacements.includes(input.materialization.placement.kind)) {
    throw new Error("RVS_USER_EXECUTION_PLACEMENT_FORBIDDEN");
  }
  const current = materialization(input.materialization);
  if (current.executionDomain && !leaf.envelope.resourceScopes.includes(`execution-domain:${current.executionDomain.id}`)) {
    throw new Error("RVS_USER_EXECUTION_DOMAIN_FORBIDDEN");
  }
  return Object.freeze({
    schema: RVS_USER_EXECUTION_IDENTITY_SCHEMA,
    id: token(input.id, "Execution identity id"),
    actor: leaf.delegate,
    actingFor: root.actingFor,
    ...(input.workTurnId ? { workTurnId: token(input.workTurnId, "WorkTurn id") } : {}),
    runId: token(input.runId, "Run id"),
    authorityRefs: root.authorityRefs,
    delegationIds: Object.freeze(input.delegationChain.map((item) => item.id)),
    revision: 1,
    materialization: current,
    materializationHistory: Object.freeze([Object.freeze({ ...current, at })]),
    createdAt: at,
    updatedAt: at,
  });
}

export function moveRvsUserExecutionPlacement(
  current: RvsUserExecutionIdentity,
  input: {
    readonly expectedRevision: number;
    readonly materialization: RvsUserExecutionMaterialization;
    readonly delegationChain: readonly RvsUserDelegation[];
    readonly at?: string | undefined;
  },
): RvsUserExecutionIdentity {
  if (input.expectedRevision !== current.revision) {
    throw new Error("RVS_USER_EXECUTION_IDENTITY_REVISION_CONFLICT");
  }
  assertRvsUserDelegationUsable(input.delegationChain, input.at);
  if (
    input.delegationChain.map((item) => item.id).join("\0") !== current.delegationIds.join("\0")
  ) {
    throw new Error("RVS_USER_EXECUTION_DELEGATION_MISMATCH");
  }
  const leaf = input.delegationChain.at(-1);
  const root = input.delegationChain[0];
  if (leaf?.delegate.id !== current.actor.id || leaf.delegate.kind !== current.actor.kind ||
    root?.actingFor.id !== current.actingFor.id || root.actingFor.kind !== current.actingFor.kind ||
    JSON.stringify(root.authorityRefs) !== JSON.stringify(current.authorityRefs)) {
    throw new Error("RVS_USER_EXECUTION_AUTHORITY_CHANGED");
  }
  if (!leaf?.envelope.executionPlacements.includes(input.materialization.placement.kind)) {
    throw new Error("RVS_USER_EXECUTION_PLACEMENT_FORBIDDEN");
  }
  const at = time(input.at ?? new Date().toISOString(), "Execution placement movedAt");
  if (Date.parse(at) < Date.parse(current.updatedAt)) {
    throw new Error("RVS_USER_EXECUTION_IDENTITY_TIME_INVALID");
  }
  const next = materialization(input.materialization);
  const oldDomain = current.materialization.executionDomain, newDomain = next.executionDomain;
  if (oldDomain?.id !== newDomain?.id || oldDomain?.policyDigest !== newDomain?.policyDigest) {
    // Recovery may recreate native runtime instances, not change trust boundary
    // or policy under old authority. A different domain requires fresh admission.
    throw new Error("RVS_USER_EXECUTION_DOMAIN_CHANGED");
  }
  if (newDomain && !leaf.envelope.resourceScopes.includes(`execution-domain:${newDomain.id}`)) {
    throw new Error("RVS_USER_EXECUTION_DOMAIN_FORBIDDEN");
  }
  return Object.freeze({
    ...current,
    revision: current.revision + 1,
    materialization: next,
    materializationHistory: Object.freeze([
      ...current.materializationHistory,
      Object.freeze({ ...next, at }),
    ]),
    updatedAt: at,
  });
}
