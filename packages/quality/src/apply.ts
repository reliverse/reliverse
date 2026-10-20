import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { requiredApplyEffects } from "./contract";
import { QualityError } from "./error";
import { fingerprintJson, normalizeJson, stableJsonStringify } from "./json";
import {
  QUALITY_APPLY_RECEIPT_SCHEMA_VERSION,
  type QualityApplyOperationReceipt,
  type QualityApplyPreflightResult,
  type QualityApplyReceipt,
  type QualityApplyRequest,
  type QualityChangeOperation,
  type QualityEffectKind,
  type QualityFailureEvidence,
  type QualityPrecondition,
  type QualitySuite,
} from "./model";
import { parseQualityChangePlan } from "./plan";
import { resolveQualityProvider } from "./runtime";

const FILE_CONTENT_FINGERPRINT_NAMESPACE = "rq.file-content.v0";
const PATH_TREE_FINGERPRINT_NAMESPACE = "rq.path-tree.v0";
const TARGET_CONTENT_FINGERPRINT_NAMESPACE = "rq.apply-target-content.v0";

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function asFailure(error: unknown, fallbackCode: string): QualityFailureEvidence {
  if (error instanceof QualityError) {
    return {
      code: error.code,
      message: error.message,
      ...(Object.keys(error.details).length === 0 ? {} : { details: normalizeJson(error.details) }),
    };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function fail(
  code: ConstructorParameters<typeof QualityError>[0],
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new QualityError(code, message, details);
}

function operationPaths(operation: QualityChangeOperation): readonly string[] {
  return "path" in operation ? [operation.path] : [operation.from, operation.to];
}

function requiredOperationEffects(
  operations: readonly QualityChangeOperation[],
): readonly QualityEffectKind[] {
  const effects = new Set<QualityEffectKind>(["filesystem.read"]);
  for (const operation of operations) {
    switch (operation.kind) {
      case "write-json":
      case "replace-text":
      case "create-file":
        effects.add("filesystem.write");
        break;
      case "move-path":
      case "rename-path":
        effects.add("filesystem.rename");
        break;
      case "delete-path":
        effects.add("filesystem.delete");
        break;
    }
  }
  return Object.freeze([...effects].sort());
}

function assertEffectsGranted(
  required: readonly QualityEffectKind[],
  granted: readonly QualityEffectKind[],
): void {
  const grantSet = new Set(granted);
  for (const effect of required) {
    if (!grantSet.has(effect)) {
      fail("RQ_EFFECT_NOT_GRANTED", `Quality apply requires the undeclared grant ${effect}.`, {
        effect,
      });
    }
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function assertRoot(root: string): Promise<string> {
  const rootPath = path.resolve(root);
  const rootStat = await lstat(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail(
      "RQ_PLAN_PATH_UNSAFE",
      "Quality apply target root must be a real directory, not a symlink.",
      { root: rootPath },
    );
  }
  return realpath(rootPath);
}

async function resolveSafePath(
  root: string,
  realRoot: string,
  relativePath: string,
): Promise<string> {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!isWithinRoot(root, candidate)) {
    fail("RQ_PLAN_PATH_UNSAFE", "Quality plan path escapes the authorized target root.", {
      path: relativePath,
      root,
    });
  }

  let current = root;
  let lastExisting = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        fail("RQ_PLAN_PATH_UNSAFE", "Quality plan path traverses a symbolic link.", {
          path: relativePath,
          symlink: current,
        });
      }
      lastExisting = current;
    } catch (error) {
      if (isMissingPath(error)) break;
      throw error;
    }
  }

  const existingRealPath = await realpath(lastExisting);
  if (!isWithinRoot(realRoot, existingRealPath)) {
    fail("RQ_PLAN_PATH_UNSAFE", "Quality plan path resolves outside the authorized target root.", {
      path: relativePath,
      resolved: existingRealPath,
      root: realRoot,
    });
  }
  return candidate;
}

