import { createGatehouseId, fingerprintGatehouseValue } from "./canonical";
import {
  GATEHOUSE_ACTION_INTENT_SCHEMA_VERSION,
  GATEHOUSE_ENDORSEMENT_SCHEMA_VERSION,
  GATEHOUSE_NEVER_EXPIRES_AT,
  type GatehouseActionIntent,
  type GatehouseAuthorityExpression,
  type GatehouseEndorsementSubmission,
  type GatehouseJson,
  type GatehousePrincipalRef,
  type GatehouseReversibility,
  type GatehouseRisk,
} from "./contracts";

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:/-]*$/iu;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function assertToken(value: string, label: string): string {
  const normalized = value.trim();
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a stable non-empty token.`);
  }
  return normalized;
}

function assertDigest(value: string, label: string): string {
  if (!DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a sha256 digest.`);
  return value;
}

function assertIso(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO date-time.`);
  return new Date(parsed).toISOString();
}

function assertExpiry(createdAt: string, expiresAt: string, label: string): void {
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new Error(`${label} must be later than creation time.`);
  }
}

function normalizePrincipal(
  principal: GatehousePrincipalRef,
  label: string,
): GatehousePrincipalRef {
  return Object.freeze({
    id: assertToken(principal.id, `${label}.id`),
    kind: principal.kind,
    ...(principal.ownerPrincipalId == null
      ? {}
      : { ownerPrincipalId: assertToken(principal.ownerPrincipalId, `${label}.ownerPrincipalId`) }),
  });
}

export function normalizeGatehouseAuthorityExpression(
  authority: GatehouseAuthorityExpression,
): GatehouseAuthorityExpression {
  if (authority.kind !== "all-of") {
    throw new Error("Gatehouse v0 executable authority supports only all-of.");
  }
  const principalIds = authority.principalIds.map((id) => assertToken(id, "authority principal"));
  if (principalIds.length === 0) {
    throw new Error("Gatehouse authority requires at least one principal.");
  }
  if (new Set(principalIds).size !== principalIds.length) {
    throw new Error("Gatehouse authority cannot contain duplicate principals.");
  }
  return Object.freeze({
    independence: authority.independence,
    kind: "all-of",
    principalIds: Object.freeze(principalIds),
  });
}

export interface CreateGatehouseActionIntentInput {
  readonly id?: string | undefined;
  readonly nonce?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly action: GatehouseActionIntent["action"];
  readonly requester: GatehousePrincipalRef;
  readonly actor: GatehousePrincipalRef;
  readonly accountableSystem: GatehousePrincipalRef;
  readonly target: {
    readonly id: string;
    readonly kind: string;
    readonly parameters: GatehouseJson;
  };
  readonly preconditions: GatehouseJson;
  readonly requestedCapability: {
    readonly capability: string;
    readonly executorClass: string;
    readonly maxAttempts?: number | undefined;
    readonly scope: GatehouseJson;
  };
  readonly policy: {
    readonly authority: GatehouseAuthorityExpression;
    readonly digest: string;
    readonly id: string;
  };
  readonly presentation: GatehouseActionIntent["presentation"];
  readonly reversibility: GatehouseReversibility;
  readonly risk: GatehouseRisk;
  readonly correlation?: GatehouseActionIntent["correlation"];
}

export function createGatehouseActionIntent(
  input: CreateGatehouseActionIntentInput,
): GatehouseActionIntent {
  const createdAt = assertIso(input.createdAt ?? new Date().toISOString(), "intent.createdAt");
  const expiresAt = assertIso(input.expiresAt ?? GATEHOUSE_NEVER_EXPIRES_AT, "intent.expiresAt");
  assertExpiry(createdAt, expiresAt, "intent.expiresAt");
  const maxAttempts = input.requestedCapability.maxAttempts ?? 1;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("requestedCapability.maxAttempts must be a positive safe integer.");
  }
  const parametersDigest = fingerprintGatehouseValue(input.target.parameters);
  const target = {
    digest: fingerprintGatehouseValue({
      id: assertToken(input.target.id, "target.id"),
      kind: assertToken(input.target.kind, "target.kind"),
      parametersDigest,
    }),
    id: assertToken(input.target.id, "target.id"),
    kind: assertToken(input.target.kind, "target.kind"),
    parameters: input.target.parameters,
    parametersDigest,
  } as const;
  const preconditions = {
    digest: fingerprintGatehouseValue(input.preconditions),
    facts: input.preconditions,
  } as const;
  const requestedCapability = {
    capability: assertToken(input.requestedCapability.capability, "requestedCapability.capability"),
    executorClass: assertToken(
      input.requestedCapability.executorClass,
      "requestedCapability.executorClass",
    ),
    maxAttempts,
    scope: input.requestedCapability.scope,
    scopeDigest: fingerprintGatehouseValue(input.requestedCapability.scope),
  } as const;
  const authority = normalizeGatehouseAuthorityExpression(input.policy.authority);
  const withoutDigest = {
    schemaVersion: GATEHOUSE_ACTION_INTENT_SCHEMA_VERSION,
    id: assertToken(input.id ?? createGatehouseId("gatehouse_intent"), "intent.id"),
    nonce: assertToken(input.nonce ?? createGatehouseId("nonce"), "intent.nonce"),
    createdAt,
    expiresAt,
    action: {
      authorityImpact: input.action.authorityImpact,
      effectClass: assertToken(input.action.effectClass, "action.effectClass"),
      kind: assertToken(input.action.kind, "action.kind"),
    },
    requester: normalizePrincipal(input.requester, "requester"),
    actor: normalizePrincipal(input.actor, "actor"),
    accountableSystem: normalizePrincipal(input.accountableSystem, "accountableSystem"),
    target,
    preconditions,
    requestedCapability,
    policy: {
      authority,
      digest: assertDigest(input.policy.digest, "policy.digest"),
      id: assertToken(input.policy.id, "policy.id"),
    },
    presentation: {
      consequences: Object.freeze(
        input.presentation.consequences.map((value) => value.trim()).filter(Boolean),
      ),
      summary: input.presentation.summary.trim(),
      title: input.presentation.title.trim(),
    },
    reversibility: input.reversibility,
    risk: input.risk,
    ...(input.correlation == null ? {} : { correlation: input.correlation }),
  } as const;
  if (!withoutDigest.presentation.title || !withoutDigest.presentation.summary) {
    throw new Error("Gatehouse intent presentation requires a title and summary.");
  }
  return Object.freeze({
    ...withoutDigest,
    digest: fingerprintGatehouseValue(withoutDigest),
  });
}

export function assertGatehouseActionIntent(value: GatehouseActionIntent): void {
  if (value.schemaVersion !== GATEHOUSE_ACTION_INTENT_SCHEMA_VERSION) {
    throw new Error("Unsupported Gatehouse ActionIntent schema version.");
  }
  const { digest, ...withoutDigest } = value;
  if (fingerprintGatehouseValue(withoutDigest) !== digest) {
    throw new Error("Gatehouse ActionIntent digest does not match its semantic fields.");
  }
  assertExpiry(
    assertIso(value.createdAt, "intent.createdAt"),
    assertIso(value.expiresAt, "intent.expiresAt"),
    "intent.expiresAt",
  );
  normalizeGatehouseAuthorityExpression(value.policy.authority);
}

export interface CreateGatehouseEndorsementSubmissionInput {
  readonly id?: string | undefined;
  readonly nonce?: string | undefined;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly decision: GatehouseEndorsementSubmission["decision"];
  readonly assurance: GatehouseEndorsementSubmission["assurance"];
  readonly issuedAt?: string | undefined;
  readonly expiresAt: string;
  readonly rationale?: string | undefined;
  readonly proof: {
    readonly profile: string;
    readonly signature: string | ((signedDigest: string) => string);
  };
}

export function createGatehouseEndorsementSubmission(
  input: CreateGatehouseEndorsementSubmissionInput,
): GatehouseEndorsementSubmission {
  const issuedAt = assertIso(input.issuedAt ?? new Date().toISOString(), "endorsement.issuedAt");
  const expiresAt = assertIso(input.expiresAt, "endorsement.expiresAt");
  assertExpiry(issuedAt, expiresAt, "endorsement.expiresAt");
  const semantic = {
    schemaVersion: GATEHOUSE_ENDORSEMENT_SCHEMA_VERSION,
    id: assertToken(input.id ?? createGatehouseId("gatehouse_endorsement"), "endorsement.id"),
    gateId: assertToken(input.gateId, "endorsement.gateId"),
    intentDigest: assertDigest(input.intentDigest, "endorsement.intentDigest"),
    principalId: assertToken(input.principalId, "endorsement.principalId"),
    credentialId: assertToken(input.credentialId, "endorsement.credentialId"),
    decision: input.decision,
    assurance: {
      ...input.assurance,
      evidenceDigest: assertDigest(
        input.assurance.evidenceDigest,
        "endorsement.assurance.evidenceDigest",
      ),
      profile: assertToken(input.assurance.profile, "endorsement.assurance.profile"),
    },
    issuedAt,
    expiresAt,
    nonce: assertToken(input.nonce ?? createGatehouseId("nonce"), "endorsement.nonce"),
    ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
    proofProfile: assertToken(input.proof.profile, "endorsement.proof.profile"),
  } as const;
  const signedDigest = fingerprintGatehouseValue(semantic);
  const signature =
    typeof input.proof.signature === "function"
      ? input.proof.signature(signedDigest)
      : input.proof.signature.trim();
  if (!signature) {
    throw new Error("Gatehouse endorsement proof signature must be non-empty.");
  }
  const { proofProfile, ...fields } = semantic;
  const withoutDigest = {
    ...fields,
    proof: {
      profile: proofProfile,
      signature,
      signedDigest,
    },
  } as const;
  return Object.freeze({
    ...withoutDigest,
    digest: fingerprintGatehouseValue(withoutDigest),
  });
}

export function assertGatehouseEndorsementSubmission(value: GatehouseEndorsementSubmission): void {
  if (value.schemaVersion !== GATEHOUSE_ENDORSEMENT_SCHEMA_VERSION) {
    throw new Error("Unsupported Gatehouse endorsement schema version.");
  }
  const { digest, ...withoutDigest } = value;
  if (fingerprintGatehouseValue(withoutDigest) !== digest) {
    throw new Error("Gatehouse endorsement digest does not match its semantic fields.");
  }
  assertExpiry(
    assertIso(value.issuedAt, "endorsement.issuedAt"),
    assertIso(value.expiresAt, "endorsement.expiresAt"),
    "endorsement.expiresAt",
  );
}
