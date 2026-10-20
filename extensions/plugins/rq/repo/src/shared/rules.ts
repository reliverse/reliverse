import type { QualityRuleDeclaration, QualitySeverity } from "@reliverse/quality";

export function defineRepositoryRule(
  capabilityId: string,
  slug: string,
  title: string,
  description: string,
  explanation: string,
  remediation: string,
  defaultSeverity: QualitySeverity = "error",
): QualityRuleDeclaration {
  return Object.freeze({
    id: `${capabilityId}.${slug}`,
    diagnosticId: `RQ-${capabilityId.replaceAll(".", "-").toUpperCase()}-${slug.replaceAll(".", "-").toUpperCase()}`,
    capabilityId,
    title,
    description,
    explanation,
    defaultSeverity,
    remediation: { kind: "manual" as const, summary: remediation },
  });
}
