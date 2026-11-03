/** Canonical Principal/Actor binding and My Rse relationship contracts. */
import type {
  ReliversePrincipalId,
  ReliversePrincipalKind,
  ReliversePrincipalV0,
} from "@reliverse/home";

export const RVS_USER_ACTOR_BINDING_SCHEMA = "rvs.user.actor-binding.v0" as const;
export const RVS_USER_MY_RSE_ROLE_SCHEMA = "rvs.user.my-rse-role.v0" as const;

export type RvsUserActorKind = "human" | "agent" | "service" | "device";
export type RvsUserBindingAssurance = "declared" | "verified" | "attested";

export interface RvsUserPrincipalRef {
  readonly id: ReliversePrincipalId;
  readonly kind: ReliversePrincipalKind;
}

export interface RvsUserActorRef {
  readonly id: string;
  readonly kind: RvsUserActorKind;
}

export interface RvsUserActorBinding {
  readonly schema: typeof RVS_USER_ACTOR_BINDING_SCHEMA;
  readonly id: string;
  readonly principal: RvsUserPrincipalRef;
  readonly actor: RvsUserActorRef;
  readonly provider: {
    readonly id: string;
    readonly subject: string;
  };
  readonly proof: {
    readonly kind: string;
    readonly reference: string;
    readonly digest?: `sha256:${string}`;
  };
  readonly assurance: RvsUserBindingAssurance;
  readonly boundByPrincipalId: ReliversePrincipalId;
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt?: string;
  readonly revokedByPrincipalId?: ReliversePrincipalId;
  readonly revocationReason?: string;
}

export interface RvsUserAgentIdentity {
  readonly id: string;
  /** Independently identified Agent: explicit canonical Home association, never
   * inferred from an Agent id, Actor label, provider or selected model. */
  readonly principalId?: ReliversePrincipalId | undefined;
  readonly ownerPrincipalId: ReliversePrincipalId;
  readonly provenance: {
    readonly origin: "first-party" | "external" | "local" | "imported";
    readonly implementationId?: string | undefined;
  };
  readonly status: "active" | "revoked";
}

export interface RvsUserRoleTransition {
  readonly kind: "assigned" | "transferred" | "revoked";
  readonly at: string;
  readonly byPrincipalId: ReliversePrincipalId;
  readonly fromAgentId?: string;
  readonly toAgentId?: string;
  readonly reason?: string;
}

export interface RvsUserMyRseRole {
  readonly schema: typeof RVS_USER_MY_RSE_ROLE_SCHEMA;
  readonly id: string;
  readonly principalId: ReliversePrincipalId;
  readonly agentId: string;
  readonly revision: number;
  readonly status: "assigned" | "revoked";
  readonly assignedAt: string;
  readonly updatedAt: string;
  readonly revokedAt?: string;
  readonly history: readonly RvsUserRoleTransition[];
}

function token(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/u.test(normalized)) {
    throw new Error(`RVS_USER_TOKEN_INVALID: ${label} must be a non-empty token.`);
  }
  return normalized;
}

function instant(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`RVS_USER_TIME_INVALID: ${label} must be an ISO timestamp.`);
  }
  return value;
}

function principalRef(principal: ReliversePrincipalV0): RvsUserPrincipalRef {
  return Object.freeze({ id: principal.id, kind: principal.principalKind });
}

export function bindRvsUserActor(input: {
  readonly id: string;
  readonly principal: ReliversePrincipalV0;
  readonly actor: RvsUserActorRef;
  readonly provider: RvsUserActorBinding["provider"];
  readonly proof: RvsUserActorBinding["proof"];
  readonly assurance: RvsUserBindingAssurance;
  readonly boundBy: ReliversePrincipalId;
  readonly createdAt?: string;
}): RvsUserActorBinding {
  if (input.principal.status === "revoked") {
    throw new Error("RVS_USER_PRINCIPAL_REVOKED: a revoked Principal cannot receive a binding.");
  }
  if (input.boundBy !== input.principal.id) throw new Error("RVS_USER_BINDING_OWNER_REQUIRED");
  return createActorBinding(input);
}

