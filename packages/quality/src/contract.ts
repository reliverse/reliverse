import { QualityError } from "./error";
import { fingerprintJson, normalizeJson } from "./json";
import {
  QUALITY_EFFECT_KINDS,
  QUALITY_OPERATION_KINDS,
  QUALITY_READ_ONLY_CHECK_EFFECT_KINDS,
  QUALITY_SEVERITIES,
  QUALITY_SUITE_SCHEMA_VERSION,
  type QualityCapabilityDeclaration,
  type QualityEffectDeclaration,
  type QualityEffectKind,
  type QualityOperationKind,
  type QualityProviderDeclaration,
  type QualityRuleDeclaration,
  type QualitySuite,
  type QualitySuiteDefinition,
  type QualitySuiteManifest,
} from "./model";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const DIAGNOSTIC_ID_PATTERN = /^RQ-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const READ_ONLY_CHECK_EFFECTS = new Set<QualityEffectKind>(QUALITY_READ_ONLY_CHECK_EFFECT_KINDS);
const PLAN_ONLY_EFFECTS = new Set<QualityEffectKind>([
  ...QUALITY_READ_ONLY_CHECK_EFFECT_KINDS,
  "artifact.write",
]);
const OPERATION_KINDS = new Set<QualityOperationKind>(QUALITY_OPERATION_KINDS);
const EFFECT_KINDS = new Set<QualityEffectKind>(QUALITY_EFFECT_KINDS);
const SEVERITIES = new Set<string>(QUALITY_SEVERITIES);

function contractError(message: string, details: Readonly<Record<string, unknown>> = {}): never {
  throw new QualityError("RQ_CONTRACT_INVALID", message, details);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) contractError(`${label} must not be empty.`);
}

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    contractError(`${label} must use lowercase dot or dash separated tokens.`, { value });
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) contractError(`${label} must be unique.`, { value });
    seen.add(value);
  }
}

function assertOperations(operations: readonly QualityOperationKind[], label: string): void {
  if (operations.length === 0) contractError(`${label} must declare at least one operation.`);
  assertUnique(operations, `${label} operations`);
  for (const operation of operations) {
    if (!OPERATION_KINDS.has(operation)) {
      contractError(`${label} declares an unknown operation.`, { operation });
    }
  }
}

function effectAppliesTo(
  effect: QualityEffectDeclaration,
  operation: QualityOperationKind,
): boolean {
  return effect.operations == null || effect.operations.includes(operation);
}

function assertEffects(
  effects: readonly QualityEffectDeclaration[],
  label: string,
  ownerOperations: readonly QualityOperationKind[],
): void {
  for (const effect of effects) {
    if (!EFFECT_KINDS.has(effect.kind)) {
      contractError(`${label} declares an unknown effect.`, { effect: effect.kind });
    }
    assertNonEmpty(effect.reason, `${label} effect reason`);
    if (effect.operations != null) {
      assertOperations(effect.operations, `${label} effect ${effect.kind}`);
      for (const operation of effect.operations) {
        if (!ownerOperations.includes(operation)) {
          contractError(
            `${label} effect ${effect.kind} references an operation not owned by the declaration.`,
            { operation },
          );
        }
      }
    }
    if (effectAppliesTo(effect, "check") && !READ_ONLY_CHECK_EFFECTS.has(effect.kind)) {
      throw new QualityError(
        "RQ_CHECK_EFFECT_NOT_READ_ONLY",
        `${label} declares ${effect.kind} for check; check operations must remain read-only.`,
        { effect: effect.kind },
      );
    }
    if (effectAppliesTo(effect, "plan") && !PLAN_ONLY_EFFECTS.has(effect.kind)) {
      throw new QualityError(
        "RQ_PLAN_EFFECT_NOT_PLAN_ONLY",
        `${label} declares ${effect.kind} for plan; planning must not mutate the target.`,
        { effect: effect.kind },
      );
    }
  }
}

function freezeCapability(capability: QualityCapabilityDeclaration): QualityCapabilityDeclaration {
  return Object.freeze({
    ...capability,
    operations: Object.freeze([...capability.operations]),
    ...(capability.providers == null
      ? {}
      : { providers: Object.freeze([...capability.providers]) }),
    ...(capability.effects == null
      ? {}
      : {
          effects: Object.freeze(
            capability.effects.map((effect) =>
              Object.freeze({
                ...effect,
                ...(effect.operations == null
                  ? {}
                  : { operations: Object.freeze([...effect.operations]) }),
              }),
            ),
          ),
        }),
    ...(capability.artifacts == null
      ? {}
      : {
          artifacts: Object.freeze(
            capability.artifacts.map((artifact) => Object.freeze({ ...artifact })),
          ),
        }),
  });
}

