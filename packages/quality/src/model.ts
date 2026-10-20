import type { JsonValue } from "./json";

export const QUALITY_SUITE_SCHEMA_VERSION = "rq.quality-suite.v0" as const;
export const QUALITY_CHECK_RESULT_SCHEMA_VERSION = "rq.check-result.v0" as const;
export const QUALITY_CHANGE_PLAN_SCHEMA_VERSION = "rq.change-plan.v0" as const;
export const QUALITY_PLAN_RESULT_SCHEMA_VERSION = "rq.plan-result.v0" as const;
export const QUALITY_APPLY_RECEIPT_SCHEMA_VERSION = "rq.apply-receipt.v0" as const;
export const QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION = "rq.verification-receipt.v0" as const;

export const QUALITY_OPERATION_KINDS = ["check", "explain", "plan", "apply", "verify"] as const;
export type QualityOperationKind = (typeof QUALITY_OPERATION_KINDS)[number];

export const QUALITY_EFFECT_KINDS = [
  "filesystem.read",
  "filesystem.write",
  "filesystem.rename",
  "filesystem.delete",
  "process.spawn",
  "network.read",
  "network.write",
  "git.read",
  "git.write",
  "artifact.write",
] as const;
export type QualityEffectKind = (typeof QUALITY_EFFECT_KINDS)[number];

export const QUALITY_READ_ONLY_CHECK_EFFECT_KINDS = [
  "filesystem.read",
  "process.spawn",
  "network.read",
  "git.read",
] as const satisfies readonly QualityEffectKind[];

export const QUALITY_SEVERITIES = ["error", "warning", "info"] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export const QUALITY_DETERMINISM_KINDS = [
  "deterministic",
  "environment-bound",
  "non-deterministic",
] as const;
export type QualityDeterminismKind = (typeof QUALITY_DETERMINISM_KINDS)[number];

export type QualityEffectDeclaration = {
  readonly kind: QualityEffectKind;
  readonly reason: string;
  readonly operations?: readonly QualityOperationKind[] | undefined;
  readonly scope?: string | undefined;
};

export type QualityArtifactDeclaration = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly optional?: boolean | undefined;
};

export type QualityCapabilityDeclaration = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly operations: readonly QualityOperationKind[];
  readonly defaultProvider?: string | undefined;
  readonly providers?: readonly string[] | undefined;
  readonly effects?: readonly QualityEffectDeclaration[] | undefined;
  readonly artifacts?: readonly QualityArtifactDeclaration[] | undefined;
};

export type QualityRemediationReference = {
  readonly kind: "external" | "manual" | "plan";
  readonly summary: string;
  readonly reference?: string | undefined;
};

export type QualityRuleDeclaration = {
  readonly id: string;
  readonly diagnosticId: string;
  readonly capabilityId: string;
  readonly title: string;
  readonly description: string;
  readonly explanation: string;
  readonly defaultSeverity: QualitySeverity;
  readonly remediation?: QualityRemediationReference | undefined;
};

export type QualityProviderDeclaration = {
  readonly id: string;
  readonly capabilityId: string;
  readonly title: string;
  readonly version: string;
  readonly operations: readonly QualityOperationKind[];
  readonly determinism: QualityDeterminismKind;
  readonly effects?: readonly QualityEffectDeclaration[] | undefined;
  readonly executable?: string | undefined;
};

/**
 * Serializable domain manifest. Package ownership and extension lifecycle are
 * intentionally supplied by the host extension system, such as Rempts.
 */
export type QualitySuiteManifest = {
  readonly schemaVersion: typeof QUALITY_SUITE_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly capabilities: readonly QualityCapabilityDeclaration[];
  readonly rules: readonly QualityRuleDeclaration[];
  readonly providers: readonly QualityProviderDeclaration[];
};

export type QualitySourcePosition = {
  readonly line: number;
  readonly column?: number | undefined;
};

export type QualitySourceRange = {
  readonly start: QualitySourcePosition;
  readonly end?: QualitySourcePosition | undefined;
};

export type QualityEvidence = {
  readonly kind: string;
  readonly label: string;
  readonly value?: JsonValue | undefined;
  readonly path?: string | undefined;
  readonly range?: QualitySourceRange | undefined;
};