function createActorBinding(input: Parameters<typeof bindRvsUserActor>[0]): RvsUserActorBinding {
  const createdAt = instant(input.createdAt ?? new Date().toISOString(), "Binding createdAt");
  return Object.freeze({
    schema: RVS_USER_ACTOR_BINDING_SCHEMA,
    id: token(input.id, "Binding id"),
    principal: principalRef(input.principal),
    actor: Object.freeze({
      id: token(input.actor.id, "Actor id"),
      kind: input.actor.kind,
    }),
    provider: Object.freeze({
      id: token(input.provider.id, "Provider id"),
      subject: token(input.provider.subject, "Provider subject"),
    }),
    proof: Object.freeze({
      kind: token(input.proof.kind, "Proof kind"),
      reference: token(input.proof.reference, "Proof reference"),
      ...(input.proof.digest ? { digest: input.proof.digest } : {}),
    }),
    assurance: input.assurance,
    boundByPrincipalId: input.boundBy,
    status: "active",
    createdAt,
  });
}

/** Record construction only. Protected enrollment must independently load and
 * authenticate these canonical records and the native proof before publication.
 * This route preserves self-binding law and creates no session, grant or signer. */
export function bindRvsUserOwnedAgentActor(
  input: Parameters<typeof bindRvsUserActor>[0] & {
    readonly owner: ReliversePrincipalV0;
    readonly agent: RvsUserAgentIdentity;
  },
): RvsUserActorBinding {
  const deny = () => new Error("RVS_USER_OWNED_AGENT_BINDING_REJECTED");
  if (
    input.owner.status !== "active" ||
    input.owner.principalKind !== "human" ||
    input.principal.status !== "active" ||
    input.principal.principalKind !== "agent" ||
    ![input.owner.id, input.principal.id].every((id) => /^prn_[a-f0-9]{32}$/.test(id)) ||
    input.owner.id === input.principal.id ||
    input.boundBy !== input.owner.id ||
    input.agent.status !== "active" ||
    input.agent.ownerPrincipalId !== input.owner.id ||
    input.agent.principalId !== input.principal.id ||
    input.actor.kind !== "agent" ||
    !["declared", "verified", "attested"].includes(input.assurance) ||
    (input.assurance !== "declared" && !/^sha256:[a-f0-9]{64}$/.test(input.proof.digest ?? ""))
  )
    throw deny();
  token(input.agent.id, "Agent id");
  return createActorBinding(input);
}

export function revokeRvsUserActorBinding(
  binding: RvsUserActorBinding,
  input: {
    readonly revokedBy: ReliversePrincipalId;
    readonly at?: string;
    readonly reason: string;
  },
): RvsUserActorBinding {
  if (binding.status === "revoked") return binding;
  if (input.revokedBy !== binding.principal.id && input.revokedBy !== binding.boundByPrincipalId) {
    throw new Error("RVS_USER_BINDING_OWNER_REQUIRED");
  }
  return Object.freeze({
    ...binding,
    status: "revoked",
    revokedAt: instant(input.at ?? new Date().toISOString(), "Binding revokedAt"),
    revokedByPrincipalId: input.revokedBy,
    revocationReason: input.reason.trim() || "revoked",
  });
}

function assertEligibleAgent(principalId: ReliversePrincipalId, agent: RvsUserAgentIdentity): void {
  if (agent.status !== "active") throw new Error("RVS_USER_AGENT_REVOKED");
  if (agent.ownerPrincipalId !== principalId) {
    throw new Error("RVS_USER_MY_RSE_PRINCIPAL_MISMATCH");
  }
}

function transition(value: RvsUserRoleTransition): RvsUserRoleTransition {
  return Object.freeze(value);
}