function freezeRule(rule: QualityRuleDeclaration): QualityRuleDeclaration {
  return Object.freeze({
    ...rule,
    ...(rule.remediation == null ? {} : { remediation: Object.freeze({ ...rule.remediation }) }),
  });
}

function freezeProvider(provider: QualityProviderDeclaration): QualityProviderDeclaration {
  return Object.freeze({
    ...provider,
    operations: Object.freeze([...provider.operations]),
    ...(provider.effects == null
      ? {}
      : {
          effects: Object.freeze(
            provider.effects.map((effect) =>
              Object.freeze({
                ...effect,
                ...(effect.operations == null
                  ? {}
                  : { operations: Object.freeze([...effect.operations]) }),
              }),
            ),
          ),
        }),
  });
}

export function assertQualitySuiteManifest(
  manifest: QualitySuiteManifest,
  checkIds: readonly string[] = [],
  planIds: readonly string[] = [],
): void {
  if (manifest.schemaVersion !== QUALITY_SUITE_SCHEMA_VERSION) {
    contractError("Quality suite schemaVersion is not supported.", {
      actual: manifest.schemaVersion,
      expected: QUALITY_SUITE_SCHEMA_VERSION,
    });
  }
  assertId(manifest.id, "Suite id");
  assertNonEmpty(manifest.title, "Suite title");
  assertNonEmpty(manifest.description, "Suite description");

  assertUnique(
    manifest.capabilities.map((entry) => entry.id),
    "Capability ids",
  );
  assertUnique(
    manifest.rules.map((entry) => entry.id),
    "Rule ids",
  );
  assertUnique(
    manifest.rules.map((entry) => entry.diagnosticId),
    "Diagnostic ids",
  );
  assertUnique(
    manifest.providers.map((entry) => entry.id),
    "Provider ids",
  );
  assertUnique(checkIds, "Check handler capability ids");
  assertUnique(planIds, "Plan handler capability ids");

  const capabilities = new Map(manifest.capabilities.map((entry) => [entry.id, entry]));
  const providers = new Map(manifest.providers.map((entry) => [entry.id, entry]));

  for (const capability of manifest.capabilities) {
    assertId(capability.id, "Capability id");
    assertNonEmpty(capability.title, `Capability ${capability.id} title`);
    assertNonEmpty(capability.description, `Capability ${capability.id} description`);
    assertOperations(capability.operations, `Capability ${capability.id}`);
    assertEffects(capability.effects ?? [], `Capability ${capability.id}`, capability.operations);
    assertUnique(capability.providers ?? [], `Capability ${capability.id} provider references`);
    assertUnique(
      (capability.artifacts ?? []).map((entry) => entry.id),
      `Capability ${capability.id} artifact ids`,
    );

    for (const artifact of capability.artifacts ?? []) {
      assertId(artifact.id, `Capability ${capability.id} artifact id`);
      assertNonEmpty(artifact.title, `Capability ${capability.id} artifact ${artifact.id} title`);
      assertNonEmpty(
        artifact.description,
        `Capability ${capability.id} artifact ${artifact.id} description`,
      );
      assertNonEmpty(
        artifact.mediaType,
        `Capability ${capability.id} artifact ${artifact.id} mediaType`,
      );
    }

    for (const providerId of capability.providers ?? []) {
      const provider = providers.get(providerId);
      if (provider == null || provider.capabilityId !== capability.id) {
        contractError(`Capability ${capability.id} references an incompatible provider.`, {
          providerId,
        });
      }
    }
    if (
      capability.defaultProvider != null &&
      !(capability.providers ?? []).includes(capability.defaultProvider)
    ) {
      contractError(`Capability ${capability.id} defaultProvider must appear in providers.`, {
        defaultProvider: capability.defaultProvider,
      });
    }
  }

  for (const rule of manifest.rules) {
    assertId(rule.id, "Rule id");
    if (!DIAGNOSTIC_ID_PATTERN.test(rule.diagnosticId)) {
      contractError(`Rule ${rule.id} diagnosticId must use the RQ-* format.`, {
        diagnosticId: rule.diagnosticId,
      });
    }
    if (!capabilities.has(rule.capabilityId)) {
      contractError(`Rule ${rule.id} references an unknown capability.`, {
        capabilityId: rule.capabilityId,
      });
    }
    if (!SEVERITIES.has(rule.defaultSeverity)) {
      contractError(`Rule ${rule.id} declares an unknown severity.`, {
        severity: rule.defaultSeverity,
      });
    }
    assertNonEmpty(rule.title, `Rule ${rule.id} title`);
    assertNonEmpty(rule.description, `Rule ${rule.id} description`);
    assertNonEmpty(rule.explanation, `Rule ${rule.id} explanation`);
  }

  for (const provider of manifest.providers) {
    assertId(provider.id, "Provider id");
    const capability = capabilities.get(provider.capabilityId);
    if (capability == null) {
      contractError(`Provider ${provider.id} references an unknown capability.`, {
        capabilityId: provider.capabilityId,
      });
    }
    assertOperations(provider.operations, `Provider ${provider.id}`);
    for (const operation of provider.operations) {
      if (!capability.operations.includes(operation)) {
        contractError(
          `Provider ${provider.id} exposes an operation not declared by its capability.`,
          {
            operation,
          },
        );
      }
    }
    assertEffects(provider.effects ?? [], `Provider ${provider.id}`, provider.operations);
    assertNonEmpty(provider.title, `Provider ${provider.id} title`);
    assertNonEmpty(provider.version, `Provider ${provider.id} version`);
    if (!(capability.providers ?? []).includes(provider.id)) {
      contractError(`Provider ${provider.id} must be listed by capability ${capability.id}.`);
    }
  }

  for (const capabilityId of checkIds) {
    const capability = capabilities.get(capabilityId);
    if (capability == null) {
      contractError("Check handler references an unknown capability.", { capabilityId });
    }
    if (!capability.operations.includes("check")) {
      contractError(`Check handler capability ${capabilityId} does not declare check.`);
    }
  }
  for (const capabilityId of planIds) {
    const capability = capabilities.get(capabilityId);
    if (capability == null) {
      contractError("Plan handler references an unknown capability.", { capabilityId });
    }
    if (!capability.operations.includes("plan")) {
      contractError(`Plan handler capability ${capabilityId} does not declare plan.`);
    }
  }

  normalizeJson(manifest);
}

