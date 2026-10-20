import { parseQualityApplyReceipt, fingerprintQualityPlanPaths } from "./apply";
import { QualityError } from "./error";
import { fingerprintJson, normalizeJson } from "./json";
import {
  QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION,
  type QualityApplyReceipt,
  type QualityCheckRequest,
  type QualityCheckResult,
  type QualityFailureEvidence,
  type QualityVerificationReceipt,
  type QualityVerificationRequest,
  type QualityVerificationStepResult,
} from "./model";
import { parseQualityChangePlan } from "./plan";
import { fingerprintQualityCheckResult } from "./runtime";

export const QUALITY_CANDIDATE_VERIFICATION_SCHEMA = "rq.candidate-verification.v0" as const;
export type QualityCandidateVerificationReceipt = {
  readonly schemaVersion: typeof QUALITY_CANDIDATE_VERIFICATION_SCHEMA;
  readonly runId: string;
  readonly createdAt: string;
  readonly target: QualityCheckRequest["target"];
  readonly candidateFingerprint: string;
  readonly policyFingerprint: string;
  readonly executionFingerprint: string;
  readonly checks: readonly {
    readonly capabilityId: string;
    readonly resultFingerprint: string;
    readonly suiteFingerprint: string;
    readonly provider: { readonly id: string; readonly version: string };
    readonly inputFingerprint: string;
    readonly configFingerprint: string;
    readonly errorCount: number;
    readonly warningCount: number;
  }[];
  readonly status: "failed" | "succeeded";
  readonly failure?: QualityFailureEvidence;
  readonly receiptFingerprint: string;
};
export type QualityCandidateCheck = {
  readonly request: Omit<QualityCheckRequest, "target">;
  readonly suiteFingerprint: string;
  readonly providerVersion: string;
};

export type QualityVerificationCheckRunner = {
  check(request: QualityCheckRequest): Promise<QualityCheckResult>;
};

function failure(code: string, message: string, details?: unknown): QualityFailureEvidence {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details: normalizeJson(details) }),
  };
}

function failureFromError(error: unknown): QualityFailureEvidence {
  if (error instanceof QualityError) {
    return failure(error.code, error.message, error.details);
  }
  return failure("RQ_VERIFICATION_FAILED", error instanceof Error ? error.message : String(error));
}

/** The content observer is supplied by the owning snapshot/artifact host, not an approval. */
export async function runQualityCandidateVerification(
  runner: QualityVerificationCheckRunner,
  request: {
    runId: string;
    createdAt: string;
    target: QualityCheckRequest["target"];
    candidateFingerprint: string;
    checks: readonly QualityCandidateCheck[];
    executionFingerprint: string;
    observeExecutionFingerprint: () => Promise<string>;
    observeCandidateFingerprint: () => Promise<string>;
  },
): Promise<QualityCandidateVerificationReceipt> {
  const { runId, createdAt, candidateFingerprint, executionFingerprint } = request;
  if (
    !runId ||
    !candidateFingerprint ||
    !executionFingerprint ||
    request.target.snapshot !== candidateFingerprint ||
    request.checks.length === 0 ||
    request.checks.some(
      (check) => !check.request.providerId || !check.suiteFingerprint || !check.providerVersion,
    )
  )
    throw new QualityError(
      "RQ_VERIFICATION_FAILED",
      "Candidate verification requires explicit content, checks and engine/suite identities.",
    );
  const target = normalizeJson(request.target) as unknown as QualityCheckRequest["target"];
  const specs = request.checks.map((check) => ({
    capabilityId: check.request.capabilityId,
    providerId: check.request.providerId!,
    suiteFingerprint: check.suiteFingerprint,
    providerVersion: check.providerVersion,
    input: normalizeJson(check.request.input ?? null),
    config: normalizeJson(check.request.config ?? null),
  }));
  const effects = request.checks.map((check) => [...(check.request.grantedEffects ?? [])]);
  const signals = request.checks.map((check) => check.request.signal);
  const policyFingerprint = fingerprintJson(specs, "rq.candidate-policy.v0");
  const checks: QualityCandidateVerificationReceipt["checks"][number][] = [];
  let receiptFailure: QualityFailureEvidence | undefined;
  try {
    if (
      (await request.observeCandidateFingerprint()) !== candidateFingerprint ||
      (await request.observeExecutionFingerprint()) !== executionFingerprint
    )
      throw new QualityError(
        "RQ_VERIFICATION_FAILED",
        "Candidate or execution closure changed before checks; verification was not attempted.",
      );
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const result = await runner.check({
        capabilityId: spec.capabilityId,
        providerId: spec.providerId,
        target,
        input: spec.input,
        config: spec.config,
        grantedEffects: effects[i]!,
        ...(signals[i] ? { signal: signals[i] } : {}),
      });
      if (
        result.resultFingerprint !== fingerprintQualityCheckResult(result) ||
        fingerprintJson(result.target) !== fingerprintJson(target) ||
        result.capabilityId !== spec.capabilityId ||
        result.suite.manifestFingerprint !== spec.suiteFingerprint ||
        result.provider?.id !== spec.providerId ||
        result.provider.version !== spec.providerVersion ||
        result.inputFingerprint !== fingerprintJson(spec.input, "rq.check-input.v0") ||
        result.configFingerprint !== fingerprintJson(spec.config, "rq.check-config.v0")
      )
        throw new QualityError(
          "RQ_VERIFICATION_FAILED",
          "Check result does not match candidate target or pinned suite/provider/config/input.",
        );
      checks.push({
        capabilityId: result.capabilityId,
        resultFingerprint: result.resultFingerprint,
        suiteFingerprint: result.suite.manifestFingerprint,
        provider: result.provider,
        inputFingerprint: result.inputFingerprint,
        configFingerprint: result.configFingerprint,
        errorCount: result.summary.error,
        warningCount: result.summary.warning,
      });
    }
    if (
      (await request.observeCandidateFingerprint()) !== candidateFingerprint ||
      (await request.observeExecutionFingerprint()) !== executionFingerprint
    )
      throw new QualityError(
        "RQ_VERIFICATION_FAILED",
        "Candidate or execution closure changed during checks; results cannot grant acceptance.",
      );
  } catch (error) {
    receiptFailure = failureFromError(error);
  }
  const semantic = {
    schemaVersion: QUALITY_CANDIDATE_VERIFICATION_SCHEMA,
    runId,
    createdAt,
    target,
    candidateFingerprint,
    executionFingerprint,
    policyFingerprint,
    checks,
    status:
      receiptFailure || checks.some((check) => check.errorCount > 0)
        ? ("failed" as const)
        : ("succeeded" as const),
    ...(receiptFailure ? { failure: receiptFailure } : {}),
  };
  return normalizeJson({
    ...semantic,
    receiptFingerprint: fingerprintJson(semantic, QUALITY_CANDIDATE_VERIFICATION_SCHEMA),
  }) as unknown as QualityCandidateVerificationReceipt;
}

