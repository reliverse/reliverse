import { QualityError } from "./error";
import { fingerprintJson, normalizeJson } from "./json";
import type {
  QualityCheckSummary,
  QualityDiagnostic,
  QualityDiagnosticInput,
  QualityRuleDeclaration,
  QualitySeverity,
} from "./model";

const SEVERITY_ORDER: Readonly<Record<QualitySeverity, number>> = Object.freeze({
  error: 0,
  warning: 1,
  info: 2,
});

function optionalField<T>(
  key: string,
  value: T | undefined,
): Record<string, T> | Record<string, never> {
  return value === undefined ? {} : { [key]: value };
}

export function createQualityDiagnostic(
  rule: QualityRuleDeclaration,
  input: QualityDiagnosticInput,
): QualityDiagnostic {
  const normalizedEvidence =
    input.evidence == null
      ? undefined
      : (normalizeJson(input.evidence) as unknown as QualityDiagnostic["evidence"]);
  const normalizedData = input.data == null ? undefined : normalizeJson(input.data);
  const normalized: Omit<QualityDiagnostic, "fingerprint"> = Object.freeze({
    id: rule.diagnosticId,
    ruleId: rule.id,
    capabilityId: rule.capabilityId,
    severity: input.severity ?? rule.defaultSeverity,
    message: input.message,
    ...optionalField("path", input.path),
    ...optionalField("range", input.range),
    ...optionalField("evidence", normalizedEvidence),
    ...optionalField("remediation", input.remediation ?? rule.remediation),
    ...optionalField("data", normalizedData),
  }) as Omit<QualityDiagnostic, "fingerprint">;

  normalizeJson(normalized);
  return Object.freeze({
    ...normalized,
    fingerprint: fingerprintJson(normalized, "rq.diagnostic.v0"),
  });
}

function positionKey(diagnostic: QualityDiagnostic): string {
  const line = diagnostic.range?.start.line ?? 0;
  const column = diagnostic.range?.start.column ?? 0;
  return `${line.toString().padStart(10, "0")}:${column.toString().padStart(10, "0")}`;
}

export function compareQualityDiagnostics(
  left: QualityDiagnostic,
  right: QualityDiagnostic,
): number {
  return (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    positionKey(left).localeCompare(positionKey(right)) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.message.localeCompare(right.message) ||
    left.fingerprint.localeCompare(right.fingerprint)
  );
}

export function normalizeQualityDiagnostics(
  diagnostics: readonly QualityDiagnostic[],
): readonly QualityDiagnostic[] {
  const ordered = [...diagnostics].sort(compareQualityDiagnostics);
  const fingerprints = new Map<string, number>();
  for (const [index, diagnostic] of ordered.entries()) {
    const firstIndex = fingerprints.get(diagnostic.fingerprint);
    if (firstIndex !== undefined) {
      throw new QualityError(
        "RQ_DIAGNOSTIC_DUPLICATE",
        "A check returned the same diagnostic occurrence more than once.",
        {
          fingerprint: diagnostic.fingerprint,
          ruleId: diagnostic.ruleId,
          path: diagnostic.path ?? null,
          firstIndex,
          duplicateIndex: index,
        },
      );
    }
    fingerprints.set(diagnostic.fingerprint, index);
  }
  return Object.freeze(ordered);
}

export function summarizeQualityDiagnostics(
  diagnostics: readonly QualityDiagnostic[],
): QualityCheckSummary {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") error += 1;
    else if (diagnostic.severity === "warning") warning += 1;
    else info += 1;
  }
  return Object.freeze({ total: diagnostics.length, error, warning, info });
}
