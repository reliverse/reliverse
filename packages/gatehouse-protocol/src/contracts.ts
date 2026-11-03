export const GATEHOUSE_ACTION_INTENT_SCHEMA_VERSION = "gatehouse.action-intent.v0" as const;
export const GATEHOUSE_GATE_SCHEMA_VERSION = "gatehouse.gate.v0" as const;
export const GATEHOUSE_ENDORSEMENT_SCHEMA_VERSION = "gatehouse.endorsement.v0" as const;
export const GATEHOUSE_APPROVAL_BUNDLE_SCHEMA_VERSION = "gatehouse.approval-bundle.v0" as const;
export const GATEHOUSE_EXECUTION_LEASE_SCHEMA_VERSION = "gatehouse.execution-lease.v0" as const;
export const GATEHOUSE_DECISION_RECEIPT_SCHEMA_VERSION = "gatehouse.decision-receipt.v0" as const;
export const GATEHOUSE_CONSUMPTION_RECEIPT_SCHEMA_VERSION =
  "gatehouse.lease-consumption.v0" as const;
export const GATEHOUSE_EXECUTION_RECEIPT_SCHEMA_VERSION = "gatehouse.execution-receipt.v0" as const;
export const GATEHOUSE_REVOCATION_SCHEMA_VERSION = "gatehouse.revocation.v0" as const;

/** Canonical ISO representation for an intent whose surface did not impose a deadline. */
export const GATEHOUSE_NEVER_EXPIRES_AT = "9999-12-31T23:59:59.999Z" as const;

export type GatehouseJson =
  | null
  | boolean
  | number
  | string
  | readonly GatehouseJson[]
  | { readonly [key: string]: GatehouseJson };

export type GatehousePrincipalKind = "human" | "agent" | "service" | "organization" | "device";

export interface GatehousePrincipalRef {
  readonly id: string;
  readonly kind: GatehousePrincipalKind;
  readonly ownerPrincipalId?: string | undefined;
}

export type GatehouseAuthorityIndependence = "distinct-perspectives" | "distinct-trust-roots";

/**
 * The executable foundation intentionally starts with exact all-of authority.
 * Richer anyOf/atLeast policy syntax remains a policy compiler concern until it
 * has equivalent runtime tests.
 */
export interface GatehouseAllOfAuthorityExpression {
  readonly independence: GatehouseAuthorityIndependence;
  readonly kind: "all-of";
  readonly principalIds: readonly string[];
}

export type GatehouseAuthorityExpression = GatehouseAllOfAuthorityExpression;

export type GatehouseRisk = "low" | "moderate" | "high" | "critical";
export type GatehouseReversibility = "reversible" | "compensatable" | "irreversible" | "unknown";
export type GatehouseAuthorityImpact = "none" | "expand" | "reduce" | "replace";

export interface GatehouseActionIntent {
  readonly schemaVersion: typeof GATEHOUSE_ACTION_INTENT_SCHEMA_VERSION;
  readonly id: string;
  readonly digest: string;
  readonly nonce: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly action: {
    readonly authorityImpact: GatehouseAuthorityImpact;
    readonly effectClass: string;
    readonly kind: string;
  };
  readonly requester: GatehousePrincipalRef;
  readonly actor: GatehousePrincipalRef;
  readonly accountableSystem: GatehousePrincipalRef;
  readonly target: {
    readonly digest: string;
    readonly id: string;
    readonly kind: string;
    readonly parameters: GatehouseJson;
    readonly parametersDigest: string;
  };
  readonly preconditions: {
    readonly digest: string;
    readonly facts: GatehouseJson;
  };
  readonly requestedCapability: {
    readonly capability: string;
    readonly executorClass: string;
    readonly maxAttempts: number;
    readonly scope: GatehouseJson;
    readonly scopeDigest: string;
  };
  readonly policy: {
    readonly authority: GatehouseAuthorityExpression;
    readonly digest: string;
    readonly id: string;
  };
  readonly presentation: {
    readonly consequences: readonly string[];
    readonly summary: string;
    readonly title: string;
  };
  readonly reversibility: GatehouseReversibility;
  readonly risk: GatehouseRisk;
  readonly correlation?:
    | {
        readonly operationId?: string | undefined;
        readonly runId?: string | undefined;
        readonly traceId?: string | undefined;
      }
    | undefined;
}

export type GatehouseGateStatus =
  | "created"
  | "pending"
  | "partially-endorsed"
  | "quorum-satisfied"
  | "request-changes"
  | "denied"
  | "lease-issued"
  | "executing"
  | "completed"
  | "expired"
  | "revoked"
  | "lease-expired"
  | "execution-failed"
  | "outcome-unknown"
  | "cancelled";

export interface GatehouseGate {
  readonly schemaVersion: typeof GATEHOUSE_GATE_SCHEMA_VERSION;
  readonly id: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly policyId: string;
  readonly policyDigest: string;
  readonly authority: GatehouseAuthorityExpression;
  readonly status: GatehouseGateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly endorsementIds: readonly string[];
  readonly approvalBundleId?: string | undefined;
  readonly leaseId?: string | undefined;
  readonly revocationId?: string | undefined;
}

