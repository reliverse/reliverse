import { requiredPlanEffects } from "./contract";
import { QualityError } from "./error";
import { fingerprintJson, normalizeJson } from "./json";
import {
  QUALITY_CHANGE_PLAN_SCHEMA_VERSION,
  QUALITY_PLAN_RESULT_SCHEMA_VERSION,
  type QualityCapabilityDeclaration,
  type QualityChangeOperation,
  type QualityChangePlan,
  type QualityEffectKind,
  type QualityPlanHandlerResult,
  type QualityPlanRequest,
  type QualityPlanResult,
  type QualityPlanManualItem,
  type QualityPrecondition,
  type QualityRisk,
  type QualityProviderDeclaration,
  type QualitySuite,
  type QualityTargetReference,
  type QualityVerificationStep,
} from "./model";
import { resolveQualityProvider, runQualityCheck } from "./runtime";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

function invalid(message: string, details: Readonly<Record<string, unknown>> = {}): never {
  throw new QualityError("RQ_PLAN_INVALID", message, details);
}

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value))
    invalid(`${label} must use lowercase dot or dash separated tokens.`, { value });
}

function assertFingerprint(value: string, label: string): void {
  if (!FINGERPRINT_PATTERN.test(value))
    invalid(`${label} must be a lowercase SHA-256 fingerprint.`, { value });
}

function assertRepositoryPath(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    invalid(`${label} must be a normalized repository-relative path.`, { value });
  }
}

function operationPath(operation: QualityChangeOperation): string {
  return "path" in operation ? operation.path : operation.from;
}

function compareOperations(left: QualityChangeOperation, right: QualityChangeOperation): number {
  return (
    operationPath(left).localeCompare(operationPath(right)) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );
}

function assertUniqueIds(values: readonly { readonly id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertId(value.id, `${label} id`);
    if (seen.has(value.id)) invalid(`${label} ids must be unique.`, { id: value.id });
    seen.add(value.id);
  }
}

function operationTouchedPaths(operation: QualityChangeOperation): readonly string[] {
  return "path" in operation ? [operation.path] : [operation.from, operation.to];
}

function operationUsesExclusivePath(operation: QualityChangeOperation): boolean {
  return (
    operation.kind === "create-file" ||
    operation.kind === "delete-path" ||
    operation.kind === "move-path" ||
    operation.kind === "rename-path"
  );
}

function operationConflictKeys(operation: QualityChangeOperation): readonly string[] {
  switch (operation.kind) {
    case "write-json":
      return [`json:${operation.path}:${operation.pointer}`];
    case "replace-text":
      return [`text:${operation.path}:${operation.before}`];
    case "create-file":
    case "delete-path":
      return [`path:${operation.path}`];
    case "move-path":
    case "rename-path":
      return [`path:${operation.from}`, `path:${operation.to}`];
  }
}

function assertOperation(operation: QualityChangeOperation): void {
  switch (operation.kind) {
    case "write-json":
      assertRepositoryPath(operation.path, `Operation ${operation.id} path`);
      if (!operation.pointer.startsWith("/"))
        invalid(`Operation ${operation.id} JSON pointer must start with /.`);
      if (JSON.stringify(operation.before) === JSON.stringify(operation.after)) {
        invalid(`Operation ${operation.id} must change the JSON value.`);
      }
      assertFingerprint(operation.fileFingerprint, `Operation ${operation.id} fileFingerprint`);
      return;
    case "replace-text":
      assertRepositoryPath(operation.path, `Operation ${operation.id} path`);
      if (operation.before.length === 0 || operation.before === operation.after) {
        invalid(`Operation ${operation.id} must replace non-empty text with a different value.`);
      }
      if (!Number.isInteger(operation.expectedOccurrences) || operation.expectedOccurrences < 1) {
        invalid(`Operation ${operation.id} expectedOccurrences must be a positive integer.`);
      }
      assertFingerprint(operation.fileFingerprint, `Operation ${operation.id} fileFingerprint`);
      return;
    case "create-file":
      assertRepositoryPath(operation.path, `Operation ${operation.id} path`);
      if (operation.targetMustBeAbsent !== true)
        invalid(`Operation ${operation.id} must require an absent target.`);
      return;
    case "move-path":
    case "rename-path":
      assertRepositoryPath(operation.from, `Operation ${operation.id} source path`);
      assertRepositoryPath(operation.to, `Operation ${operation.id} target path`);
      if (operation.from === operation.to)
        invalid(`Operation ${operation.id} source and target must differ.`);
      if (operation.targetMustBeAbsent !== true)
        invalid(`Operation ${operation.id} must require an absent target.`);
      assertFingerprint(operation.sourceFingerprint, `Operation ${operation.id} sourceFingerprint`);
      return;
    case "delete-path":
      assertRepositoryPath(operation.path, `Operation ${operation.id} path`);
      assertFingerprint(operation.beforeFingerprint, `Operation ${operation.id} beforeFingerprint`);
      return;
  }
}

