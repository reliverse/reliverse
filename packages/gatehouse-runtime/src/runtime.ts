import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GATEHOUSE_APPROVAL_BUNDLE_SCHEMA_VERSION,
  GATEHOUSE_CONSUMPTION_RECEIPT_SCHEMA_VERSION,
  GATEHOUSE_DECISION_RECEIPT_SCHEMA_VERSION,
  GATEHOUSE_EXECUTION_LEASE_SCHEMA_VERSION,
  GATEHOUSE_EXECUTION_RECEIPT_SCHEMA_VERSION,
  GATEHOUSE_GATE_SCHEMA_VERSION,
  GATEHOUSE_REVOCATION_SCHEMA_VERSION,
  assertGatehouseActionIntent,
  assertGatehouseEndorsementSubmission,
  createDeterministicGatehouseId,
  createGatehouseId,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
  type GatehouseApprovalBundle,
  type GatehouseDecisionReceipt,
  type GatehouseEndorsementSubmission,
  type GatehouseExecutionLease,
  type GatehouseExecutionOutcome,
  type GatehouseExecutionReceipt,
  type GatehouseGate,
  type GatehouseGateInspection,
  type GatehouseGateStatus,
  type GatehouseLeaseConsumptionReceipt,
  type GatehousePrincipalRef,
  type GatehouseRevocation,
  type GatehouseVerifiedEndorsement,
} from "@reliverse/gatehouse-protocol";

import {
  fingerprintGatehouseIntentSemantics,
  readGatehouseBoundedPlan,
  type GatehouseBoundedPlanClaim,
} from "./bounded-plan";
import { GatehouseRuntimeError, gatehouseError } from "./errors";

export interface GatehouseEndorsementVerifier {
  readonly id: string;
  verify(input: {
    readonly endorsement: GatehouseEndorsementSubmission;
    readonly gate: GatehouseGate;
    readonly intent: GatehouseActionIntent;
  }): Promise<GatehouseVerifiedEndorsement> | GatehouseVerifiedEndorsement;
}