/** Content/policy hashes prove binding, not producer authenticity or execution authority. */
export function assertQualityCandidateVerificationReceipt(
  receipt: QualityCandidateVerificationReceipt,
  expected: {
    candidateFingerprint: string;
    policyFingerprint: string;
    executionFingerprint: string;
  },
): void {
  const { receiptFingerprint, ...semantic } = receipt;
  if (
    receipt.schemaVersion !== QUALITY_CANDIDATE_VERIFICATION_SCHEMA ||
    receiptFingerprint !== fingerprintJson(semantic, QUALITY_CANDIDATE_VERIFICATION_SCHEMA) ||
    receipt.status !== "succeeded" ||
    receipt.checks.length === 0 ||
    receipt.failure ||
    receipt.checks.some((check) => check.errorCount !== 0) ||
    receipt.candidateFingerprint !== expected.candidateFingerprint ||
    receipt.target.snapshot !== expected.candidateFingerprint ||
    receipt.policyFingerprint !== expected.policyFingerprint ||
    receipt.executionFingerprint !== expected.executionFingerprint
  )
    throw new QualityError(
      "RQ_VERIFICATION_FAILED",
      "Candidate receipt is failed, stale, tampered or policy-mismatched.",
    );
}

function freezeReceipt(
  receipt: Omit<QualityVerificationReceipt, "receiptFingerprint">,
): QualityVerificationReceipt {
  const normalized = normalizeJson(receipt);
  return normalizeJson({
    ...(normalized as Readonly<Record<string, unknown>>),
    receiptFingerprint: fingerprintJson(normalized, "rq.verification-receipt.v0"),
  }) as unknown as QualityVerificationReceipt;
}

function assertReceiptMatchesPlan(
  applyReceipt: QualityApplyReceipt,
  planId: string,
  planFingerprint: string,
): void {
  if (
    applyReceipt.status !== "succeeded" ||
    applyReceipt.preflight.status !== "passed" ||
    applyReceipt.plan.id !== planId ||
    applyReceipt.plan.fingerprint !== planFingerprint
  ) {
    throw new QualityError(
      "RQ_VERIFICATION_FAILED",
      "Verification requires a successful apply receipt for the exact plan.",
      {
        applyStatus: applyReceipt.status,
        planId,
        receiptPlanId: applyReceipt.plan.id,
      },
    );
  }
}