async function fingerprintDirectory(directory: string): Promise<string> {
  const entries: Array<{
    readonly kind: "directory" | "file";
    readonly path: string;
    readonly fingerprint?: string;
  }> = [];
  const visit = async (current: string, relative: string): Promise<void> => {
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const childRelative = relative.length === 0 ? child.name : `${relative}/${child.name}`;
      const childStat = await lstat(absolute);
      if (childStat.isSymbolicLink()) {
        fail("RQ_PLAN_PATH_UNSAFE", "Quality path fingerprint refuses symbolic links.", {
          path: absolute,
        });
      }
      if (childStat.isDirectory()) {
        entries.push({ kind: "directory", path: childRelative });
        await visit(absolute, childRelative);
      } else if (childStat.isFile()) {
        entries.push({
          kind: "file",
          path: childRelative,
          fingerprint: fingerprintJson(
            await readFile(absolute, "utf8"),
            FILE_CONTENT_FINGERPRINT_NAMESPACE,
          ),
        });
      } else {
        fail(
          "RQ_PLAN_PATH_UNSAFE",
          "Quality path fingerprint supports only files and directories.",
          { path: absolute },
        );
      }
    }
  };
  await visit(directory, "");
  return fingerprintJson(entries, PATH_TREE_FINGERPRINT_NAMESPACE);
}

export async function fingerprintQualityPath(absolutePath: string): Promise<string> {
  const pathStat = await lstat(absolutePath);
  if (pathStat.isSymbolicLink()) {
    fail("RQ_PLAN_PATH_UNSAFE", "Quality path fingerprint refuses symbolic links.", {
      path: absolutePath,
    });
  }
  if (pathStat.isDirectory()) return fingerprintDirectory(absolutePath);
  if (!pathStat.isFile()) {
    fail("RQ_PLAN_PATH_UNSAFE", "Quality path fingerprint supports only files and directories.", {
      path: absolutePath,
    });
  }
  return fingerprintJson(await readFile(absolutePath, "utf8"), FILE_CONTENT_FINGERPRINT_NAMESPACE);
}

async function pathEvidence(root: string, realRoot: string, relativePath: string) {
  const absolutePath = await resolveSafePath(root, realRoot, relativePath);
  try {
    return {
      path: relativePath,
      state: "present" as const,
      fingerprint: await fingerprintQualityPath(absolutePath),
    };
  } catch (error) {
    if (isMissingPath(error)) return { path: relativePath, state: "absent" as const };
    throw error;
  }
}

export async function fingerprintQualityPlanPaths(
  root: string,
  operations: readonly QualityChangeOperation[],
): Promise<string> {
  const realRoot = await assertRoot(root);
  const paths = [...new Set(operations.flatMap(operationPaths))].sort();
  const evidence = [];
  for (const relativePath of paths)
    evidence.push(await pathEvidence(path.resolve(root), realRoot, relativePath));
  return fingerprintJson(evidence, TARGET_CONTENT_FINGERPRINT_NAMESPACE);
}

function decodeJsonPointer(pointer: string): readonly string[] {
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readJsonPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const segment of decodeJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === "object" && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function writeJsonPointer(value: unknown, pointer: string, replacement: unknown): void {
  const segments = [...decodeJsonPointer(pointer)];
  const key = segments.pop();
  if (key === undefined)
    fail("RQ_APPLY_FAILED", "Root JSON pointer replacement is not supported.", { pointer });
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        fail("RQ_APPLY_FAILED", "JSON pointer array index is invalid.", { pointer, segment });
      }
      current = current[index];
    } else if (
      typeof current === "object" &&
      current !== null &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      fail("RQ_APPLY_FAILED", "JSON pointer parent does not exist.", { pointer, segment });
    }
  }
  if (Array.isArray(current)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= current.length) {
      fail("RQ_APPLY_FAILED", "JSON pointer array index is invalid.", { pointer, segment: key });
    }
    current[index] = replacement;
    return;
  }
  if (
    typeof current !== "object" ||
    current === null ||
    !Object.prototype.hasOwnProperty.call(current, key)
  ) {
    fail("RQ_APPLY_FAILED", "JSON pointer target does not exist.", { pointer });
  }
  (current as Record<string, unknown>)[key] = replacement;
}

function countOccurrences(source: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(search, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + search.length;
  }
}

