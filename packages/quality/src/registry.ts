import { runQualityApply } from "./apply";
import { QualityError } from "./error";
import { explainQualityIdentifier } from "./explain";
import type {
  QualityApplyReceipt,
  QualityApplyRequest,
  QualityCheckRequest,
  QualityCheckResult,
  QualityExplanation,
  QualityPlanRequest,
  QualityPlanResult,
  QualitySuite,
  QualityVerificationReceipt,
  QualityVerificationRequest,
} from "./model";
import { runQualityPlan } from "./plan";
import { runQualityCheck } from "./runtime";
import { runQualityVerification } from "./verify";

export type QualityRegistry = {
  readonly suites: readonly QualitySuite[];
  readonly capabilities: readonly string[];
  getSuite(suiteId: string): QualitySuite | undefined;
  getCapabilityOwner(capabilityId: string): QualitySuite | undefined;
  check(request: QualityCheckRequest): Promise<QualityCheckResult>;
  plan(request: QualityPlanRequest): Promise<QualityPlanResult>;
  apply(request: QualityApplyRequest): Promise<QualityApplyReceipt>;
  verify(request: QualityVerificationRequest): Promise<QualityVerificationReceipt>;
  explain(identifier: string): QualityExplanation;
};

export function createQualityRegistry(suites: readonly QualitySuite[]): QualityRegistry {
  const bySuiteId = new Map<string, QualitySuite>();
  const byCapability = new Map<string, QualitySuite>();
  const byRuleId = new Map<string, QualitySuite>();
  const byDiagnosticId = new Map<string, QualitySuite>();

  for (const suite of suites) {
    if (bySuiteId.has(suite.manifest.id)) {
      throw new QualityError("RQ_SUITE_COLLISION", "Quality suite identity collision.", {
        suiteId: suite.manifest.id,
      });
    }
    bySuiteId.set(suite.manifest.id, suite);
    for (const capability of suite.manifest.capabilities) {
      const owner = byCapability.get(capability.id);
      if (owner != null) {
        throw new QualityError(
          "RQ_CAPABILITY_COLLISION",
          `Capability ${capability.id} has more than one owner.`,
          { firstSuiteId: owner.manifest.id, secondSuiteId: suite.manifest.id },
        );
      }
      byCapability.set(capability.id, suite);
    }
    for (const rule of suite.manifest.rules) {
      const ruleOwner = byRuleId.get(rule.id);
      if (ruleOwner != null) {
        throw new QualityError("RQ_RULE_COLLISION", `Rule ${rule.id} has more than one owner.`, {
          firstSuiteId: ruleOwner.manifest.id,
          secondSuiteId: suite.manifest.id,
        });
      }
      byRuleId.set(rule.id, suite);

      const diagnosticOwner = byDiagnosticId.get(rule.diagnosticId);
      if (diagnosticOwner != null) {
        throw new QualityError(
          "RQ_DIAGNOSTIC_COLLISION",
          `Diagnostic ${rule.diagnosticId} has more than one owner.`,
          {
            firstSuiteId: diagnosticOwner.manifest.id,
            secondSuiteId: suite.manifest.id,
          },
        );
      }
      byDiagnosticId.set(rule.diagnosticId, suite);
    }
  }

  const orderedSuites = Object.freeze(
    [...suites].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)),
  );
  const capabilityIds = Object.freeze([...byCapability.keys()].sort());

  const check = async (request: QualityCheckRequest): Promise<QualityCheckResult> => {
    const suite = byCapability.get(request.capabilityId);
    if (suite == null) {
      throw new QualityError(
        "RQ_CAPABILITY_NOT_FOUND",
        `No installed suite owns ${request.capabilityId}.`,
        { capabilityId: request.capabilityId },
      );
    }
    return runQualityCheck(suite, request);
  };

  const registry: QualityRegistry = {
    suites: orderedSuites,
    capabilities: capabilityIds,
    getSuite(suiteId: string) {
      return bySuiteId.get(suiteId);
    },
    getCapabilityOwner(capabilityId: string) {
      return byCapability.get(capabilityId);
    },
    check,
    async plan(request: QualityPlanRequest) {
      const suite = byCapability.get(request.capabilityId);
      if (suite == null) {
        throw new QualityError(
          "RQ_CAPABILITY_NOT_FOUND",
          `No installed suite owns ${request.capabilityId}.`,
          { capabilityId: request.capabilityId },
        );
      }
      return runQualityPlan(suite, request);
    },
    async apply(request: QualityApplyRequest) {
      const suite = byCapability.get(request.plan.capabilityId);
      if (suite == null || suite.manifest.id !== request.plan.suite.id) {
        throw new QualityError(
          "RQ_CAPABILITY_NOT_FOUND",
          `No installed suite owns ${request.plan.capabilityId} for plan suite ${request.plan.suite.id}.`,
          { capabilityId: request.plan.capabilityId, suiteId: request.plan.suite.id },
        );
      }
      return runQualityApply(suite, request);
    },
    async verify(request: QualityVerificationRequest) {
      return runQualityVerification(registry, request);
    },
    explain(identifier: string) {
      const capabilityOwner = byCapability.get(identifier);
      if (capabilityOwner != null) {
        return explainQualityIdentifier(capabilityOwner, identifier);
      }
      for (const suite of orderedSuites) {
        if (
          suite.manifest.rules.some(
            (rule) => rule.id === identifier || rule.diagnosticId === identifier,
          )
        ) {
          return explainQualityIdentifier(suite, identifier);
        }
      }
      throw new QualityError(
        "RQ_IDENTIFIER_NOT_FOUND",
        `No installed suite explains ${identifier}.`,
        { identifier },
      );
    },
  };
  return Object.freeze(registry);
}
