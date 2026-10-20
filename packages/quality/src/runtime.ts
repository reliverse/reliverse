import { requiredCheckEffects } from "./contract";
import {
  createQualityDiagnostic,
  normalizeQualityDiagnostics,
  summarizeQualityDiagnostics,
} from "./diagnostics";
import { QualityError } from "./error";
import { fingerprintJson, normalizeJson } from "./json";
import {
  QUALITY_CHECK_RESULT_SCHEMA_VERSION,
  type QualityCapabilityDeclaration,
  type QualityCheckHandlerResult,
  type QualityCheckRequest,
  type QualityCheckResult,
  type QualityEffectKind,
  type QualityProviderDeclaration,
  type QualitySuite,
} from "./model";

export function fingerprintQualityCheckResult(
  result: Omit<QualityCheckResult, "resultFingerprint"> | QualityCheckResult,
): string {
  const { metadata: _metadata, execution: _execution, ...fields } = result;
  const semantic = {
    ...fields,
    target: {
      kind: result.target.kind,
      id: result.target.id,
      ...(result.target.snapshot === undefined ? {} : { snapshot: result.target.snapshot }),
    },
  };
  delete (semantic as { resultFingerprint?: string }).resultFingerprint;
  return fingerprintJson(semantic, "rq.check-result.v0");
}

function getCapability(suite: QualitySuite, capabilityId: string): QualityCapabilityDeclaration {
  const capability = suite.manifest.capabilities.find((entry) => entry.id === capabilityId);
  if (capability == null) {
    throw new QualityError(
      "RQ_CAPABILITY_NOT_FOUND",
      `Quality capability ${capabilityId} is not provided by ${suite.manifest.id}.`,
      { capabilityId, suiteId: suite.manifest.id },
    );
  }
  return capability;
}

export function resolveQualityProvider(
  suite: QualitySuite,
  capabilityId: string,
  requestedProviderId?: string | undefined,
): QualityProviderDeclaration | undefined {
  const capability = getCapability(suite, capabilityId);
  const providerIds = capability.providers ?? [];
  const providerId =
    requestedProviderId ??
    capability.defaultProvider ??
    (providerIds.length === 1 ? providerIds[0] : undefined);

  if (providerId == null) {
    if (providerIds.length > 1) {
      throw new QualityError(
        "RQ_PROVIDER_AMBIGUOUS",
        `Capability ${capabilityId} requires an explicit provider selection.`,
        { providers: providerIds },
      );
    }
    return undefined;
  }

  if (!providerIds.includes(providerId)) {
    throw new QualityError(
      "RQ_PROVIDER_NOT_FOUND",
      `Provider ${providerId} is not registered for ${capabilityId}.`,
      { capabilityId, providerId },
    );
  }
  const provider = suite.manifest.providers.find((entry) => entry.id === providerId);
  if (provider == null || provider.capabilityId !== capabilityId) {
    throw new QualityError(
      "RQ_PROVIDER_NOT_FOUND",
      `Provider ${providerId} is not available for ${capabilityId}.`,
      { capabilityId, providerId },
    );
  }
  return provider;
}

function assertEffectsGranted(
  required: readonly QualityEffectKind[],
  granted: readonly QualityEffectKind[],
): void {
  const grants = new Set(granted);
  for (const effect of required) {
    if (!grants.has(effect)) {
      throw new QualityError(
        "RQ_EFFECT_NOT_GRANTED",
        `Quality check requires the undeclared grant ${effect}.`,
        { effect },
      );
    }
  }
}

function normalizeHandlerResult(
  value: QualityCheckHandlerResult | readonly import("./model").QualityDiagnosticInput[],
): QualityCheckHandlerResult {
  if (Array.isArray(value)) {
    return { diagnostics: value as readonly import("./model").QualityDiagnosticInput[] };
  }
  return value as QualityCheckHandlerResult;
}

export async function runQualityCheck(
  suite: QualitySuite,
  request: QualityCheckRequest,
): Promise<QualityCheckResult> {
  const capability = getCapability(suite, request.capabilityId);
  if (!capability.operations.includes("check")) {
    throw new QualityError(
      "RQ_CHECK_NOT_SUPPORTED",
      `Capability ${capability.id} does not support check.`,
      { capabilityId: capability.id },
    );
  }
  const handler = suite.checks[capability.id];
  if (handler == null) {
    throw new QualityError(
      "RQ_CHECK_HANDLER_NOT_FOUND",
      `Capability ${capability.id} has no in-process check handler.`,
      { capabilityId: capability.id },
    );
  }
  const provider = resolveQualityProvider(suite, capability.id, request.providerId);
  if (provider != null && !provider.operations.includes("check")) {
    throw new QualityError(
      "RQ_CHECK_NOT_SUPPORTED",
      `Provider ${provider.id} does not support check.`,
      { providerId: provider.id },
    );
  }

  const requiredEffects = requiredCheckEffects(capability, provider).map((entry) => entry.kind);
  assertEffectsGranted(requiredEffects, request.grantedEffects ?? []);

  const input = normalizeJson(request.input ?? null);
  const config = normalizeJson(request.config ?? null);
  const target = normalizeJson(request.target) as unknown as QualityCheckRequest["target"];
  const returned = normalizeHandlerResult(
    await handler({
      suite: suite.manifest,
      capability,
      ...(provider == null ? {} : { provider }),
      target,
      input,
      config,
      ...(request.signal == null ? {} : { signal: request.signal }),
    }),
  );

  const rules = new Map(suite.manifest.rules.map((rule) => [rule.id, rule]));
  const diagnostics = normalizeQualityDiagnostics(
    returned.diagnostics.map((entry) => {
      const rule = rules.get(entry.ruleId);
      if (rule == null) {
        throw new QualityError(
          "RQ_RULE_NOT_FOUND",
          `Check returned an unknown rule id ${entry.ruleId}.`,
          { ruleId: entry.ruleId },
        );
      }
      if (rule.capabilityId !== capability.id) {
        throw new QualityError(
          "RQ_RULE_NOT_FOUND",
          `Rule ${entry.ruleId} does not belong to ${capability.id}.`,
          { capabilityId: capability.id, ruleCapabilityId: rule.capabilityId },
        );
      }
      return createQualityDiagnostic(rule, entry);
    }),
  );

  const execution = returned.execution == null ? undefined : normalizeJson(returned.execution);
  const metadata = returned.metadata == null ? undefined : normalizeJson(returned.metadata);
  const resultWithoutFingerprint = {
    schemaVersion: QUALITY_CHECK_RESULT_SCHEMA_VERSION,
    suite: {
      id: suite.manifest.id,
      manifestFingerprint: suite.manifestFingerprint,
    },
    capabilityId: capability.id,
    ...(provider == null ? {} : { provider: { id: provider.id, version: provider.version } }),
    target,
    inputFingerprint: fingerprintJson(input, "rq.check-input.v0"),
    configFingerprint: fingerprintJson(config, "rq.check-config.v0"),
    diagnostics,
    summary: summarizeQualityDiagnostics(diagnostics),
    ...(metadata == null ? {} : { metadata }),
  };
  normalizeJson(resultWithoutFingerprint);

  return Object.freeze({
    ...resultWithoutFingerprint,
    ...(execution == null ? {} : { execution }),
    resultFingerprint: fingerprintQualityCheckResult(resultWithoutFingerprint),
  });
}