async function assertPrecondition(
  root: string,
  realRoot: string,
  precondition: QualityPrecondition,
): Promise<void> {
  const absolutePath = await resolveSafePath(root, realRoot, precondition.path);
  if (precondition.kind === "path-absent") {
    try {
      await lstat(absolutePath);
      fail("RQ_PLAN_STALE", `Expected ${precondition.path} to be absent.`, {
        preconditionId: precondition.id,
      });
    } catch (error) {
      if (isMissingPath(error)) return;
      throw error;
    }
  }
  let actualFingerprint: string;
  try {
    actualFingerprint = await fingerprintQualityPath(absolutePath);
  } catch (error) {
    if (isMissingPath(error)) {
      fail("RQ_PLAN_STALE", `Expected ${precondition.path} to exist.`, {
        preconditionId: precondition.id,
      });
    }
    throw error;
  }
  if (precondition.kind === "file-fingerprint") {
    if (actualFingerprint !== precondition.expected) {
      fail("RQ_PLAN_STALE", `Content changed since plan creation at ${precondition.path}.`, {
        actual: actualFingerprint,
        expected: precondition.expected,
        preconditionId: precondition.id,
      });
    }
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    fail("RQ_PLAN_STALE", `Expected readable JSON at ${precondition.path}.`, {
      preconditionId: precondition.id,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const actual = readJsonPointer(parsed, precondition.pointer);
  if (stableJsonStringify(actual) !== stableJsonStringify(precondition.expected)) {
    fail(
      "RQ_PLAN_STALE",
      `JSON value changed since plan creation at ${precondition.path}${precondition.pointer}.`,
      {
        preconditionId: precondition.id,
      },
    );
  }
}

export async function preflightQualityPlan(
  plan: QualityApplyRequest["plan"],
  targetRoot: string,
): Promise<QualityApplyPreflightResult> {
  const root = path.resolve(targetRoot);
  const realRoot = await assertRoot(root);
  for (const operation of plan.operations) {
    for (const relativePath of operationPaths(operation))
      await resolveSafePath(root, realRoot, relativePath);
    if (operation.kind === "replace-text") {
      const source = await readFile(path.resolve(root, ...operation.path.split("/")), "utf8");
      const actualOccurrences = countOccurrences(source, operation.before);
      if (actualOccurrences !== operation.expectedOccurrences) {
        fail(
          "RQ_PLAN_STALE",
          `Text occurrence count changed since plan creation at ${operation.path}.`,
          {
            actualOccurrences,
            expectedOccurrences: operation.expectedOccurrences,
            operationId: operation.id,
          },
        );
      }
    }
  }
  const checkedPreconditions: string[] = [];
  for (const precondition of plan.preconditions) {
    await assertPrecondition(root, realRoot, precondition);
    checkedPreconditions.push(precondition.id);
  }
  return Object.freeze({
    status: "passed",
    checkedPreconditions: Object.freeze(checkedPreconditions),
  });
}

async function atomicWrite(
  targetPath: string,
  content: string,
  operationId: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(targetPath), `.reliverse-rq-${operationId}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(targetPath)).mode;
  } catch (error) {
    if (!isMissingPath(error)) throw error;
  }
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      ...(mode === undefined ? {} : { mode }),
    });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function executeOperation(root: string, operation: QualityChangeOperation): Promise<void> {
  if ("from" in operation) {
    const from = path.resolve(root, ...operation.from.split("/"));
    const to = path.resolve(root, ...operation.to.split("/"));
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    return;
  }
  const targetPath = path.resolve(root, ...operation.path.split("/"));
  if (operation.kind === "create-file") {
    await atomicWrite(targetPath, operation.content, operation.id);
    return;
  }
  if (operation.kind === "delete-path") {
    await rm(targetPath, { recursive: true });
    return;
  }
  const source = await readFile(targetPath, "utf8");
  if (operation.kind === "replace-text") {
    await atomicWrite(
      targetPath,
      source.replaceAll(operation.before, operation.after),
      operation.id,
    );
    return;
  }
  const parsed = JSON.parse(source) as unknown;
  writeJsonPointer(parsed, operation.pointer, operation.after);
  const indent = /^([ \t]+)"/m.exec(source)?.[1] ?? "  ";
  const trailingNewline = source.endsWith("\n") ? "\n" : "";
  await atomicWrite(
    targetPath,
    `${JSON.stringify(parsed, null, indent)}${trailingNewline}`,
    operation.id,
  );
}

function assertApplyCompatibility(
  suite: QualitySuite,
  request: QualityApplyRequest,
): readonly QualityEffectKind[] {
  const plan = request.plan;
  if (
    plan.suite.id !== suite.manifest.id ||
    plan.suite.manifestFingerprint !== suite.manifestFingerprint
  ) {
    fail(
      "RQ_PLAN_INCOMPATIBLE",
      "Quality plan suite identity or manifest fingerprint is not installed.",
      {
        planSuiteId: plan.suite.id,
        suiteId: suite.manifest.id,
      },
    );
  }
  const capability = suite.manifest.capabilities.find((entry) => entry.id === plan.capabilityId);
  if (!capability || !capability.operations.includes("apply")) {
    fail("RQ_APPLY_NOT_SUPPORTED", `Capability ${plan.capabilityId} does not support apply.`);
  }
  const provider = resolveQualityProvider(suite, capability.id, plan.provider?.id);
  if (plan.provider) {
    if (
      !provider ||
      provider.id !== plan.provider.id ||
      provider.version !== plan.provider.version
    ) {
      fail("RQ_PLAN_INCOMPATIBLE", "Quality plan provider identity or version is not installed.", {
        providerId: plan.provider.id,
        providerVersion: plan.provider.version,
      });
    }
  }
  if (provider && !provider.operations.includes("apply")) {
    fail("RQ_APPLY_NOT_SUPPORTED", `Provider ${provider.id} does not support apply.`);
  }
  const operationEffects = requiredOperationEffects(plan.operations);
  const declaredEffects = requiredApplyEffects(capability, provider).map((entry) => entry.kind);
  const declaredSet = new Set(declaredEffects);
  for (const effect of operationEffects) {
    if (!declaredSet.has(effect)) {
      fail(
        "RQ_PLAN_INCOMPATIBLE",
        `Capability ${capability.id} does not declare ${effect} for apply.`,
        { effect },
      );
    }
  }
  const requiredEffects = Object.freeze(
    [...new Set([...declaredEffects, ...operationEffects])].sort(),
  );
  assertEffectsGranted(requiredEffects, request.grantedEffects ?? []);
  return requiredEffects;
}

function assertApplyRequest(request: QualityApplyRequest): void {
  if (!request.authorization || request.authorization.source.trim().length === 0) {
    fail("RQ_APPLY_NOT_AUTHORIZED", "Quality apply requires explicit authorization.");
  }
  if (request.runId.trim().length === 0 || request.createdAt.trim().length === 0) {
    fail("RQ_APPLY_FAILED", "Quality apply requires runId and createdAt receipt metadata.");
  }
  if (
    !request.plan.applicable ||
    request.plan.manualItems.length > 0 ||
    request.plan.risks.some((risk) => risk.level === "blocking")
  ) {
    fail(
      "RQ_PLAN_BLOCKED",
      "Quality plan is not applicable because blocking risks or manual items remain.",
      {
        applicable: request.plan.applicable,
        manualItems: request.plan.manualItems.length,
      },
    );
  }
  const targetRoot = path.resolve(request.targetRoot);
  if (!request.plan.target.root || path.resolve(request.plan.target.root) !== targetRoot) {
    fail(
      "RQ_PLAN_TARGET_MISMATCH",
      "Quality plan target root does not match the authorized target root.",
      {
        authorizedRoot: targetRoot,
        planRoot: request.plan.target.root,
      },
    );
  }
  if (request.targetId !== undefined && request.plan.target.id !== request.targetId) {
    fail(
      "RQ_PLAN_TARGET_MISMATCH",
      "Quality plan target identity does not match the authorized target.",
      {
        authorizedTargetId: request.targetId,
        planTargetId: request.plan.target.id,
      },
    );
  }
}

function freezeReceipt(
  receipt: Omit<QualityApplyReceipt, "receiptFingerprint">,
): QualityApplyReceipt {
  const normalized = normalizeJson(receipt);
  return normalizeJson({
    ...(normalized as Readonly<Record<string, unknown>>),
    receiptFingerprint: fingerprintJson(normalized, "rq.apply-receipt.v0"),
  }) as unknown as QualityApplyReceipt;
}

export async function runQualityApply(
  suite: QualitySuite,
  request: QualityApplyRequest,
): Promise<QualityApplyReceipt> {
  const plan = parseQualityChangePlan(request.plan);
  const normalizedRequest: QualityApplyRequest = { ...request, plan };
  assertApplyRequest(normalizedRequest);
  const requiredEffects = assertApplyCompatibility(suite, normalizedRequest);
  const targetRoot = path.resolve(normalizedRequest.targetRoot);
  const notRun = (): readonly QualityApplyOperationReceipt[] =>
    Object.freeze(
      plan.operations.map((operation) => ({
        operationId: operation.id,
        kind: operation.kind,
        status: "not-run" as const,
      })),
    );

  let beforeContentFingerprint: string | undefined;
  let preflight: QualityApplyPreflightResult;
  try {
    beforeContentFingerprint = await fingerprintQualityPlanPaths(targetRoot, plan.operations);
    preflight = await preflightQualityPlan(plan, targetRoot);
  } catch (error) {
    const failure = asFailure(error, "RQ_PLAN_STALE");
    return freezeReceipt({
      schemaVersion: QUALITY_APPLY_RECEIPT_SCHEMA_VERSION,
      runId: normalizedRequest.runId,
      createdAt: normalizedRequest.createdAt,
      plan: { id: plan.planId, fingerprint: plan.planFingerprint },
      target: plan.target,
      authorization: normalizedRequest.authorization!,
      preflight: { status: "failed", checkedPreconditions: [], failure },
      operations: notRun(),
      ...(beforeContentFingerprint === undefined ? {} : { beforeContentFingerprint }),
      observedEffects: Object.freeze(["filesystem.read"]),
      status: "failed",
      failure,
    });
  }

  const operationReceipts: QualityApplyOperationReceipt[] = [];
  let failure: QualityFailureEvidence | undefined;
  for (const operation of plan.operations) {
    if (failure) {
      operationReceipts.push({
        operationId: operation.id,
        kind: operation.kind,
        status: "not-run",
      });
      continue;
    }
    try {
      const primaryPath = "path" in operation ? operation.path : operation.from;
      const absoluteBefore = path.resolve(targetRoot, ...primaryPath.split("/"));
      const beforeFingerprint = await fingerprintQualityPath(absoluteBefore).catch((error) => {
        if (isMissingPath(error)) return undefined;
        throw error;
      });
      await executeOperation(targetRoot, operation);
      const afterPath =
        "from" in operation
          ? operation.to
          : operation.kind === "delete-path"
            ? undefined
            : operation.path;
      const afterFingerprint =
        afterPath === undefined
          ? undefined
          : await fingerprintQualityPath(path.resolve(targetRoot, ...afterPath.split("/")));
      operationReceipts.push({
        operationId: operation.id,
        kind: operation.kind,
        status: "executed",
        ...(beforeFingerprint === undefined ? {} : { beforeFingerprint }),
        ...(afterFingerprint === undefined ? {} : { afterFingerprint }),
      });
    } catch (error) {
      failure = asFailure(error, "RQ_APPLY_FAILED");
      operationReceipts.push({
        operationId: operation.id,
        kind: operation.kind,
        status: "not-run",
        failure,
      });
    }
  }

  const afterContentFingerprint = await fingerprintQualityPlanPaths(targetRoot, plan.operations);
  return freezeReceipt({
    schemaVersion: QUALITY_APPLY_RECEIPT_SCHEMA_VERSION,
    runId: normalizedRequest.runId,
    createdAt: normalizedRequest.createdAt,
    plan: { id: plan.planId, fingerprint: plan.planFingerprint },
    target: plan.target,
    authorization: normalizedRequest.authorization!,
    preflight,
    operations: Object.freeze(operationReceipts),
    ...(beforeContentFingerprint === undefined ? {} : { beforeContentFingerprint }),
    afterContentFingerprint,
    observedEffects: requiredEffects,
    status: failure ? "failed" : "succeeded",
    ...(failure ? { failure } : {}),
  });
}

export function parseQualityApplyReceipt(value: unknown): QualityApplyReceipt {
  const normalized = normalizeJson(value) as unknown as QualityApplyReceipt;
  if (
    normalized.schemaVersion !== QUALITY_APPLY_RECEIPT_SCHEMA_VERSION ||
    typeof normalized.receiptFingerprint !== "string" ||
    typeof normalized.runId !== "string" ||
    typeof normalized.createdAt !== "string" ||
    (normalized.status !== "failed" && normalized.status !== "succeeded") ||
    typeof normalized.plan?.id !== "string" ||
    typeof normalized.plan?.fingerprint !== "string" ||
    !Array.isArray(normalized.operations)
  ) {
    fail("RQ_APPLY_RECEIPT_INVALID", "Apply receipt schema is invalid.");
  }
  const { receiptFingerprint, ...semanticReceipt } = normalized;
  const expectedFingerprint = fingerprintJson(semanticReceipt, "rq.apply-receipt.v0");
  if (receiptFingerprint !== expectedFingerprint) {
    fail("RQ_APPLY_RECEIPT_INVALID", "Apply receipt fingerprint does not match its content.");
  }
  return normalized;
}
