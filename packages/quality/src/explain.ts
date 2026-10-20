import { QualityError } from "./error";
import type { QualityExplanation, QualitySuite } from "./model";

export function explainQualityIdentifier(
  suite: QualitySuite,
  identifier: string,
): QualityExplanation {
  const capability = suite.manifest.capabilities.find((entry) => entry.id === identifier);
  if (capability != null) {
    return Object.freeze({
      kind: "capability",
      suiteId: suite.manifest.id,
      capabilityId: capability.id,
      identifier: capability.id,
      title: capability.title,
      description: capability.description,
    });
  }

  const rule = suite.manifest.rules.find(
    (entry) => entry.id === identifier || entry.diagnosticId === identifier,
  );
  if (rule != null) {
    return Object.freeze({
      kind: identifier === rule.diagnosticId ? "diagnostic" : "rule",
      suiteId: suite.manifest.id,
      capabilityId: rule.capabilityId,
      identifier,
      title: rule.title,
      description: rule.description,
      explanation: rule.explanation,
      severity: rule.defaultSeverity,
      ...(rule.remediation == null ? {} : { remediation: rule.remediation }),
    });
  }

  throw new QualityError("RQ_IDENTIFIER_NOT_FOUND", `Unknown quality identifier: ${identifier}.`, {
    identifier,
    suiteId: suite.manifest.id,
  });
}