export type QualityDiagnosticInput = {
  readonly ruleId: string;
  readonly message: string;
  readonly severity?: QualitySeverity | undefined;
  readonly path?: string | undefined;
  readonly range?: QualitySourceRange | undefined;
  readonly evidence?: readonly QualityEvidence[] | undefined;
  readonly remediation?: QualityRemediationReference | undefined;
  readonly data?: JsonValue | undefined;
};

export type QualityDiagnostic = {
  readonly id: string;
  readonly ruleId: string;
  readonly capabilityId: string;
  readonly severity: QualitySeverity;
  readonly message: string;
  readonly fingerprint: string;
  readonly path?: string | undefined;
  readonly range?: QualitySourceRange | undefined;
  readonly evidence?: readonly QualityEvidence[] | undefined;
  readonly remediation?: QualityRemediationReference | undefined;
  readonly data?: JsonValue | undefined;
};

export type QualityTargetReference = {
  readonly kind:
    | "content"
    | "custom"
    | "package"
    | "product"
    | "project"
    | "release"
    | "repository";
  readonly id: string;
  readonly root?: string | undefined;
  readonly snapshot?: string | undefined;
};

export type QualityCheckContext = {
  readonly suite: QualitySuiteManifest;
  readonly capability: QualityCapabilityDeclaration;
  readonly provider?: QualityProviderDeclaration | undefined;
  readonly target: QualityTargetReference;
  readonly input: JsonValue;
  readonly config: JsonValue;
  readonly signal?: AbortSignal | undefined;
};

export type QualityCheckHandlerResult = {
  readonly diagnostics: readonly QualityDiagnosticInput[];
  readonly execution?: JsonValue | undefined;
  readonly metadata?: JsonValue | undefined;
};

export type QualityCheckHandler = (
  context: QualityCheckContext,
) =>
  | Promise<QualityCheckHandlerResult | readonly QualityDiagnosticInput[]>
  | QualityCheckHandlerResult
  | readonly QualityDiagnosticInput[];

export type QualitySuiteDefinition = Omit<QualitySuiteManifest, "schemaVersion"> & {
  readonly checks?: Readonly<Record<string, QualityCheckHandler>> | undefined;
  readonly plans?: Readonly<Record<string, QualityPlanHandler>> | undefined;
};

export type QualitySuite = {
  readonly manifest: QualitySuiteManifest;
  readonly manifestFingerprint: string;
  readonly checks: Readonly<Record<string, QualityCheckHandler>>;
  readonly plans: Readonly<Record<string, QualityPlanHandler>>;
};