function assertPrecondition(precondition: QualityPrecondition): void {
  assertRepositoryPath(precondition.path, `Precondition ${precondition.id} path`);
  if (precondition.kind === "file-fingerprint") {
    assertFingerprint(
      precondition.expected,
      `Precondition ${precondition.id} expected fingerprint`,
    );
  }
  if (precondition.kind === "json-value" && !precondition.pointer.startsWith("/")) {
    invalid(`Precondition ${precondition.id} JSON pointer must start with /.`);
  }
}

function hasPrecondition(
  preconditions: readonly QualityPrecondition[],
  predicate: (entry: QualityPrecondition) => boolean,
): boolean {
  return preconditions.some(predicate);
}

function assertOperationPreconditions(
  operation: QualityChangeOperation,
  preconditions: readonly QualityPrecondition[],
): void {
  const hasFileFingerprint = (path: string, expected: string) =>
    hasPrecondition(
      preconditions,
      (entry) =>
        entry.kind === "file-fingerprint" && entry.path === path && entry.expected === expected,
    );
  const hasAbsentPath = (path: string) =>
    hasPrecondition(preconditions, (entry) => entry.kind === "path-absent" && entry.path === path);

  switch (operation.kind) {
    case "write-json":
      if (!hasFileFingerprint(operation.path, operation.fileFingerprint)) {
        invalid(`Operation ${operation.id} lacks its file-fingerprint precondition.`);
      }
      if (
        !hasPrecondition(
          preconditions,
          (entry) =>
            entry.kind === "json-value" &&
            entry.path === operation.path &&
            entry.pointer === operation.pointer &&
            JSON.stringify(entry.expected) === JSON.stringify(operation.before),
        )
      ) {
        invalid(`Operation ${operation.id} lacks its previous JSON value precondition.`);
      }
      return;
    case "replace-text":
      if (!hasFileFingerprint(operation.path, operation.fileFingerprint)) {
        invalid(`Operation ${operation.id} lacks its file-fingerprint precondition.`);
      }
      return;
    case "create-file":
      if (!hasAbsentPath(operation.path))
        invalid(`Operation ${operation.id} lacks its absent-path precondition.`);
      return;
    case "move-path":
    case "rename-path":
      if (
        !hasFileFingerprint(operation.from, operation.sourceFingerprint) ||
        !hasAbsentPath(operation.to)
      ) {
        invalid(`Operation ${operation.id} lacks source or target preconditions.`);
      }
      return;
    case "delete-path":
      if (!hasFileFingerprint(operation.path, operation.beforeFingerprint)) {
        invalid(`Operation ${operation.id} lacks its file-fingerprint precondition.`);
      }
      return;
  }
}

function normalizePlanHandlerResult(result: QualityPlanHandlerResult): QualityPlanHandlerResult {
  return normalizeJson(result) as unknown as QualityPlanHandlerResult;
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
        `Quality plan requires the undeclared grant ${effect}.`,
        { effect },
      );
    }
  }
}

function getCapability(suite: QualitySuite, capabilityId: string): QualityCapabilityDeclaration {
  const capability = suite.manifest.capabilities.find((entry) => entry.id === capabilityId);
  if (!capability) {
    throw new QualityError(
      "RQ_CAPABILITY_NOT_FOUND",
      `Quality capability ${capabilityId} is not provided by ${suite.manifest.id}.`,
      {
        capabilityId,
        suiteId: suite.manifest.id,
      },
    );
  }
  return capability;
}