export type GatehouseDecision = "approve" | "deny" | "request-changes";

export interface GatehouseAssuranceEvidence {
  readonly deviceBound: boolean;
  readonly evidenceDigest: string;
  readonly profile: string;
  readonly userPresence: boolean;
  readonly userVerification: boolean;
}

export interface GatehouseEndorsementSubmission {
  readonly schemaVersion: typeof GATEHOUSE_ENDORSEMENT_SCHEMA_VERSION;
  readonly id: string;
  readonly digest: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly principalId: string;
  readonly credentialId: string;
  readonly decision: GatehouseDecision;
  readonly assurance: GatehouseAssuranceEvidence;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly rationale?: string | undefined;
  readonly proof: {
    readonly profile: string;
    readonly signature: string;
    readonly signedDigest: string;
  };
}

export interface GatehouseVerifiedEndorsement extends GatehouseEndorsementSubmission {
  readonly verification: {
    readonly evidenceDigest: string;
    readonly verifierId: string;
    readonly verifiedAt: string;
  };
}

export interface GatehouseApprovalBundle {
  readonly schemaVersion: typeof GATEHOUSE_APPROVAL_BUNDLE_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly policyDigest: string;
  readonly authority: GatehouseAuthorityExpression;
  readonly acceptedEndorsementIds: readonly string[];
  readonly rejectedEndorsementIds: readonly string[];
  readonly status: "pending" | "quorum-satisfied" | "denied" | "request-changes";
  readonly evaluatedAt: string;
  readonly expiresAt: string;
}

export type GatehouseExecutionLeaseStatus = "active" | "consumed" | "expired" | "revoked";

export interface GatehouseExecutionLease {
  readonly planAuthorization?:
    | {
        readonly planGateId: string;
        readonly planDigest: string;
        readonly claimId: string;
        readonly claimDigest: string;
      }
    | undefined;
  readonly schemaVersion: typeof GATEHOUSE_EXECUTION_LEASE_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly approvalBundleId: string;
  readonly capability: string;
  readonly executorClass: string;
  readonly targetDigest: string;
  readonly scopeDigest: string;
  readonly preconditionDigest: string;
  readonly maxAttempts: number;
  readonly attempts: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly status: GatehouseExecutionLeaseStatus;
  readonly consumedAt?: string | undefined;
  readonly consumptionId?: string | undefined;
  readonly revocationId?: string | undefined;
}

export interface GatehouseDecisionReceipt {
  readonly schemaVersion: typeof GATEHOUSE_DECISION_RECEIPT_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly endorsementId: string;
  readonly principalId: string;
  readonly decision: GatehouseDecision;
  readonly accepted: boolean;
  readonly code?: string | undefined;
  readonly recordedAt: string;
  readonly stateBefore: GatehouseGateStatus;
  readonly stateAfter: GatehouseGateStatus;
}

export interface GatehouseLeaseConsumptionReceipt {
  readonly schemaVersion: typeof GATEHOUSE_CONSUMPTION_RECEIPT_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly leaseId: string;
  readonly intentDigest: string;
  readonly attemptId: string;
  readonly capability: string;
  readonly executorClass: string;
  readonly targetDigest: string;
  readonly scopeDigest: string;
  readonly preconditionDigest: string;
  readonly consumedAt: string;
}

export type GatehouseExecutionOutcome =
  | "completed"
  | "execution-failed"
  | "outcome-unknown"
  | "cancelled";

export interface GatehouseExecutionReceipt {
  readonly schemaVersion: typeof GATEHOUSE_EXECUTION_RECEIPT_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly leaseId: string;
  readonly consumptionId: string;
  readonly attemptId: string;
  readonly intentDigest: string;
  readonly outcome: GatehouseExecutionOutcome;
  readonly resultDigest?: string | undefined;
  readonly recordedAt: string;
  readonly uncertainty?: string | undefined;
}

export interface GatehouseRevocation {
  readonly schemaVersion: typeof GATEHOUSE_REVOCATION_SCHEMA_VERSION;
  readonly id: string;
  readonly gateId: string;
  readonly leaseId?: string | undefined;
  readonly actor: GatehousePrincipalRef;
  readonly reason: string;
  readonly createdAt: string;
}

export interface GatehouseGateInspection {
  readonly intent: GatehouseActionIntent;
  readonly gate: GatehouseGate;
  readonly effectiveStatus: GatehouseGateStatus;
  readonly endorsements: readonly GatehouseVerifiedEndorsement[];
  readonly decisions: readonly GatehouseDecisionReceipt[];
  readonly approvalBundle?: GatehouseApprovalBundle | undefined;
  readonly lease?: GatehouseExecutionLease | undefined;
  readonly consumption?: GatehouseLeaseConsumptionReceipt | undefined;
  readonly execution?: GatehouseExecutionReceipt | undefined;
  readonly revocations: readonly GatehouseRevocation[];
}