export async function runQualityVerification(
  runner: QualityVerificationCheckRunner,
  request: QualityVerificationRequest,
): Promise<QualityVerificationReceipt> {
  const plan = parseQualityChangePlan(request.plan);
  const applyReceipt = parseQualityApplyReceipt(request.applyReceipt);
  assertReceiptMatchesPlan(applyReceipt, plan.planId, plan.planFingerprint);
  if (!plan.target.root) {
    throw new QualityError("RQ_VERIFICATION_FAILED", "Verification requires a plan target root.");
  }

  let postApplyContentFingerprint: string | undefined;
  try {
    postApplyContentFingerprint = await fingerprintQualityPlanPaths(
      plan.target.root,
      plan.operations,
    );
  } catch (error) {
    const receiptFailure = failureFromError(error);
    return freezeReceipt({
      schemaVersion: QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION,
      runId: request.runId,
      applyRunId: applyReceipt.runId,
      createdAt: request.createdAt,
      plan: { id: plan.planId, fingerprint: plan.planFingerprint },
      target: plan.target,
      steps: [],
      status: "failed",
      failure: receiptFailure,
    });
  }

  if (applyReceipt.afterContentFingerprint !== postApplyContentFingerprint) {
    const receiptFailure = failure(
      "RQ_VERIFICATION_FAILED",
      "Target content changed after apply and before verification.",
      {
        actual: postApplyContentFingerprint,
        expected: applyReceipt.afterContentFingerprint ?? null,
      },
    );
    return freezeReceipt({
      schemaVersion: QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION,
      runId: request.runId,
      applyRunId: applyReceipt.runId,
      createdAt: request.createdAt,
      plan: { id: plan.planId, fingerprint: plan.planFingerprint },
      target: plan.target,
      steps: [],
      postApplyContentFingerprint,
      status: "failed",
      failure: receiptFailure,
    });
  }

  const plannedDiagnostics = new Set(plan.diagnostics);
  const steps: QualityVerificationStepResult[] = [];
  for (const step of plan.verification) {
    if (step.kind === "manual") {
      steps.push({ stepId: step.id, kind: step.kind, status: "incomplete" });
      continue;
    }
    if (step.kind === "command") {
      steps.push({
        stepId: step.id,
        kind: step.kind,
        status: "unsupported",
        failure: failure(
          "RQ_VERIFICATION_FAILED",
          "Stage 75 does not execute command verification steps; use typed quality checks.",
          { command: step.command },
        ),
      });
      continue;
    }
    try {
      const result = await runner.check({
        capabilityId: step.capabilityId,
        target: plan.target,
        config: request.configByCapability?.[step.capabilityId] ?? null,
        grantedEffects: request.grantedEffects ?? [],
        ...(request.signal ? { signal: request.signal } : {}),
      });
      const remainingDiagnostics = result.diagnostics
        .map((entry) => entry.fingerprint)
        .filter((fingerprint) => plannedDiagnostics.has(fingerprint));
      const passed = result.summary.error === 0 && remainingDiagnostics.length === 0;
      steps.push({
        stepId: step.id,
        kind: step.kind,
        status: passed ? "passed" : "failed",
        checkResultFingerprint: result.resultFingerprint,
        diagnosticFingerprints: Object.freeze(result.diagnostics.map((entry) => entry.fingerprint)),
        ...(passed
          ? {}
          : {
              failure: failure(
                "RQ_VERIFICATION_FAILED",
                `Quality verification check ${step.capabilityId} did not satisfy the plan.`,
                {
                  errors: result.summary.error,
                  remainingPlannedDiagnostics: remainingDiagnostics,
                },
              ),
            }),
      });
    } catch (error) {
      steps.push({
        stepId: step.id,
        kind: step.kind,
        status: "failed",
        failure: failureFromError(error),
      });
    }
  }

  const hasFailure = steps.some(
    (step) => step.status === "failed" || step.status === "unsupported",
  );
  const hasIncomplete = steps.some((step) => step.status === "incomplete");
  const status = hasFailure ? "failed" : hasIncomplete ? "incomplete" : "succeeded";
  return freezeReceipt({
    schemaVersion: QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION,
    runId: request.runId,
    applyRunId: applyReceipt.runId,
    createdAt: request.createdAt,
    plan: { id: plan.planId, fingerprint: plan.planFingerprint },
    target: plan.target,
    steps: Object.freeze(steps),
    postApplyContentFingerprint,
    status,
    ...(status === "succeeded"
      ? {}
      : {
          failure: failure(
            "RQ_VERIFICATION_FAILED",
            status === "incomplete"
              ? "Verification contains unresolved manual steps."
              : "One or more verification steps failed.",
          ),
        }),
  });
}

export function parseQualityVerificationReceipt(value: unknown): QualityVerificationReceipt {
  const normalized = normalizeJson(value) as unknown as QualityVerificationReceipt;
  if (
    normalized.schemaVersion !== QUALITY_VERIFICATION_RECEIPT_SCHEMA_VERSION ||
    typeof normalized.receiptFingerprint !== "string" ||
    typeof normalized.runId !== "string" ||
    typeof normalized.applyRunId !== "string" ||
    !["failed", "incomplete", "succeeded"].includes(normalized.status) ||
    !Array.isArray(normalized.steps)
  ) {
    throw new QualityError(
      "RQ_VERIFICATION_RECEIPT_INVALID",
      "Verification receipt schema is invalid.",
    );
  }
  const { receiptFingerprint, ...semanticReceipt } = normalized;
  const expectedFingerprint = fingerprintJson(semanticReceipt, "rq.verification-receipt.v0");
  if (receiptFingerprint !== expectedFingerprint) {
    throw new QualityError(
      "RQ_VERIFICATION_RECEIPT_INVALID",
      "Verification receipt fingerprint does not match its content.",
    );
  }
  return normalized;
}