function assertPlanProvider(
  provider: QualityProviderDeclaration | undefined,
  capabilityId: string,
): void {
  if (provider && !provider.operations.includes("plan")) {
    throw new QualityError(
      "RQ_PLAN_NOT_SUPPORTED",
      `Provider ${provider.id} does not support plan.`,
      {
        capabilityId,
        providerId: provider.id,
      },
    );
  }
}

export function normalizeQualityChangeOperations(
  operations: readonly QualityChangeOperation[],
): readonly QualityChangeOperation[] {
  const normalized = normalizeJson(operations) as unknown as readonly QualityChangeOperation[];
  return Object.freeze([...normalized].sort(compareOperations));
}

export function assertQualityPlanHandlerResult(result: QualityPlanHandlerResult): void {
  assertFingerprint(result.targetContent.fingerprint, "Target content fingerprint");
  if (
    result.targetContent.kind !== "content" ||
    result.targetContent.description.trim().length === 0
  ) {
    invalid("Target content fingerprint must be labeled as deterministic content evidence.");
  }
  assertUniqueIds(result.operations, "Operation");
  assertUniqueIds(result.preconditions, "Precondition");
  assertUniqueIds(result.risks, "Risk");
  assertUniqueIds(result.verification, "Verification step");
  assertUniqueIds(result.manualItems ?? [], "Manual item");

  const conflicts = new Set<string>();
  const touchedPaths = new Set<string>();
  const exclusivePaths = new Set<string>();
  const operationIds = new Set(result.operations.map((entry) => entry.id));
  for (const operation of result.operations) {
    assertOperation(operation);
    const operationPaths = operationTouchedPaths(operation);
    if (
      operationPaths.some((path) => exclusivePaths.has(path)) ||
      (operationUsesExclusivePath(operation) &&
        operationPaths.some((path) => touchedPaths.has(path)))
    ) {
      invalid("Plan contains operations with ambiguous path ownership.", {
        operationId: operation.id,
      });
    }
    for (const path of operationPaths) {
      touchedPaths.add(path);
      if (operationUsesExclusivePath(operation)) exclusivePaths.add(path);
    }
    for (const key of operationConflictKeys(operation)) {
      if (conflicts.has(key)) invalid("Plan contains duplicate or ambiguous operations.", { key });
      conflicts.add(key);
    }
    assertOperationPreconditions(operation, result.preconditions);
  }
  for (const precondition of result.preconditions) assertPrecondition(precondition);
  for (const risk of result.risks) {
    if (risk.title.trim().length === 0 || risk.description.trim().length === 0)
      invalid(`Risk ${risk.id} must be descriptive.`);
    for (const operationId of risk.operationIds ?? []) {
      if (!operationIds.has(operationId))
        invalid(`Risk ${risk.id} references unknown operation ${operationId}.`);
    }
  }
  for (const step of result.verification) {
    if (step.description.trim().length === 0)
      invalid(`Verification step ${step.id} must be descriptive.`);
    if (step.kind === "quality-check")
      assertId(step.capabilityId, `Verification step ${step.id} capability`);
    if (step.kind === "command" && step.command.length === 0)
      invalid(`Verification step ${step.id} command is empty.`);
  }
  if (
    result.applicable &&
    (result.risks.some((risk) => risk.level === "blocking") ||
      (result.manualItems?.length ?? 0) > 0)
  ) {
    invalid("An applicable plan cannot contain blocking risks or unresolved manual items.");
  }
  normalizeJson(result);
}

function planRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function planString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    invalid(`${label} must be a non-empty string.`);
  return value;
}

function planArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return planString(value, label);
}