export type QualityCheckRequest = {
  readonly capabilityId: string;
  readonly target: QualityTargetReference;
  readonly providerId?: string | undefined;
  readonly input?: JsonValue | undefined;
  readonly config?: JsonValue | undefined;
  readonly grantedEffects?: readonly QualityEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type QualityCheckSummary = {
  readonly total: number;
  readonly error: number;
  readonly warning: number;
  readonly info: number;
};

export type QualityCheckResult = {
  readonly schemaVersion: typeof QUALITY_CHECK_RESULT_SCHEMA_VERSION;
  readonly suite: {
    readonly id: string;
    readonly manifestFingerprint: string;
  };
  readonly capabilityId: string;
  readonly target: QualityTargetReference;
  readonly inputFingerprint: string;
  readonly configFingerprint: string;
  readonly diagnostics: readonly QualityDiagnostic[];
  readonly summary: QualityCheckSummary;
  readonly resultFingerprint: string;
  readonly execution?: JsonValue | undefined;
  readonly provider?:
    | {
        readonly id: string;
        readonly version: string;
      }
    | undefined;
  readonly metadata?: JsonValue | undefined;
};

export type QualityPlanFingerprint = string;

export type QualityWriteJsonOperation = {
  readonly id: string;
  readonly kind: "write-json";
  readonly path: string;
  readonly pointer: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
  readonly fileFingerprint: string;
};

export type QualityReplaceTextOperation = {
  readonly id: string;
  readonly kind: "replace-text";
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly expectedOccurrences: number;
  readonly fileFingerprint: string;
};

export type QualityCreateFileOperation = {
  readonly id: string;
  readonly kind: "create-file";
  readonly path: string;
  readonly content: string;
  readonly targetMustBeAbsent: true;
};

export type QualityMovePathOperation = {
  readonly id: string;
  readonly kind: "move-path" | "rename-path";
  readonly from: string;
  readonly to: string;
  readonly sourceFingerprint: string;
  readonly targetMustBeAbsent: true;
};

export type QualityDeletePathOperation = {
  readonly id: string;
  readonly kind: "delete-path";
  readonly path: string;
  readonly beforeFingerprint: string;
};

export type QualityChangeOperation =
  | QualityCreateFileOperation
  | QualityDeletePathOperation
  | QualityMovePathOperation
  | QualityReplaceTextOperation
  | QualityWriteJsonOperation;

export type QualityPrecondition =
  | {
      readonly id: string;
      readonly kind: "file-fingerprint";
      readonly path: string;
      readonly expected: string;
    }
  | {
      readonly id: string;
      readonly kind: "json-value";
      readonly path: string;
      readonly pointer: string;
      readonly expected: JsonValue;
    }
  | {
      readonly id: string;
      readonly kind: "path-absent";
      readonly path: string;
    };

export type QualityRisk = {
  readonly id: string;
  readonly level: "low" | "medium" | "high" | "blocking";
  readonly title: string;
  readonly description: string;
  readonly operationIds?: readonly string[] | undefined;
};

export type QualityVerificationStep =
  | {
      readonly id: string;
      readonly kind: "quality-check";
      readonly capabilityId: string;
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly kind: "command";
      readonly command: readonly string[];
      readonly description: string;
    }
  | {
      readonly id: string;
      readonly kind: "manual";
      readonly description: string;
    };

export type QualityPlanManualItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly diagnosticFingerprints?: readonly string[] | undefined;
};

export type QualityPlanProducerReference = {
  readonly pluginId: string;
  readonly packageName?: string | undefined;
};

export type QualityTargetContentFingerprint = {
  readonly kind: "content";
  readonly fingerprint: string;
  readonly description: string;
};

export type QualityChangePlan = {
  readonly schemaVersion: typeof QUALITY_CHANGE_PLAN_SCHEMA_VERSION;
  readonly planId: string;
  readonly planFingerprint: QualityPlanFingerprint;
  readonly producer: QualityPlanProducerReference;
  readonly suite: {
    readonly id: string;
    readonly manifestFingerprint: string;
  };
  readonly capabilityId: string;
  readonly provider?:
    | {
        readonly id: string;
        readonly version: string;
      }
    | undefined;
  readonly target: QualityTargetReference;
  readonly targetContent: QualityTargetContentFingerprint;
  readonly inputFingerprint: string;
  readonly configFingerprint: string;
  readonly diagnostics: readonly string[];
  readonly operations: readonly QualityChangeOperation[];
  readonly preconditions: readonly QualityPrecondition[];
  readonly risks: readonly QualityRisk[];
  readonly verification: readonly QualityVerificationStep[];
  readonly manualItems: readonly QualityPlanManualItem[];
  readonly applicable: boolean;
};

export type QualityPlanContext = {
  readonly suite: QualitySuiteManifest;
  readonly capability: QualityCapabilityDeclaration;
  readonly provider?: QualityProviderDeclaration | undefined;
  readonly target: QualityTargetReference;
  readonly input: JsonValue;
  readonly config: JsonValue;
  readonly checkResult: QualityCheckResult;
  readonly signal?: AbortSignal | undefined;
};

export type QualityPlanHandlerResult = {
  readonly targetContent: QualityTargetContentFingerprint;
  readonly operations: readonly QualityChangeOperation[];
  readonly preconditions: readonly QualityPrecondition[];
  readonly risks: readonly QualityRisk[];
  readonly verification: readonly QualityVerificationStep[];
  readonly manualItems?: readonly QualityPlanManualItem[] | undefined;
  readonly applicable: boolean;
  readonly metadata?: JsonValue | undefined;
};

export type QualityPlanHandler = (
  context: QualityPlanContext,
) => Promise<QualityPlanHandlerResult> | QualityPlanHandlerResult;