export function defineQualitySuite<const TDefinition extends QualitySuiteDefinition>(
  definition: TDefinition,
): QualitySuite {
  const manifest: QualitySuiteManifest = Object.freeze({
    schemaVersion: QUALITY_SUITE_SCHEMA_VERSION,
    id: definition.id,
    title: definition.title,
    description: definition.description,
    capabilities: Object.freeze(definition.capabilities.map(freezeCapability)),
    rules: Object.freeze(definition.rules.map(freezeRule)),
    providers: Object.freeze(definition.providers.map(freezeProvider)),
  });
  const checks = Object.freeze({ ...(definition.checks ?? {}) });
  const plans = Object.freeze({ ...(definition.plans ?? {}) });
  assertQualitySuiteManifest(manifest, Object.keys(checks), Object.keys(plans));
  return Object.freeze({
    manifest,
    checks,
    plans,
    manifestFingerprint: fingerprintJson(manifest, "rq.quality-suite-manifest.v0"),
  });
}

export function effectsForOperation(
  effects: readonly QualityEffectDeclaration[] | undefined,
  operation: QualityOperationKind,
): readonly QualityEffectDeclaration[] {
  return Object.freeze((effects ?? []).filter((effect) => effectAppliesTo(effect, operation)));
}

export function requiredQualityEffects(
  capability: QualityCapabilityDeclaration,
  provider: QualityProviderDeclaration | undefined,
  operation: QualityOperationKind,
): readonly QualityEffectDeclaration[] {
  const declarations = [
    ...effectsForOperation(capability.effects, operation),
    ...effectsForOperation(provider?.effects, operation),
  ];
  const byKind = new Map<QualityEffectKind, QualityEffectDeclaration>();
  for (const declaration of declarations) byKind.set(declaration.kind, declaration);
  return Object.freeze(
    [...byKind.values()].sort((left, right) => left.kind.localeCompare(right.kind)),
  );
}

export function requiredCheckEffects(
  capability: QualityCapabilityDeclaration,
  provider?: QualityProviderDeclaration | undefined,
): readonly QualityEffectDeclaration[] {
  return requiredQualityEffects(capability, provider, "check");
}

export function requiredPlanEffects(
  capability: QualityCapabilityDeclaration,
  provider?: QualityProviderDeclaration | undefined,
): readonly QualityEffectDeclaration[] {
  return requiredQualityEffects(capability, provider, "plan");
}

export function requiredApplyEffects(
  capability: QualityCapabilityDeclaration,
  provider?: QualityProviderDeclaration | undefined,
): readonly QualityEffectDeclaration[] {
  return requiredQualityEffects(capability, provider, "apply");
}

export function requiredVerificationEffects(
  capability: QualityCapabilityDeclaration,
  provider?: QualityProviderDeclaration | undefined,
): readonly QualityEffectDeclaration[] {
  return requiredQualityEffects(capability, provider, "verify");
}