function assertOperationShape(value: unknown): QualityChangeOperation {
  const operation = planRecord(value, "Plan operation");
  const id = planString(operation.id, "Plan operation id");
  const kind = planString(operation.kind, `Operation ${id} kind`);
  if (
    ![
      "write-json",
      "replace-text",
      "create-file",
      "move-path",
      "rename-path",
      "delete-path",
    ].includes(kind)
  ) {
    invalid(`Operation ${id} has an unsupported kind.`, { kind });
  }
  if (kind === "write-json") {
    planString(operation.path, `Operation ${id} path`);
    planString(operation.pointer, `Operation ${id} pointer`);
    if (!("before" in operation) || !("after" in operation))
      invalid(`Operation ${id} requires before and after values.`);
    planString(operation.fileFingerprint, `Operation ${id} fileFingerprint`);
  } else if (kind === "replace-text") {
    planString(operation.path, `Operation ${id} path`);
    planString(operation.before, `Operation ${id} before`);
    if (typeof operation.after !== "string") invalid(`Operation ${id} after must be a string.`);
    if (typeof operation.expectedOccurrences !== "number")
      invalid(`Operation ${id} expectedOccurrences must be a number.`);
    planString(operation.fileFingerprint, `Operation ${id} fileFingerprint`);
  } else if (kind === "create-file") {
    planString(operation.path, `Operation ${id} path`);
    if (typeof operation.content !== "string" || operation.targetMustBeAbsent !== true) {
      invalid(`Operation ${id} requires string content and targetMustBeAbsent.`);
    }
  } else if (kind === "move-path" || kind === "rename-path") {
    planString(operation.from, `Operation ${id} from`);
    planString(operation.to, `Operation ${id} to`);
    planString(operation.sourceFingerprint, `Operation ${id} sourceFingerprint`);
    if (operation.targetMustBeAbsent !== true)
      invalid(`Operation ${id} must require an absent target.`);
  } else {
    planString(operation.path, `Operation ${id} path`);
    planString(operation.beforeFingerprint, `Operation ${id} beforeFingerprint`);
  }
  return operation as unknown as QualityChangeOperation;
}

function assertPreconditionShape(value: unknown): QualityPrecondition {
  const precondition = planRecord(value, "Plan precondition");
  const id = planString(precondition.id, "Plan precondition id");
  const kind = planString(precondition.kind, `Precondition ${id} kind`);
  planString(precondition.path, `Precondition ${id} path`);
  if (kind === "file-fingerprint") {
    planString(precondition.expected, `Precondition ${id} expected`);
  } else if (kind === "json-value") {
    planString(precondition.pointer, `Precondition ${id} pointer`);
    if (!("expected" in precondition)) invalid(`Precondition ${id} requires an expected value.`);
  } else if (kind !== "path-absent") {
    invalid(`Precondition ${id} has an unsupported kind.`, { kind });
  }
  return precondition as unknown as QualityPrecondition;
}

function assertRiskShape(value: unknown): QualityRisk {
  const risk = planRecord(value, "Plan risk");
  planString(risk.id, "Plan risk id");
  const level = planString(risk.level, "Plan risk level");
  if (!["low", "medium", "high", "blocking"].includes(level))
    invalid("Plan risk level is unsupported.", { level });
  planString(risk.title, "Plan risk title");
  planString(risk.description, "Plan risk description");
  if (risk.operationIds !== undefined) {
    for (const operationId of planArray(risk.operationIds, "Plan risk operationIds")) {
      planString(operationId, "Plan risk operation id");
    }
  }
  return risk as unknown as QualityRisk;
}

function assertVerificationShape(value: unknown): QualityVerificationStep {
  const step = planRecord(value, "Verification step");
  const id = planString(step.id, "Verification step id");
  const kind = planString(step.kind, `Verification step ${id} kind`);
  planString(step.description, `Verification step ${id} description`);
  if (kind === "quality-check") {
    planString(step.capabilityId, `Verification step ${id} capabilityId`);
  } else if (kind === "command") {
    for (const commandPart of planArray(step.command, `Verification step ${id} command`)) {
      planString(commandPart, `Verification step ${id} command part`);
    }
  } else if (kind !== "manual") {
    invalid(`Verification step ${id} has an unsupported kind.`, { kind });
  }
  return step as unknown as QualityVerificationStep;
}