export interface CreateGatehouseRuntimeOptions {
  readonly home: string;
  readonly endorsementVerifier?: GatehouseEndorsementVerifier | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface GatehouseRuntimeHealth {
  readonly home: string;
  readonly exists: boolean;
  readonly gateCount: number;
  readonly activeLeaseCount: number;
  readonly expiredLeaseCount: number;
  readonly invalidGateCount: number;
}

export interface GatehouseSubmitEndorsementResult {
  readonly approvalBundle: GatehouseApprovalBundle;
  readonly decisionReceipt: GatehouseDecisionReceipt;
  readonly gate: GatehouseGate;
}

export interface GatehouseIssueLeaseInput {
  readonly gateId: string;
  readonly preconditionDigest: string;
  readonly expiresAt?: string | undefined;
}

export interface GatehouseConsumeLeaseInput {
  readonly attemptId: string;
  readonly capability: string;
  readonly executorClass: string;
  readonly intentDigest: string;
  readonly leaseId: string;
  readonly preconditionDigest: string;
  readonly scopeDigest: string;
  readonly targetDigest: string;
}

export interface GatehouseRecordExecutionInput {
  readonly attemptId: string;
  readonly consumptionId: string;
  readonly gateId: string;
  readonly leaseId: string;
  readonly outcome: GatehouseExecutionOutcome;
  readonly resultDigest?: string | undefined;
  readonly uncertainty?: string | undefined;
}

export interface GatehouseRuntime {
  readonly home: string;
  ensure(): Promise<void>;
  inspectHealth(): Promise<GatehouseRuntimeHealth>;
  submitIntent(intent: GatehouseActionIntent): Promise<GatehouseGateInspection>;
  listGates(options?: {
    readonly limit?: number | undefined;
    readonly afterGateId?: string | undefined;
    readonly statuses?: readonly GatehouseGateStatus[] | undefined;
    readonly actionKinds?: readonly string[] | undefined;
    readonly correlation?: { readonly runId?: string; readonly operationId?: string } | undefined;
  }): Promise<readonly GatehouseGateInspection[]>;
  inspectGate(gateId: string): Promise<GatehouseGateInspection | undefined>;
  submitEndorsement(
    endorsement: GatehouseEndorsementSubmission,
  ): Promise<GatehouseSubmitEndorsementResult>;
  issueLease(input: GatehouseIssueLeaseInput): Promise<GatehouseExecutionLease>;
  issueLeaseFromPlan(
    input: GatehouseIssueLeaseInput & { readonly planGateId: string },
  ): Promise<GatehouseExecutionLease>;
  inspectPlanClaims(planGateId: string): Promise<readonly GatehouseBoundedPlanClaim[]>;
  consumeLease(input: GatehouseConsumeLeaseInput): Promise<GatehouseLeaseConsumptionReceipt>;
  revoke(input: {
    readonly actor: GatehousePrincipalRef;
    readonly gateId: string;
    readonly reason: string;
    /** Optional exact-state CAS, evaluated under the existing writer lock. */
    readonly expectedInspectionDigest?: string;
  }): Promise<GatehouseRevocation>;
  recordExecution(input: GatehouseRecordExecutionInput): Promise<GatehouseExecutionReceipt>;
}

interface GatePaths {
  readonly approval: string;
  readonly consumption: string;
  readonly decisions: string;
  readonly endorsements: string;
  readonly execution: string;
  readonly gate: string;
  readonly intent: string;
  readonly lease: string;
  readonly lock: string;
  readonly revocations: string;
  readonly root: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function parseIso(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) gatehouseError("GATEHOUSE_TIME_INVALID", `${label} is invalid.`);
  return parsed;
}

function assertSha256(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    gatehouseError("GATEHOUSE_DIGEST_INVALID", `${label} must be a sha256 digest.`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) gatehouseError("GATEHOUSE_VALUE_REQUIRED", `${label} must be non-empty.`);
}

function getGatePaths(home: string, gateId: string): GatePaths {
  const root = path.join(home, "gates", gateId);
  return {
    approval: path.join(root, "approval.json"),
    consumption: path.join(root, "consumption.json"),
    decisions: path.join(root, "decisions"),
    endorsements: path.join(root, "endorsements"),
    execution: path.join(root, "execution.json"),
    gate: path.join(root, "gate.json"),
    intent: path.join(root, "intent.json"),
    lease: path.join(root, "lease.json"),
    lock: path.join(root, ".lock"),
    revocations: path.join(root, "revocations"),
    root,
  };
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function readJsonDirectory<T>(directory: string): Promise<readonly T[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const files = entries.filter((entry) => entry.endsWith(".json")).sort();
  const values = await Promise.all(files.map((entry) => readJson<T>(path.join(directory, entry))));
  const result: T[] = [];
  for (const value of values) {
    if (value !== undefined) result.push(value);
  }
  return result;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeJsonExclusive(filePath: string, value: unknown): Promise<boolean> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

async function withGateLock<T>(
  paths: GatePaths,
  now: Date,
  callback: () => Promise<T>,
): Promise<T> {
  await mkdir(paths.root, { recursive: true });
  const record = {
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    id: createGatehouseId("gatehouse_lock"),
    pid: process.pid,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(paths.lock);
      await writeJsonAtomic(path.join(paths.lock, "lock.json"), record);
      try {
        return await callback();
      } finally {
        const current = await readJson<typeof record>(path.join(paths.lock, "lock.json"));
        if (current?.id === record.id) await rm(paths.lock, { force: true, recursive: true });
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const current = await readJson<typeof record>(path.join(paths.lock, "lock.json"));
      if (
        !current ||
        typeof current.id !== "string" ||
        !current.id.trim() ||
        !Number.isFinite(Date.parse(current.acquiredAt)) ||
        !Number.isFinite(Date.parse(current.expiresAt)) ||
        Date.parse(current.acquiredAt) >= Date.parse(current.expiresAt) ||
        Date.parse(current.expiresAt) > now.getTime()
      ) {
        gatehouseError(
          "GATEHOUSE_GATE_BUSY",
          "Another bounded Gatehouse mutation owns this gate; an incomplete lock record is not proof of abandoned ownership.",
        );
      }
      let ownerAbsent = false;
      if (Number.isSafeInteger(current.pid) && current.pid > 0) {
        try {
          process.kill(current.pid, 0);
        } catch (ownerError) {
          ownerAbsent = errorCode(ownerError) === "ESRCH";
        }
      }
      if (!ownerAbsent)
        gatehouseError(
          "GATEHOUSE_GATE_BUSY",
          "An expired lock cannot be reclaimed while its process is alive or ownership is uncertain.",
        );
      // Reclaimers must serialize too: otherwise one could rename the fresh lock
      // acquired after another reclaimer removed the abandoned directory.
      const reclaim = `${paths.lock}.reclaim`;
      try {
        await mkdir(reclaim);
      } catch (reclaimError) {
        if (errorCode(reclaimError) !== "EEXIST") throw reclaimError;
        gatehouseError("GATEHOUSE_GATE_BUSY", "Another recovery owns the abandoned gate lock.");
      }
      try {
        const retained = await readJson<typeof record>(path.join(paths.lock, "lock.json"));
        if (
          retained?.id !== current.id ||
          retained?.pid !== current.pid ||
          retained?.expiresAt !== current.expiresAt
        )
          gatehouseError("GATEHOUSE_GATE_BUSY", "Gate lock ownership changed during recovery.");
        const stale = `${paths.lock}.stale-${crypto.randomUUID()}`;
        await rename(paths.lock, stale);
        await rm(stale, { force: true, recursive: true });
      } finally {
        await rm(reclaim, { force: true, recursive: true });
      }
    }
  }
  gatehouseError("GATEHOUSE_GATE_BUSY", "Gatehouse could not acquire the gate lock.");
}

function effectiveGateStatus(
  gate: GatehouseGate,
  lease: GatehouseExecutionLease | undefined,
  nowMs: number,
): GatehouseGateStatus {
  if (
    ["completed", "execution-failed", "outcome-unknown", "cancelled", "revoked"].includes(
      gate.status,
    )
  ) {
    return gate.status;
  }
  if (lease?.status === "revoked") return "revoked";
  if (lease?.status === "active" && parseIso(lease.expiresAt, "lease.expiresAt") <= nowMs) {
    return "lease-expired";
  }
  if (parseIso(gate.expiresAt, "gate.expiresAt") <= nowMs) return "expired";
  return gate.status;
}

function latestEndorsementsByPrincipal(
  endorsements: readonly GatehouseVerifiedEndorsement[],
): ReadonlyMap<string, GatehouseVerifiedEndorsement> {
  const result = new Map<string, GatehouseVerifiedEndorsement>();
  for (const endorsement of [...endorsements].sort((left, right) => {
    const issued = left.issuedAt.localeCompare(right.issuedAt);
    return issued === 0 ? left.id.localeCompare(right.id) : issued;
  })) {
    result.set(endorsement.principalId, endorsement);
  }
  return result;
}

function evaluateApprovalBundle(input: {
  readonly endorsements: readonly GatehouseVerifiedEndorsement[];
  readonly gate: GatehouseGate;
  readonly intent: GatehouseActionIntent;
  readonly now: Date;
}): GatehouseApprovalBundle {
  const latest = latestEndorsementsByPrincipal(input.endorsements);
  const accepted: string[] = [];
  const rejected: string[] = [];
  let status: GatehouseApprovalBundle["status"] = "pending";
  for (const principalId of input.gate.authority.principalIds) {
    const endorsement = latest.get(principalId);
    if (!endorsement) continue;
    if (endorsement.decision === "approve") accepted.push(endorsement.id);
    else rejected.push(endorsement.id);
  }
  if (
    input.gate.authority.principalIds.some(
      (principalId) => latest.get(principalId)?.decision === "deny",
    )
  ) {
    status = "denied";
  } else if (
    input.gate.authority.principalIds.some(
      (principalId) => latest.get(principalId)?.decision === "request-changes",
    )
  ) {
    status = "request-changes";
  } else if (
    input.gate.authority.principalIds.every(
      (principalId) => latest.get(principalId)?.decision === "approve",
    )
  ) {
    status = "quorum-satisfied";
  }
  const id = createDeterministicGatehouseId("approval", {
    gateId: input.gate.id,
    accepted,
    rejected,
    status,
  });
  return Object.freeze({
    schemaVersion: GATEHOUSE_APPROVAL_BUNDLE_SCHEMA_VERSION,
    id,
    gateId: input.gate.id,
    intentDigest: input.intent.digest,
    policyDigest: input.intent.policy.digest,
    authority: input.gate.authority,
    acceptedEndorsementIds: Object.freeze(accepted),
    rejectedEndorsementIds: Object.freeze(rejected),
    status,
    evaluatedAt: input.now.toISOString(),
    expiresAt: input.gate.expiresAt,
  });
}

function gateStatusFromApproval(
  approval: GatehouseApprovalBundle,
  endorsementCount: number,
): GatehouseGateStatus {
  if (approval.status === "quorum-satisfied") return "quorum-satisfied";
  if (approval.status === "denied") return "denied";
  if (approval.status === "request-changes") return "request-changes";
  return endorsementCount > 0 ? "partially-endorsed" : "pending";
}

function assertIntentAndGateMatch(intent: GatehouseActionIntent, gate: GatehouseGate): void {
  assertGatehouseActionIntent(intent);
  if (gate.intentId !== intent.id || gate.intentDigest !== intent.digest) {
    gatehouseError(
      "GATEHOUSE_INTENT_GATE_MISMATCH",
      `Gate ${gate.id} does not bind the persisted ActionIntent.`,
    );
  }
}

async function readInspection(
  paths: GatePaths,
  now: Date,
): Promise<GatehouseGateInspection | undefined> {
  const [intent, gate] = await Promise.all([
    readJson<GatehouseActionIntent>(paths.intent),
    readJson<GatehouseGate>(paths.gate),
  ]);
  if (!intent && !gate) return undefined;
  if (!intent || !gate) {
    gatehouseError(
      "GATEHOUSE_STORE_INCOMPLETE",
      `Gatehouse gate ${path.basename(paths.root)} is incomplete.`,
    );
  }
  assertIntentAndGateMatch(intent, gate);
  const [endorsements, decisions, approvalBundle, lease, consumption, execution, revocations] =
    await Promise.all([
      readJsonDirectory<GatehouseVerifiedEndorsement>(paths.endorsements),
      readJsonDirectory<GatehouseDecisionReceipt>(paths.decisions),
      readJson<GatehouseApprovalBundle>(paths.approval),
      readJson<GatehouseExecutionLease>(paths.lease),
      readJson<GatehouseLeaseConsumptionReceipt>(paths.consumption),
      readJson<GatehouseExecutionReceipt>(paths.execution),
      readJsonDirectory<GatehouseRevocation>(paths.revocations),
    ]);
  return Object.freeze({
    intent,
    gate,
    effectiveStatus: effectiveGateStatus(gate, lease, now.getTime()),
    endorsements: Object.freeze(endorsements),
    decisions: Object.freeze(decisions),
    ...(approvalBundle == null ? {} : { approvalBundle }),
    ...(lease == null ? {} : { lease }),
    ...(consumption == null ? {} : { consumption }),
    ...(execution == null ? {} : { execution }),
    revocations: Object.freeze(revocations),
  });
}

function assertGateMutable(inspection: GatehouseGateInspection): void {
  const blocked = new Set<GatehouseGateStatus>([
    "completed",
    "cancelled",
    "denied",
    "expired",
    "execution-failed",
    "lease-expired",
    "outcome-unknown",
    "revoked",
  ]);
  if (blocked.has(inspection.effectiveStatus)) {
    gatehouseError(
      "GATEHOUSE_GATE_TERMINAL",
      `Gate ${inspection.gate.id} is ${inspection.effectiveStatus}.`,
    );
  }
}

function assertEndorsementAuthority(
  intent: GatehouseActionIntent,
  endorsement: GatehouseVerifiedEndorsement,
): void {
  if (!intent.policy.authority.principalIds.includes(endorsement.principalId)) {
    gatehouseError(
      "GATEHOUSE_ENDORSEMENT_AUTHORITY_MISMATCH",
      `Principal ${endorsement.principalId} is not eligible for this gate.`,
    );
  }
  if (
    endorsement.principalId === intent.actor.id &&
    (intent.action.authorityImpact === "expand" || intent.action.authorityImpact === "replace")
  ) {
    gatehouseError(
      "GATEHOUSE_SELF_APPROVAL_FORBIDDEN",
      "An actor cannot approve its own expanded or replaced authority.",
    );
  }
}

export function createGatehouseRuntime(options: CreateGatehouseRuntimeOptions): GatehouseRuntime {
  const home = path.resolve(options.home);
  const now = options.now ?? (() => new Date());

  async function ensure(): Promise<void> {
    await mkdir(path.join(home, "gates"), { recursive: true, mode: 0o700 });
  }

  async function inspectGate(gateId: string): Promise<GatehouseGateInspection | undefined> {
    assertNonEmpty(gateId, "gateId");
    const inspection = await readInspection(getGatePaths(home, gateId), now());
    const planGateId = inspection?.lease?.planAuthorization?.planGateId;
    if (
      !inspection ||
      !planGateId ||
      inspection.consumption ||
      inspection.lease?.status !== "active"
    )
      return inspection;
    const parent = await readInspection(planPaths(planGateId), now());
    if (parent?.revocations.length || parent?.effectiveStatus === "revoked")
      return Object.freeze({ ...inspection, effectiveStatus: "revoked" as const });
    if (parent?.effectiveStatus === "denied" || parent?.effectiveStatus === "request-changes")
      return Object.freeze({ ...inspection, effectiveStatus: parent.effectiveStatus });
    try {
      await validatePlanLease(inspection, planGateId);
    } catch (error) {
      const expired =
        parent?.effectiveStatus === "expired" || errorCode(error) === "GATEHOUSE_PLAN_EXPIRED";
      return Object.freeze({
        ...inspection,
        effectiveStatus: expired ? ("lease-expired" as const) : ("outcome-unknown" as const),
      });
    }
    return inspection;
  }

  async function listGates(
    listOptions: {
      readonly limit?: number | undefined;
      readonly afterGateId?: string | undefined;
      readonly statuses?: readonly GatehouseGateStatus[] | undefined;
      readonly actionKinds?: readonly string[] | undefined;
      readonly correlation?: { readonly runId?: string; readonly operationId?: string } | undefined;
    } = {},
  ): Promise<readonly GatehouseGateInspection[]> {
    const limit = listOptions.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      gatehouseError("GATEHOUSE_LIMIT_INVALID", "Gatehouse list limit must be between 1 and 100.");
    }
    let entries: string[];
    try {
      entries = await readdir(path.join(home, "gates"));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const inspections: GatehouseGateInspection[] = [];
    // Gate IDs are content-derived hashes. Truncating their lexical order makes
    // inbox visibility effectively random and can hide the newest approval
    // requests behind old records. Inspect the retained set, then present the
    // newest updates first before applying the caller's bounded result limit.
    for (const gateId of entries.filter((entry) => !entry.startsWith(".")).sort()) {
      const inspection = await inspectGate(gateId);
      if (!inspection) continue;
      if (listOptions.statuses && !listOptions.statuses.includes(inspection.effectiveStatus))
        continue;
      if (
        listOptions.actionKinds &&
        !listOptions.actionKinds.includes(inspection.intent.action.kind)
      )
        continue;
      if (
        (listOptions.correlation?.runId !== undefined &&
          inspection.intent.correlation?.runId !== listOptions.correlation.runId) ||
        (listOptions.correlation?.operationId !== undefined &&
          inspection.intent.correlation?.operationId !== listOptions.correlation.operationId)
      )
        continue;
      inspections.push(inspection);
    }
    inspections.sort(
      (left, right) =>
        right.gate.updatedAt.localeCompare(left.gate.updatedAt) ||
        right.gate.createdAt.localeCompare(left.gate.createdAt) ||
        left.gate.id.localeCompare(right.gate.id),
    );
    let start = 0;
    if (listOptions.afterGateId !== undefined) {
      const index = inspections.findIndex((item) => item.gate.id === listOptions.afterGateId);
      if (index < 0)
        gatehouseError(
          "GATEHOUSE_CURSOR_INVALID",
          "The Gate cursor is no longer available; refresh the inventory.",
        );
      start = index + 1;
    }
    return Object.freeze(inspections.slice(start, start + limit));
  }

  async function inspectHealth(): Promise<GatehouseRuntimeHealth> {
    let exists = true;
    try {
      await readdir(home);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      exists = false;
    }
    if (!exists) {
      return {
        home,
        exists: false,
        gateCount: 0,
        activeLeaseCount: 0,
        expiredLeaseCount: 0,
        invalidGateCount: 0,
      };
    }
    let invalidGateCount = 0;
    let activeLeaseCount = 0;
    let expiredLeaseCount = 0;
    let gateCount = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(path.join(home, "gates"));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    for (const gateId of entries.filter((entry) => !entry.startsWith(".")).slice(0, 1000)) {
      try {
        const inspection = await inspectGate(gateId);
        if (!inspection) continue;
        gateCount += 1;
        if (inspection.lease?.status === "active") {
          if (inspection.effectiveStatus === "lease-expired") expiredLeaseCount += 1;
          else activeLeaseCount += 1;
        }
      } catch {
        invalidGateCount += 1;
      }
    }
    return { home, exists: true, gateCount, activeLeaseCount, expiredLeaseCount, invalidGateCount };
  }

  async function submitIntent(intent: GatehouseActionIntent): Promise<GatehouseGateInspection> {
    assertGatehouseActionIntent(intent);
    const gateId = createDeterministicGatehouseId("gate", intent.id);
    const paths = getGatePaths(home, gateId);
    await ensure();
    const existing = await inspectGate(gateId);
    if (existing) {
      if (existing.intent.digest !== intent.digest) {
        gatehouseError(
          "GATEHOUSE_INTENT_ID_CONFLICT",
          `Intent ${intent.id} already exists with a different digest.`,
        );
      }
      return existing;
    }
    const temporary = path.join(home, "gates", `.tmp-${gateId}-${crypto.randomUUID()}`);
    const temporaryPaths = getGatePaths(home, path.basename(temporary));
    const observedAt = now().toISOString();
    const gate: GatehouseGate = Object.freeze({
      schemaVersion: GATEHOUSE_GATE_SCHEMA_VERSION,
      id: gateId,
      intentId: intent.id,
      intentDigest: intent.digest,
      policyId: intent.policy.id,
      policyDigest: intent.policy.digest,
      authority: intent.policy.authority,
      status: "pending",
      createdAt: observedAt,
      updatedAt: observedAt,
      expiresAt: intent.expiresAt,
      endorsementIds: Object.freeze([]),
    });
    try {
      await mkdir(temporary, { recursive: false, mode: 0o700 });
      await Promise.all([
        writeJsonAtomic(temporaryPaths.intent, intent),
        writeJsonAtomic(temporaryPaths.gate, gate),
      ]);
      await rename(temporary, paths.root);
    } catch (error) {
      await rm(temporary, { force: true, recursive: true });
      if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) throw error;
      const raced = await inspectGate(gateId);
      if (!raced || raced.intent.digest !== intent.digest) {
        gatehouseError(
          "GATEHOUSE_INTENT_ID_CONFLICT",
          `Intent ${intent.id} raced with different bytes.`,
        );
      }
      return raced;
    }
    const created = await inspectGate(gateId);
    if (!created) gatehouseError("GATEHOUSE_STORE_INCOMPLETE", `Gate ${gateId} was not persisted.`);
    return created;
  }

  async function submitEndorsement(
    endorsement: GatehouseEndorsementSubmission,
  ): Promise<GatehouseSubmitEndorsementResult> {
    assertGatehouseEndorsementSubmission(endorsement);
    const verifier = options.endorsementVerifier;
    if (!verifier) {
      gatehouseError(
        "GATEHOUSE_ENDORSEMENT_VERIFIER_UNAVAILABLE",
        "This Gatehouse runtime has no admitted endorsement verifier.",
      );
    }
    const paths = getGatePaths(home, endorsement.gateId);
    return withGateLock(paths, now(), async () => {
      const inspection = await readInspection(paths, now());
      if (!inspection)
        gatehouseError("GATEHOUSE_GATE_NOT_FOUND", `Gate ${endorsement.gateId} was not found.`);
      assertGateMutable(inspection);
      if (endorsement.intentDigest !== inspection.intent.digest) {
        gatehouseError(
          "GATEHOUSE_ENDORSEMENT_INTENT_MISMATCH",
          "The endorsement does not bind the current immutable intent.",
        );
      }
      if (parseIso(endorsement.expiresAt, "endorsement.expiresAt") <= now().getTime()) {
        gatehouseError("GATEHOUSE_ENDORSEMENT_EXPIRED", "The endorsement has expired.");
      }
      const existing = await readJson<GatehouseVerifiedEndorsement>(
        path.join(paths.endorsements, `${endorsement.id}.json`),
      );
      if (existing) {
        if (existing.digest !== endorsement.digest) {
          gatehouseError(
            "GATEHOUSE_ENDORSEMENT_ID_CONFLICT",
            `Endorsement ${endorsement.id} already exists with a different digest.`,
          );
        }
        const priorReceipt = await readJson<GatehouseDecisionReceipt>(
          path.join(paths.decisions, `${endorsement.id}.json`),
        );
        const priorApproval = await readJson<GatehouseApprovalBundle>(paths.approval);
        const priorGate = await readJson<GatehouseGate>(paths.gate);
        if (!priorReceipt || !priorApproval || !priorGate) {
          gatehouseError(
            "GATEHOUSE_STORE_INCOMPLETE",
            "Persisted endorsement lacks its decision state.",
          );
        }
        return { approvalBundle: priorApproval, decisionReceipt: priorReceipt, gate: priorGate };
      }
      const verified = await verifier.verify({
        endorsement,
        gate: inspection.gate,
        intent: inspection.intent,
      });
      if (
        verified.id !== endorsement.id ||
        verified.digest !== endorsement.digest ||
        verified.intentDigest !== endorsement.intentDigest ||
        verified.gateId !== endorsement.gateId ||
        verified.principalId !== endorsement.principalId
      ) {
        gatehouseError(
          "GATEHOUSE_VERIFIER_RESULT_MISMATCH",
          `Verifier ${verifier.id} returned an endorsement with changed semantic identity.`,
        );
      }
      assertEndorsementAuthority(inspection.intent, verified);
      const nextEndorsements = Object.freeze([...inspection.endorsements, verified]);
      const approvalBundle = evaluateApprovalBundle({
        endorsements: nextEndorsements,
        gate: inspection.gate,
        intent: inspection.intent,
        now: now(),
      });
      const stateAfter = gateStatusFromApproval(approvalBundle, nextEndorsements.length);
      const updatedAt = now().toISOString();
      const gate: GatehouseGate = Object.freeze({
        ...inspection.gate,
        approvalBundleId: approvalBundle.id,
        endorsementIds: Object.freeze([...inspection.gate.endorsementIds, verified.id]),
        status: stateAfter,
        updatedAt,
      });
      const decisionReceipt: GatehouseDecisionReceipt = Object.freeze({
        schemaVersion: GATEHOUSE_DECISION_RECEIPT_SCHEMA_VERSION,
        id: createDeterministicGatehouseId("decision", verified.id),
        gateId: gate.id,
        intentDigest: inspection.intent.digest,
        endorsementId: verified.id,
        principalId: verified.principalId,
        decision: verified.decision,
        accepted: true,
        recordedAt: updatedAt,
        stateBefore: inspection.gate.status,
        stateAfter,
      });
      await Promise.all([
        writeJsonExclusive(path.join(paths.endorsements, `${verified.id}.json`), verified),
        writeJsonAtomic(paths.approval, approvalBundle),
        writeJsonAtomic(paths.gate, gate),
        writeJsonExclusive(path.join(paths.decisions, `${verified.id}.json`), decisionReceipt),
      ]);
      return { approvalBundle, decisionReceipt, gate };
    });
  }

  function planPaths(planGateId: string) {
    if (!/^gate_[a-f0-9]{32}$/u.test(planGateId))
      gatehouseError("GATEHOUSE_PLAN_INVALID", "An exact canonical plan Gate ID is required.");
    return getGatePaths(home, planGateId);
  }
  async function inspectPlanClaims(
    planGateId: string,
  ): Promise<readonly GatehouseBoundedPlanClaim[]> {
    const claims = await readJsonDirectory<GatehouseBoundedPlanClaim>(
      path.join(planPaths(planGateId).root, "plan-claims"),
    );
    for (const claim of claims) {
      if (
        claim.schema !== "gatehouse.bounded-plan-claim.v0" ||
        claim.planGateId !== planGateId ||
        !/^gate_[a-f0-9]{32}$/u.test(claim.gateId) ||
        ![claim.planDigest, claim.intentDigest, claim.semanticDigest].every((value) =>
          /^sha256:[a-f0-9]{64}$/u.test(value),
        ) ||
        !Number.isFinite(Date.parse(claim.reservedAt)) ||
        !Number.isFinite(Date.parse(claim.expiresAt)) ||
        Date.parse(claim.reservedAt) >= Date.parse(claim.expiresAt) ||
        claim.id !==
          createDeterministicGatehouseId("plan_claim", {
            plan: claim.planDigest,
            gate: claim.gateId,
          })
      )
        gatehouseError(
          "GATEHOUSE_PLAN_BINDING_MISMATCH",
          "Retained plan claims are incomplete or inconsistent.",
        );
    }
    return Object.freeze(claims);
  }
  async function approvedPlan(planGateId: string) {
    const parent = await readInspection(planPaths(planGateId), now());
    if (
      !parent ||
      parent.effectiveStatus !== "quorum-satisfied" ||
      parent.approvalBundle?.status !== "quorum-satisfied" ||
      parent.revocations.length ||
      parent.consumption ||
      parent.lease ||
      parent.execution
    )
      gatehouseError(
        "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
        "The unconsumed bounded plan must have current independent quorum authority.",
      );
    if (
      evaluateApprovalBundle({
        endorsements: parent.endorsements,
        gate: parent.gate,
        intent: parent.intent,
        now: now(),
      }).id !== parent.approvalBundle.id
    )
      gatehouseError(
        "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
        "The persisted approval projection does not agree with current endorsement history.",
      );
    const plan = readGatehouseBoundedPlan(parent.intent);
    const expiry = Math.min(
      Date.parse(parent.intent.expiresAt),
      ...parent.endorsements
        .filter((e) => parent.approvalBundle!.acceptedEndorsementIds.includes(e.id))
        .map((e) => Date.parse(e.expiresAt)),
    );
    if (!Number.isFinite(expiry) || expiry <= now().getTime())
      gatehouseError(
        "GATEHOUSE_PLAN_EXPIRED",
        "The bounded plan or its accepted authority has expired.",
      );
    return { parent, plan, expiry };
  }
  function assertPlanMember(
    parent: GatehouseGateInspection,
    child: GatehouseGateInspection,
    plan: ReturnType<typeof readGatehouseBoundedPlan>,
  ) {
    const intent = child.intent;
    if (
      intent.action.authorityImpact !== "none" ||
      !["low", "moderate"].includes(intent.risk) ||
      !["reversible", "compensatable"].includes(intent.reversibility) ||
      intent.requestedCapability.maxAttempts !== 1 ||
      intent.action.kind.startsWith("gatehouse.") ||
      fingerprintGatehouseValue(intent.policy.authority) !==
        fingerprintGatehouseValue(parent.intent.policy.authority) ||
      fingerprintGatehouseValue({
        requester: intent.requester,
        actor: intent.actor,
        system: intent.accountableSystem,
      }) !==
        fingerprintGatehouseValue({
          requester: parent.intent.requester,
          actor: parent.intent.actor,
          system: parent.intent.accountableSystem,
        })
    )
      gatehouseError(
        "GATEHOUSE_PLAN_SCOPE_MISMATCH",
        "The concrete action changes the plan's actor, policy or safe authority ceiling.",
      );
    const semanticDigest = fingerprintGatehouseIntentSemantics(intent);
    const entry = plan.entries.find(
      (item) => fingerprintGatehouseValue(item.semantics) === semanticDigest,
    );
    if (!entry)
      gatehouseError(
        "GATEHOUSE_PLAN_SCOPE_MISMATCH",
        "The concrete action is outside the reviewed semantic envelope.",
      );
    return { entry, semanticDigest };
  }
  async function validatePlanLease(child: GatehouseGateInspection, planGateId: string) {
    const { parent, plan, expiry } = await approvedPlan(planGateId);
    const { semanticDigest } = assertPlanMember(parent, child, plan);
    const authorization = child.lease?.planAuthorization;
    const claim = (await inspectPlanClaims(planGateId)).find(
      (item) => item.gateId === child.gate.id,
    );
    if (
      !authorization ||
      !claim ||
      claim.schema !== "gatehouse.bounded-plan-claim.v0" ||
      claim.intentDigest !== child.intent.digest ||
      claim.semanticDigest !== semanticDigest ||
      claim.planDigest !== parent.intent.digest ||
      claim.approvalBundleId !== parent.approvalBundle!.id ||
      claim.planGateId !== planGateId ||
      authorization.planDigest !== parent.intent.digest ||
      authorization.claimId !== claim.id ||
      authorization.claimDigest !== fingerprintGatehouseValue(claim) ||
      child.lease!.expiresAt !== claim.expiresAt ||
      child.lease!.issuedAt !== claim.reservedAt ||
      child.lease!.approvalBundleId !== parent.approvalBundle!.id ||
      Date.parse(child.lease!.expiresAt) > expiry
    )
      gatehouseError(
        "GATEHOUSE_PLAN_BINDING_MISMATCH",
        "The exact lease does not bind its retained plan authority claim.",
      );
  }
  async function issueLeaseFromPlan(
    input: GatehouseIssueLeaseInput & { readonly planGateId: string },
  ): Promise<GatehouseExecutionLease> {
    assertSha256(input.preconditionDigest, "preconditionDigest");
    if (input.gateId === input.planGateId || !/^gate_[a-f0-9]{32}$/u.test(input.gateId))
      gatehouseError(
        "GATEHOUSE_PLAN_INVALID",
        "A plan cannot authorize itself or a noncanonical Gate.",
      );
    const parentPaths = planPaths(input.planGateId);
    const paths = getGatePaths(home, input.gateId);
    return withGateLock(parentPaths, now(), () =>
      withGateLock(paths, now(), async () => {
        const { parent, plan, expiry } = await approvedPlan(input.planGateId);
        const child = await readInspection(paths, now());
        if (!child) gatehouseError("GATEHOUSE_GATE_NOT_FOUND", "The concrete Gate was not found.");
        assertGateMutable(child);
        if (child.effectiveStatus === "request-changes" || child.consumption || child.execution)
          gatehouseError(
            "GATEHOUSE_PLAN_CHILD_BLOCKED",
            "Review or reconcile this concrete Gate; a plan cannot replay it.",
          );
        const { entry, semanticDigest } = assertPlanMember(parent, child, plan);
        if (input.preconditionDigest !== child.intent.preconditions.digest)
          gatehouseError("GATEHOUSE_PREFLIGHT_MISMATCH", "Exact child preconditions differ.");
        if (child.lease) {
          if (
            child.lease.status !== "active" ||
            child.lease.planAuthorization?.planGateId !== input.planGateId
          )
            gatehouseError(
              "GATEHOUSE_PLAN_BINDING_MISMATCH",
              "Existing lease authority cannot be replaced by a plan.",
            );
          await validatePlanLease(child, input.planGateId);
          return child.lease;
        }
        const expires =
          input.expiresAt === undefined
            ? Math.min(expiry, Date.parse(child.intent.expiresAt))
            : parseIso(input.expiresAt, "lease.expiresAt");
        if (
          expires <= now().getTime() ||
          expires > expiry ||
          expires > Date.parse(child.intent.expiresAt) ||
          Date.parse(child.intent.createdAt) > now().getTime()
        )
          gatehouseError(
            "GATEHOUSE_LEASE_EXPIRY_INVALID",
            "Concrete lease exceeds a current authority horizon.",
          );
        const claims = await inspectPlanClaims(input.planGateId);
        const existing = claims.find((item) => item.gateId === child.gate.id);
        if (
          existing &&
          (existing.intentDigest !== child.intent.digest ||
            existing.semanticDigest !== semanticDigest ||
            existing.planDigest !== parent.intent.digest ||
            existing.approvalBundleId !== parent.approvalBundle!.id)
        )
          gatehouseError("GATEHOUSE_PLAN_BINDING_MISMATCH", "Retained claim cannot be rebound.");
        if (!existing) {
          // Reservations are burnt before lease issuance. An incomplete or uncertain predecessor
          // blocks fresh claims rather than treating crash/restart as a budget refund.
          for (const claim of claims) {
            const previous = await readInspection(getGatePaths(home, claim.gateId), now());
            if (
              !previous?.execution ||
              previous.execution.outcome !== "completed" ||
              !/^sha256:[a-f0-9]{64}$/u.test(previous.execution.resultDigest ?? "") ||
              previous.execution.intentDigest !== claim.intentDigest ||
              previous.execution.gateId !== claim.gateId ||
              previous.execution.leaseId !== previous.lease?.id ||
              previous.execution.consumptionId !== previous.consumption?.id ||
              previous.execution.attemptId !== previous.consumption?.attemptId ||
              previous.consumption?.gateId !== claim.gateId ||
              previous.consumption?.leaseId !== previous.lease?.id ||
              previous.consumption?.intentDigest !== claim.intentDigest ||
              previous.lease?.intentDigest !== claim.intentDigest ||
              previous.lease?.planAuthorization?.planGateId !== input.planGateId ||
              previous.lease?.planAuthorization?.planDigest !== parent.intent.digest ||
              previous.lease?.planAuthorization?.claimId !== claim.id ||
              previous.lease?.planAuthorization?.claimDigest !== fingerprintGatehouseValue(claim)
            )
              gatehouseError(
                "GATEHOUSE_PLAN_PREDECESSOR_UNCONFIRMED",
                "Reconcile the reserved predecessor; no new plan action is admitted.",
              );
          }
          if (
            claims.filter((item) => item.semanticDigest === semanticDigest).length >= entry.maxUses
          )
            gatehouseError(
              "GATEHOUSE_PLAN_USES_EXHAUSTED",
              "The reviewed semantic envelope has no uses left.",
            );
        }
        const claim: GatehouseBoundedPlanClaim = existing ?? {
          schema: "gatehouse.bounded-plan-claim.v0",
          id: createDeterministicGatehouseId("plan_claim", {
            plan: parent.intent.digest,
            gate: child.gate.id,
          }),
          planGateId: parent.gate.id,
          planDigest: parent.intent.digest,
          approvalBundleId: parent.approvalBundle!.id,
          gateId: child.gate.id,
          intentDigest: child.intent.digest,
          semanticDigest,
          reservedAt: now().toISOString(),
          expiresAt: new Date(expires).toISOString(),
        };
        if (!existing)
          await writeJsonExclusive(
            path.join(parentPaths.root, "plan-claims", `${child.gate.id}.json`),
            claim,
          );
        if (
          Date.parse(claim.expiresAt) <= now().getTime() ||
          Date.parse(claim.expiresAt) > expiry ||
          (input.expiresAt !== undefined &&
            Date.parse(input.expiresAt) !== Date.parse(claim.expiresAt))
        )
          gatehouseError(
            "GATEHOUSE_LEASE_EXPIRY_INVALID",
            "A retained reservation cannot renew or widen its lease horizon.",
          );
        const lease: GatehouseExecutionLease = {
          schemaVersion: GATEHOUSE_EXECUTION_LEASE_SCHEMA_VERSION,
          id: createDeterministicGatehouseId("plan_lease", claim.id),
          gateId: child.gate.id,
          intentId: child.intent.id,
          intentDigest: child.intent.digest,
          approvalBundleId: parent.approvalBundle!.id,
          capability: child.intent.requestedCapability.capability,
          executorClass: child.intent.requestedCapability.executorClass,
          targetDigest: child.intent.target.digest,
          scopeDigest: child.intent.requestedCapability.scopeDigest,
          preconditionDigest: child.intent.preconditions.digest,
          maxAttempts: 1,
          attempts: 0,
          issuedAt: claim.reservedAt,
          expiresAt: claim.expiresAt,
          nonce: createDeterministicGatehouseId("plan_lease_nonce", claim.id),
          status: "active",
          planAuthorization: {
            planGateId: parent.gate.id,
            planDigest: parent.intent.digest,
            claimId: claim.id,
            claimDigest: fingerprintGatehouseValue(claim),
          },
        };
        await writeJsonAtomic(paths.lease, lease);
        await writeJsonAtomic(paths.gate, {
          ...child.gate,
          leaseId: lease.id,
          status: "lease-issued",
          updatedAt: now().toISOString(),
        });
        return Object.freeze(lease);
      }),
    );
  }

  async function issueLease(input: GatehouseIssueLeaseInput): Promise<GatehouseExecutionLease> {
    assertSha256(input.preconditionDigest, "preconditionDigest");
    const paths = getGatePaths(home, input.gateId);
    return withGateLock(paths, now(), async () => {
      const inspection = await readInspection(paths, now());
      if (!inspection)
        gatehouseError("GATEHOUSE_GATE_NOT_FOUND", `Gate ${input.gateId} was not found.`);
      assertGateMutable(inspection);
      if (inspection.intent.action.kind === "gatehouse.bounded-plan")
        gatehouseError(
          "GATEHOUSE_PLAN_NOT_EXECUTABLE",
          "A bounded plan authorizes child leases; it is not an executable one-shot lease.",
        );
      if (
        inspection.effectiveStatus !== "quorum-satisfied" &&
        inspection.effectiveStatus !== "lease-issued"
      ) {
        gatehouseError(
          "GATEHOUSE_QUORUM_REQUIRED",
          `Gate ${input.gateId} is ${inspection.effectiveStatus}, not quorum-satisfied.`,
        );
      }
      if (input.preconditionDigest !== inspection.intent.preconditions.digest) {
        gatehouseError(
          "GATEHOUSE_PREFLIGHT_MISMATCH",
          "Lease issuance preconditions differ from the approved intent.",
        );
      }
      if (inspection.lease) {
        if (inspection.lease.planAuthorization)
          gatehouseError(
            "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
            "Revalidate this lease through its owning bounded plan.",
          );
        if (inspection.lease.status === "active") {
          return inspection.lease;
        }
        gatehouseError(
          "GATEHOUSE_LEASE_ALREADY_FINAL",
          `Gate ${input.gateId} already has a final lease.`,
        );
      }
      const issuedAt = now();
      // No implicit execution deadline; retain every accepted authority horizon.
      const defaultExpiry = Math.min(
        parseIso(inspection.gate.expiresAt, "gate.expiresAt"),
        ...inspection.endorsements
          .filter((endorsement) =>
            inspection.approvalBundle?.acceptedEndorsementIds.includes(endorsement.id),
          )
          .map((endorsement) => parseIso(endorsement.expiresAt, "endorsement.expiresAt")),
      );
      const expiresAt =
        input.expiresAt == null ? defaultExpiry : parseIso(input.expiresAt, "lease.expiresAt");
      if (expiresAt <= issuedAt.getTime() || expiresAt > defaultExpiry) {
        gatehouseError(
          "GATEHOUSE_LEASE_EXPIRY_INVALID",
          "Lease expiry must be future and no later than the gate or accepted authority expiry.",
        );
      }
      if (!inspection.approvalBundle || inspection.approvalBundle.status !== "quorum-satisfied") {
        gatehouseError(
          "GATEHOUSE_APPROVAL_BUNDLE_REQUIRED",
          "A quorum-satisfied approval bundle is required.",
        );
      }
      const lease: GatehouseExecutionLease = Object.freeze({
        schemaVersion: GATEHOUSE_EXECUTION_LEASE_SCHEMA_VERSION,
        id: createGatehouseId("gatehouse_lease"),
        gateId: inspection.gate.id,
        intentId: inspection.intent.id,
        intentDigest: inspection.intent.digest,
        approvalBundleId: inspection.approvalBundle.id,
        capability: inspection.intent.requestedCapability.capability,
        executorClass: inspection.intent.requestedCapability.executorClass,
        targetDigest: inspection.intent.target.digest,
        scopeDigest: inspection.intent.requestedCapability.scopeDigest,
        preconditionDigest: inspection.intent.preconditions.digest,
        maxAttempts: inspection.intent.requestedCapability.maxAttempts,
        attempts: 0,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        nonce: createGatehouseId("lease_nonce"),
        status: "active",
      });
      const gate: GatehouseGate = Object.freeze({
        ...inspection.gate,
        leaseId: lease.id,
        status: "lease-issued",
        updatedAt: issuedAt.toISOString(),
      });
      await Promise.all([writeJsonAtomic(paths.lease, lease), writeJsonAtomic(paths.gate, gate)]);
      return lease;
    });
  }

  async function consumeLease(
    input: GatehouseConsumeLeaseInput,
  ): Promise<GatehouseLeaseConsumptionReceipt> {
    assertNonEmpty(input.attemptId, "attemptId");
    assertSha256(input.intentDigest, "intentDigest");
    assertSha256(input.preconditionDigest, "preconditionDigest");
    assertSha256(input.scopeDigest, "scopeDigest");
    assertSha256(input.targetDigest, "targetDigest");
    const gateDirectories = path.join(home, "gates");
    let entries: string[] = [];
    try {
      entries = await readdir(gateDirectories);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        gatehouseError("GATEHOUSE_LEASE_NOT_FOUND", `Lease ${input.leaseId} was not found.`);
      }
      throw error;
    }
    let paths: GatePaths | undefined;
    let planGateId: string | undefined;
    for (const gateId of entries.filter((entry) => !entry.startsWith("."))) {
      const candidate = getGatePaths(home, gateId);
      const lease = await readJson<GatehouseExecutionLease>(candidate.lease);
      if (lease?.id === input.leaseId) {
        paths = candidate;
        planGateId = lease.planAuthorization?.planGateId;
        break;
      }
    }
    if (!paths)
      gatehouseError("GATEHOUSE_LEASE_NOT_FOUND", `Lease ${input.leaseId} was not found.`);
    const consume = () =>
      withGateLock(paths!, now(), async () => {
        const inspection = await readInspection(paths!, now());
        if (!inspection?.lease)
          gatehouseError("GATEHOUSE_LEASE_NOT_FOUND", `Lease ${input.leaseId} was not found.`);
        const lease = inspection.lease;
        const existing = inspection.consumption;
        if (
          existing &&
          (input.intentDigest !== lease.intentDigest ||
            input.capability !== lease.capability ||
            input.executorClass !== lease.executorClass ||
            input.targetDigest !== lease.targetDigest ||
            input.scopeDigest !== lease.scopeDigest ||
            input.preconditionDigest !== lease.preconditionDigest)
        )
          gatehouseError(
            "GATEHOUSE_LEASE_BINDING_MISMATCH",
            "A historical consumption receipt cannot be rebound.",
          );
        if (existing) {
          if (existing.attemptId === input.attemptId) return existing;
          gatehouseError("GATEHOUSE_LEASE_CONSUMED", `Lease ${lease.id} is already consumed.`);
        }
        if (inspection.effectiveStatus === "lease-expired") {
          gatehouseError("GATEHOUSE_LEASE_EXPIRED", `Lease ${lease.id} has expired.`);
        }
        if (inspection.effectiveStatus === "revoked" || lease.status === "revoked") {
          gatehouseError("GATEHOUSE_LEASE_REVOKED", `Lease ${lease.id} is revoked.`);
        }
        if (
          inspection.effectiveStatus === "denied" ||
          inspection.effectiveStatus === "request-changes"
        )
          gatehouseError(
            "GATEHOUSE_QUORUM_REQUIRED",
            "A denied or changed concrete Gate cannot consume plan authority.",
          );
        if (lease.status !== "active") {
          gatehouseError("GATEHOUSE_LEASE_NOT_ACTIVE", `Lease ${lease.id} is ${lease.status}.`);
        }
        if (lease.planAuthorization?.planGateId !== planGateId)
          gatehouseError(
            "GATEHOUSE_PLAN_BINDING_MISMATCH",
            "Plan authorization changed during consumption.",
          );
        if (planGateId) await validatePlanLease(inspection, planGateId);
        const comparisons: ReadonlyArray<readonly [string, string, string]> = [
          ["intentDigest", input.intentDigest, lease.intentDigest],
          ["capability", input.capability, lease.capability],
          ["executorClass", input.executorClass, lease.executorClass],
          ["targetDigest", input.targetDigest, lease.targetDigest],
          ["scopeDigest", input.scopeDigest, lease.scopeDigest],
          ["preconditionDigest", input.preconditionDigest, lease.preconditionDigest],
        ];
        const mismatch = comparisons.find(([, actual, expected]) => actual !== expected);
        if (mismatch) {
          gatehouseError(
            "GATEHOUSE_LEASE_BINDING_MISMATCH",
            `Lease ${lease.id} does not authorize the supplied ${mismatch[0]}.`,
          );
        }
        if (lease.attempts >= lease.maxAttempts) {
          gatehouseError(
            "GATEHOUSE_LEASE_ATTEMPTS_EXHAUSTED",
            `Lease ${lease.id} has no attempts left.`,
          );
        }
        const consumedAt = now().toISOString();
        const consumption: GatehouseLeaseConsumptionReceipt = Object.freeze({
          schemaVersion: GATEHOUSE_CONSUMPTION_RECEIPT_SCHEMA_VERSION,
          id: createDeterministicGatehouseId("consumption", {
            attemptId: input.attemptId,
            leaseId: lease.id,
          }),
          gateId: lease.gateId,
          leaseId: lease.id,
          intentDigest: lease.intentDigest,
          attemptId: input.attemptId,
          capability: lease.capability,
          executorClass: lease.executorClass,
          targetDigest: lease.targetDigest,
          scopeDigest: lease.scopeDigest,
          preconditionDigest: lease.preconditionDigest,
          consumedAt,
        });
        const didCreate = await writeJsonExclusive(paths!.consumption, consumption);
        if (!didCreate) {
          const raced = await readJson<GatehouseLeaseConsumptionReceipt>(paths!.consumption);
          if (raced?.attemptId === input.attemptId) return raced;
          gatehouseError(
            "GATEHOUSE_LEASE_CONSUMED",
            `Lease ${lease.id} was consumed concurrently.`,
          );
        }
        const consumedLease: GatehouseExecutionLease = Object.freeze({
          ...lease,
          attempts: lease.attempts + 1,
          consumedAt,
          consumptionId: consumption.id,
          status: "consumed",
        });
        const gate: GatehouseGate = Object.freeze({
          ...inspection.gate,
          status: "executing",
          updatedAt: consumedAt,
        });
        await Promise.all([
          writeJsonAtomic(paths!.lease, consumedLease),
          writeJsonAtomic(paths!.gate, gate),
        ]);
        return consumption;
      });
    return planGateId ? withGateLock(getGatePaths(home, planGateId), now(), consume) : consume();
  }

  async function revoke(input: {
    readonly actor: GatehousePrincipalRef;
    readonly gateId: string;
    readonly reason: string;
    readonly expectedInspectionDigest?: string;
  }): Promise<GatehouseRevocation> {
    assertNonEmpty(input.reason, "reason");
    const paths = getGatePaths(home, input.gateId);
    return withGateLock(paths, now(), async () => {
      const inspection = await readInspection(paths, now());
      if (!inspection)
        gatehouseError("GATEHOUSE_GATE_NOT_FOUND", `Gate ${input.gateId} was not found.`);
      if (
        input.expectedInspectionDigest !== undefined &&
        fingerprintGatehouseValue(inspection) !== input.expectedInspectionDigest
      )
        gatehouseError("GATEHOUSE_REVOCATION_STATE_CHANGED", "Revocation inspection changed.");
      const existing = inspection.revocations.at(-1);
      if (inspection.effectiveStatus === "revoked" && existing) return existing;
      const createdAt = now().toISOString();
      const revocation: GatehouseRevocation = Object.freeze({
        schemaVersion: GATEHOUSE_REVOCATION_SCHEMA_VERSION,
        id: createGatehouseId("gatehouse_revocation"),
        gateId: inspection.gate.id,
        ...(inspection.lease == null ? {} : { leaseId: inspection.lease.id }),
        actor: input.actor,
        reason: input.reason.trim(),
        createdAt,
      });
      const gate: GatehouseGate = Object.freeze({
        ...inspection.gate,
        revocationId: revocation.id,
        status: "revoked",
        updatedAt: createdAt,
      });
      const lease =
        inspection.lease == null
          ? undefined
          : Object.freeze({
              ...inspection.lease,
              revocationId: revocation.id,
              status: "revoked" as const,
            });
      await Promise.all([
        writeJsonExclusive(path.join(paths.revocations, `${revocation.id}.json`), revocation),
        writeJsonAtomic(paths.gate, gate),
        ...(lease == null ? [] : [writeJsonAtomic(paths.lease, lease)]),
      ]);
      return revocation;
    });
  }

  async function recordExecution(
    input: GatehouseRecordExecutionInput,
  ): Promise<GatehouseExecutionReceipt> {
    const paths = getGatePaths(home, input.gateId);
    return withGateLock(paths, now(), async () => {
      const inspection = await readInspection(paths, now());
      if (!inspection?.lease || !inspection.consumption) {
        gatehouseError(
          "GATEHOUSE_LEASE_CONSUMPTION_REQUIRED",
          "Execution result requires a consumed Gatehouse lease.",
        );
      }
      if (
        inspection.lease.id !== input.leaseId ||
        inspection.consumption.id !== input.consumptionId ||
        inspection.consumption.attemptId !== input.attemptId
      ) {
        gatehouseError(
          "GATEHOUSE_EXECUTION_BINDING_MISMATCH",
          "Execution result does not match the consumed lease and attempt.",
        );
      }
      if (inspection.execution) {
        if (
          inspection.execution.attemptId === input.attemptId &&
          inspection.execution.outcome === input.outcome &&
          inspection.execution.resultDigest === input.resultDigest
        ) {
          return inspection.execution;
        }
        gatehouseError(
          "GATEHOUSE_EXECUTION_ALREADY_RECORDED",
          "A different execution result is already recorded.",
        );
      }
      if (input.resultDigest != null) assertSha256(input.resultDigest, "resultDigest");
      const recordedAt = now().toISOString();
      const execution: GatehouseExecutionReceipt = Object.freeze({
        schemaVersion: GATEHOUSE_EXECUTION_RECEIPT_SCHEMA_VERSION,
        id: createDeterministicGatehouseId("execution", {
          attemptId: input.attemptId,
          consumptionId: input.consumptionId,
          outcome: input.outcome,
        }),
        gateId: inspection.gate.id,
        leaseId: inspection.lease.id,
        consumptionId: inspection.consumption.id,
        attemptId: input.attemptId,
        intentDigest: inspection.intent.digest,
        outcome: input.outcome,
        ...(input.resultDigest == null ? {} : { resultDigest: input.resultDigest }),
        recordedAt,
        ...(input.uncertainty?.trim() ? { uncertainty: input.uncertainty.trim() } : {}),
      });
      const gate: GatehouseGate = Object.freeze({
        ...inspection.gate,
        status: input.outcome,
        updatedAt: recordedAt,
      });
      await Promise.all([
        writeJsonAtomic(paths.execution, execution),
        writeJsonAtomic(paths.gate, gate),
      ]);
      return execution;
    });
  }

  return Object.freeze({
    home,
    ensure,
    inspectHealth,
    submitIntent,
    listGates,
    inspectGate,
    submitEndorsement,
    issueLease,
    issueLeaseFromPlan,
    inspectPlanClaims,
    consumeLease,
    revoke,
    recordExecution,
  });
}

export async function inspectGatehouseRuntimeHealth(home: string): Promise<GatehouseRuntimeHealth> {
  return createGatehouseRuntime({ home }).inspectHealth();
}

export function isGatehouseRuntimeError(error: unknown): error is GatehouseRuntimeError {
  return error instanceof GatehouseRuntimeError;
}