export function assignMyRseRole(input: {
  readonly id: string;
  readonly principal: ReliversePrincipalV0;
  readonly agent: RvsUserAgentIdentity;
  readonly assignedBy: ReliversePrincipalId;
  readonly at?: string;
}): RvsUserMyRseRole {
  if (input.principal.status === "revoked") throw new Error("RVS_USER_PRINCIPAL_REVOKED");
  assertEligibleAgent(input.principal.id, input.agent);
  if (input.assignedBy !== input.principal.id) throw new Error("RVS_USER_ROLE_OWNER_REQUIRED");
  const at = instant(input.at ?? new Date().toISOString(), "Role assignedAt");
  return Object.freeze({
    schema: RVS_USER_MY_RSE_ROLE_SCHEMA,
    id: token(input.id, "Role id"),
    principalId: input.principal.id,
    agentId: token(input.agent.id, "Agent id"),
    revision: 1,
    status: "assigned",
    assignedAt: at,
    updatedAt: at,
    history: Object.freeze([
      transition({
        kind: "assigned",
        at,
        byPrincipalId: input.assignedBy,
        toAgentId: input.agent.id,
      }),
    ]),
  });
}

export function transferMyRseRole(
  current: RvsUserMyRseRole,
  input: {
    readonly expectedRevision: number;
    readonly agent: RvsUserAgentIdentity;
    readonly transferredBy: ReliversePrincipalId;
    readonly at?: string;
    readonly reason?: string;
  },
): RvsUserMyRseRole {
  if (current.status !== "assigned") throw new Error("RVS_USER_MY_RSE_REVOKED");
  if (current.revision !== input.expectedRevision)
    throw new Error("RVS_USER_ROLE_REVISION_CONFLICT");
  if (input.transferredBy !== current.principalId) throw new Error("RVS_USER_ROLE_OWNER_REQUIRED");
  assertEligibleAgent(current.principalId, input.agent);
  if (current.agentId === input.agent.id) throw new Error("RVS_USER_MY_RSE_ALREADY_ASSIGNED");
  const at = instant(input.at ?? new Date().toISOString(), "Role transferredAt");
  return Object.freeze({
    ...current,
    agentId: token(input.agent.id, "Agent id"),
    revision: current.revision + 1,
    updatedAt: at,
    history: Object.freeze([
      ...current.history,
      transition({
        kind: "transferred",
        at,
        byPrincipalId: input.transferredBy,
        fromAgentId: current.agentId,
        toAgentId: input.agent.id,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      }),
    ]),
  });
}

export function revokeMyRseRole(
  current: RvsUserMyRseRole,
  input: {
    readonly expectedRevision: number;
    readonly revokedBy: ReliversePrincipalId;
    readonly at?: string;
    readonly reason: string;
  },
): RvsUserMyRseRole {
  if (current.revision !== input.expectedRevision)
    throw new Error("RVS_USER_ROLE_REVISION_CONFLICT");
  if (current.status === "revoked") return current;
  if (input.revokedBy !== current.principalId) throw new Error("RVS_USER_ROLE_OWNER_REQUIRED");
  const at = instant(input.at ?? new Date().toISOString(), "Role revokedAt");
  return Object.freeze({
    ...current,
    revision: current.revision + 1,
    status: "revoked",
    updatedAt: at,
    revokedAt: at,
    history: Object.freeze([
      ...current.history,
      transition({
        kind: "revoked",
        at,
        byPrincipalId: input.revokedBy,
        fromAgentId: current.agentId,
        reason: input.reason.trim() || "revoked",
      }),
    ]),
  });
}

export function inspectRvsUserIdentity(input: {
  readonly principal: ReliversePrincipalV0;
  readonly bindings: readonly RvsUserActorBinding[];
  readonly myRse?: RvsUserMyRseRole;
}) {
  return Object.freeze({
    principal: input.principal,
    bindings: Object.freeze([...input.bindings]),
    ...(input.myRse ? { myRse: input.myRse } : {}),
    authority: "not-modeled-here" as const,
  });
}