function assertManualItemShape(value: unknown): QualityPlanManualItem {
  const item = planRecord(value, "Plan manual item");
  planString(item.id, "Plan manual item id");
  planString(item.title, "Plan manual item title");
  planString(item.description, "Plan manual item description");
  if (item.diagnosticFingerprints !== undefined) {
    for (const fingerprint of planArray(
      item.diagnosticFingerprints,
      "Manual item diagnosticFingerprints",
    )) {
      assertFingerprint(
        planString(fingerprint, "Manual item diagnostic fingerprint"),
        "Manual item diagnostic fingerprint",
      );
    }
  }
  return item as unknown as QualityPlanManualItem;
}

export function assertQualityChangePlan(value: unknown): asserts value is QualityChangePlan {
  const plan = planRecord(value, "Quality change plan");
  if (plan.schemaVersion !== QUALITY_CHANGE_PLAN_SCHEMA_VERSION) {
    invalid("Quality change plan schemaVersion is not supported.", { actual: plan.schemaVersion });
  }
  const planId = planString(plan.planId, "Plan id");
  const planFingerprint = planString(plan.planFingerprint, "Plan fingerprint");
  assertFingerprint(planFingerprint, "Plan fingerprint");
  const producer = planRecord(plan.producer, "Plan producer");
  planString(producer.pluginId, "Plan producer pluginId");
  optionalString(producer.packageName, "Plan producer packageName");
  const suite = planRecord(plan.suite, "Plan suite");
  planString(suite.id, "Plan suite id");
  assertFingerprint(
    planString(suite.manifestFingerprint, "Plan suite manifestFingerprint"),
    "Plan suite manifestFingerprint",
  );
  planString(plan.capabilityId, "Plan capabilityId");
  if (plan.provider !== undefined) {
    const provider = planRecord(plan.provider, "Plan provider");
    planString(provider.id, "Plan provider id");
    planString(provider.version, "Plan provider version");
  }
  const target = planRecord(plan.target, "Plan target");
  planString(target.kind, "Plan target kind");
  planString(target.id, "Plan target id");
  optionalString(target.root, "Plan target root");
  optionalString(target.snapshot, "Plan target snapshot");
  const targetContent = planRecord(plan.targetContent, "Plan targetContent");
  if (targetContent.kind !== "content") invalid("Plan targetContent kind must be content.");
  assertFingerprint(
    planString(targetContent.fingerprint, "Plan target content fingerprint"),
    "Plan target content fingerprint",
  );
  planString(targetContent.description, "Plan target content description");
  assertFingerprint(
    planString(plan.inputFingerprint, "Plan inputFingerprint"),
    "Plan inputFingerprint",
  );
  assertFingerprint(
    planString(plan.configFingerprint, "Plan configFingerprint"),
    "Plan configFingerprint",
  );
  for (const fingerprint of planArray(plan.diagnostics, "Plan diagnostics")) {
    assertFingerprint(
      planString(fingerprint, "Plan diagnostic fingerprint"),
      "Plan diagnostic fingerprint",
    );
  }
  const operations = planArray(plan.operations, "Plan operations").map(assertOperationShape);
  const preconditions = planArray(plan.preconditions, "Plan preconditions").map(
    assertPreconditionShape,
  );
  const risks = planArray(plan.risks, "Plan risks").map(assertRiskShape);
  const verification = planArray(plan.verification, "Plan verification").map(
    assertVerificationShape,
  );
  const manualItems = planArray(plan.manualItems, "Plan manualItems").map(assertManualItemShape);
  if (typeof plan.applicable !== "boolean") invalid("Plan applicable must be a boolean.");
  assertQualityPlanHandlerResult({
    targetContent: targetContent as unknown as QualityChangePlan["targetContent"],
    operations,
    preconditions,
    risks,
    verification,
    manualItems,
    applicable: plan.applicable,
  });
  const { planId: ignoredPlanId, planFingerprint: ignoredFingerprint, ...semanticPlan } = plan;
  void ignoredPlanId;
  void ignoredFingerprint;
  const expectedFingerprint = fingerprintJson(semanticPlan, "rq.change-plan.v0");
  if (
    planFingerprint !== expectedFingerprint ||
    planId !== `rq-plan-${expectedFingerprint.slice(0, 20)}`
  ) {
    invalid("Quality change plan fingerprint or id does not match its semantic content.", {
      actualFingerprint: planFingerprint,
      expectedFingerprint,
      planId,
    });
  }
}