export type QualityPlanRequest = {
  readonly capabilityId: string;
  readonly producer: QualityPlanProducerReference;
  readonly target: QualityTargetReference;
  readonly providerId?: string | undefined;
  readonly input?: JsonValue | undefined;
  readonly config?: JsonValue | undefined;
  readonly grantedEffects?: readonly QualityEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type QualityPlanResult = {
  readonly schemaVersion: typeof QUALITY_PLAN_RESULT_SCHEMA_VERSION;
  readonly plan: QualityChangePlan;
  readonly diagnostics: readonly QualityDiagnostic[];
  readonly checkResultFingerprint: string;
  readonly resultFingerprint: string;
  readonly metadata?: JsonValue | undefined;
};

export type QualityFailureEvidence = {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue | undefined;
};

export type QualityApplyAuthorization = {
  readonly kind: "cli-flag" | "trusted-caller";
  readonly source: string;
};

export type QualityApplyPreflightResult = {
  readonly status: "failed" | "passed";
  readonly checkedPreconditions: readonly string[];
  readonly failure?: QualityFailureEvidence | undefined;
};

export type QualityApplyOperationReceipt = {
  readonly operationId: string;
  readonly kind: QualityChangeOperation["kind"];
  readonly status: "executed" | "not-run";
  readonly beforeFingerprint?: string | undefined;
  readonly afterFingerprint?: string | undefined;
  readonly failure?: QualityFailureEvidence | undefined;
};

export type QualityApplyReceipt = {
  readonly schemaVersion: typeof QUALITY_APPLY_RECEIPT_SCHEMA_VERSION;
  readonly receiptFingerprint: string;
  readonly runId: string;
  readonly createdAt: string;
  readonly plan: {
    readonly id: string;
    readonly fingerprint: string;
  };
  readonly target: QualityTargetReference;
  readonly authorization: QualityApplyAuthorization;
  readonly preflight: QualityApplyPreflightResult;
  readonly operations: readonly QualityApplyOperationReceipt[];
  readonly beforeContentFingerprint?: string | undefined;
  readonly afterContentFingerprint?: string | undefined;
  readonly observedEffects: readonly QualityEffectKind[];
  readonly status: "failed" | "succeeded";
  readonly failure?: QualityFailureEvidence | undefined;
};

export type QualityApplyRequest = {
  readonly plan: QualityChangePlan;
  readonly targetRoot: string;
  readonly targetId?: string | undefined;
  readonly authorization?: QualityApplyAuthorization | undefined;
  readonly grantedEffects?: readonly QualityEffectKind[] | undefined;
  readonly runId: string;
  readonly createdAt: string;
};

export type QualityVerificationStepResult = {
  readonly stepId: string;
  readonly kind: QualityVerificationStep["kind"];
  readonly status: "failed" | "incomplete" | "passed" | "unsupported";
  readonly checkResultFingerprint?: string | undefined;
  readonly diagnosticFingerprints?: readonly string[] | undefined;
  readonly failure?: QualityFailureEvidence | undefined;
};

export type QualityVerificationReceipt = {
  readonly schemaVersion: typeof QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION;
  readonly receiptFingerprint: string;
  readonly runId: string;
  readonly applyRunId: string;
  readonly createdAt: string;
  readonly plan: {
    readonly id: string;
    readonly fingerprint: string;
  };
  readonly target: QualityTargetReference;
  readonly steps: readonly QualityVerificationStepResult[];
  readonly postApplyContentFingerprint?: string | undefined;
  readonly status: "failed" | "incomplete" | "succeeded";
  readonly failure?: QualityFailureEvidence | undefined;
};

export type QualityVerificationRequest = {
  readonly plan: QualityChangePlan;
  readonly applyReceipt: QualityApplyReceipt;
  readonly runId: string;
  readonly createdAt: string;
  readonly configByCapability?: Readonly<Record<string, JsonValue>> | undefined;
  readonly grantedEffects?: readonly QualityEffectKind[] | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type QualityExplanation = {
  readonly kind: "capability" | "diagnostic" | "rule";
  readonly suiteId: string;
  readonly capabilityId: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly explanation?: string | undefined;
  readonly severity?: QualitySeverity | undefined;
  readonly remediation?: QualityRemediationReference | undefined;
};