export function parseQualityChangePlan(value: unknown): QualityChangePlan {
  const normalized = normalizeJson(value);
  assertQualityChangePlan(normalized);
  return normalized as unknown as QualityChangePlan;
}

export async function runQualityPlan(
  suite: QualitySuite,
  request: QualityPlanRequest,
): Promise<QualityPlanResult> {
  const capability = getCapability(suite, request.capabilityId);
  if (!capability.operations.includes("plan")) {
    throw new QualityError(
      "RQ_PLAN_NOT_SUPPORTED",
      `Capability ${capability.id} does not support plan.`,
      {
        capabilityId: capability.id,
      },
    );
  }
  const handler = suite.plans[capability.id];
  if (!handler) {
    throw new QualityError(
      "RQ_PLAN_HANDLER_NOT_FOUND",
      `Capability ${capability.id} has no in-process plan handler.`,
      {
        capabilityId: capability.id,
      },
    );
  }
  const provider = resolveQualityProvider(suite, capability.id, request.providerId);
  assertPlanProvider(provider, capability.id);
  const requiredEffects = requiredPlanEffects(capability, provider).map((entry) => entry.kind);
  assertEffectsGranted(requiredEffects, request.grantedEffects ?? []);

  const input = normalizeJson(request.input ?? null);
  const config = normalizeJson(request.config ?? null);
  const target = normalizeJson(request.target) as unknown as QualityPlanRequest["target"];
  const producer = normalizeJson(request.producer) as unknown as QualityPlanRequest["producer"];
  if (producer.pluginId.trim().length === 0) invalid("Plan producer pluginId must not be empty.");

  const checkResult = await runQualityCheck(suite, {
    capabilityId: capability.id,
    target,
    ...(provider ? { providerId: provider.id } : {}),
    input,
    config,
    grantedEffects: request.grantedEffects,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  const returned = normalizePlanHandlerResult(
    await handler({
      suite: suite.manifest,
      capability,
      ...(provider ? { provider } : {}),
      target,
      input,
      config,
      checkResult,
      ...(request.signal ? { signal: request.signal } : {}),
    }),
  );
  assertQualityPlanHandlerResult(returned);

  const operations = normalizeQualityChangeOperations(returned.operations);
  const preconditions = Object.freeze(
    [...returned.preconditions].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const risks = Object.freeze(
    [...returned.risks].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const verification = Object.freeze(
    [...returned.verification].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const manualItems = Object.freeze(
    [...(returned.manualItems ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
  );
  const semanticPlan = {
    schemaVersion: QUALITY_CHANGE_PLAN_SCHEMA_VERSION,
    producer,
    suite: { id: suite.manifest.id, manifestFingerprint: suite.manifestFingerprint },
    capabilityId: capability.id,
    ...(provider ? { provider: { id: provider.id, version: provider.version } } : {}),
    target,
    targetContent: returned.targetContent,
    inputFingerprint: fingerprintJson(input, "rq.plan-input.v0"),
    configFingerprint: fingerprintJson(config, "rq.plan-config.v0"),
    diagnostics: Object.freeze(checkResult.diagnostics.map((entry) => entry.fingerprint).sort()),
    operations,
    preconditions,
    risks,
    verification,
    manualItems,
    applicable: returned.applicable,
  };
  const planFingerprint = fingerprintJson(semanticPlan, "rq.change-plan.v0");
  const plan: QualityChangePlan = Object.freeze({
    ...semanticPlan,
    planId: `rq-plan-${planFingerprint.slice(0, 20)}`,
    planFingerprint,
  });
  const metadata = returned.metadata === undefined ? undefined : normalizeJson(returned.metadata);
  const resultWithoutFingerprint = {
    schemaVersion: QUALITY_PLAN_RESULT_SCHEMA_VERSION,
    plan,
    diagnostics: checkResult.diagnostics,
    checkResultFingerprint: checkResult.resultFingerprint,
    ...(metadata === undefined ? {} : { metadata }),
  };
  const result: QualityPlanResult = Object.freeze({
    ...resultWithoutFingerprint,
    resultFingerprint: fingerprintJson(resultWithoutFingerprint, "rq.plan-result.v0"),
  });
  normalizeJson(result);
  return result;
}
