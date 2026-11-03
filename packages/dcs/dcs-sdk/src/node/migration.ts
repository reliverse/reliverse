import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  applyDcsMigrationPlan,
  canonicalizeJson,
  createDcsMigrationPathMap,
  findDcsMigrationPlan,
  getJsonPointer,
  isJsonObject,
  parseConfigDocument,
  parseJsoncText,
  sha256Hex,
  type ConfigContractBundle,
  type DcsMigrationChange,
  type DcsMigrationDefaultsMode,
  type DcsMigrationPlan,
  type DcsResolvedConfig,
  type DcsProfileName,
  type JsonObject,
  type PersistentConfigScope,
} from "@reliverse/dcs-contract";

import { applyDcsDocumentPatch, type DcsDocumentPatch } from "../editor";
import { resolveConfig } from "./discovery";
import {
  readConfigDocumentForEdit,
  replaceConfigDocument,
  type DcsConfigDocumentSnapshot,
  type DcsConfigWriteResult,
  type ReadDcsConfigDocumentOptions,
} from "./writer";

export const DCS_MIGRATION_RECEIPT_FORMAT = "dcs-migration-receipt" as const;

export interface DcsMigrationReceipt {
  readonly $dcs: {
    readonly format: typeof DCS_MIGRATION_RECEIPT_FORMAT;
    readonly version: "0.0.1";
  };
  readonly after: {
    readonly documentRevision: string;
    readonly semanticRevision: string;
  };
  readonly before: {
    readonly documentRevision: string;
    readonly semanticRevision: string;
    /** Exact text enables a lossless JSONC restore. Store receipts securely. */
    readonly text: string;
    readonly textDigest: string;
  };
  readonly changes: readonly DcsMigrationChange[];
  readonly contract: {
    readonly id: string;
    readonly source: ConfigContractBundle["$dcs"];
    readonly target: ConfigContractBundle["$dcs"];
  };
  readonly format: "json" | "jsonc";
  readonly location: string;
  readonly materializedPaths: readonly string[];
  readonly mode: DcsMigrationDefaultsMode;
  readonly plan: DcsMigrationPlan["$dcs"];
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}

export interface DcsMigrationPlanResult {
  readonly changes: readonly DcsMigrationChange[];
  readonly document: JsonObject;
  readonly materializedPaths: readonly string[];
  readonly plan: DcsMigrationPlan;
  readonly snapshot: DcsConfigDocumentSnapshot;
}

export interface PlanDcsConfigMigrationOptions extends ReadDcsConfigDocumentOptions {
  readonly mode: DcsMigrationDefaultsMode;
  readonly sourceBundle: ConfigContractBundle;
}

export interface ApplyDcsConfigMigrationOptions extends PlanDcsConfigMigrationOptions {
  readonly expectedRevision?: string;
  /** Required because apply without a recoverable receipt is reckless. */
  readonly receiptPath: string;
}

export interface ApplyDcsConfigMigrationResult {
  readonly plan: DcsMigrationPlanResult;
  readonly receipt: DcsMigrationReceipt;
  readonly result: DcsConfigWriteResult;
}

export interface RestoreDcsConfigMigrationOptions {
  readonly currentBundle: ConfigContractBundle;
  readonly expectedRevision?: string;
  readonly receiptPath: string;
  readonly sourceBundle: ConfigContractBundle;
}

export interface RestoreDcsConfigMigrationResult {
  readonly receipt: DcsMigrationReceipt;
  readonly result: DcsConfigWriteResult;
}

export class DcsMigrationPlanNotFoundError extends Error {
  public constructor(source: ConfigContractBundle["$dcs"], target: ConfigContractBundle["$dcs"]) {
    super(
      `DCS target contract ${target.id}@${target.contractVersion}/${target.documentVersion} does not declare a migration from ${source.contractVersion}/${source.documentVersion}.`,
    );
    this.name = "DcsMigrationPlanNotFoundError";
  }
}

/** Builds, validates, and returns a no-write migration preview for one scope. */
export async function planDcsConfigMigration(
  options: PlanDcsConfigMigrationOptions,
): Promise<DcsMigrationPlanResult> {
  if (options.sourceBundle.$dcs.id !== options.bundle.$dcs.id) {
    throw new TypeError("DCS migration source and target bundles must have the same contract id.");
  }
  const snapshot = await readConfigDocumentForEdit({ ...options, bundle: options.sourceBundle });
  if (!snapshot.exists) {
    throw new TypeError(
      `DCS cannot migrate a missing ${options.scope} document: ${snapshot.location}.`,
    );
  }
  const plan = findDcsMigrationPlan(options.bundle, options.sourceBundle.$dcs);
  if (plan === undefined) {
    throw new DcsMigrationPlanNotFoundError(options.sourceBundle.$dcs, options.bundle.$dcs);
  }
  const applied = applyDcsMigrationPlan({ document: snapshot.document, plan });
  let document = applied.document;
  const materializedPaths: string[] = [];

  if (options.mode === "preserve-effective") {
    const oldResolved = await resolveOldEffectiveConfig(options);
    const pathMap = createDcsMigrationPathMap(options.sourceBundle, options.bundle, applied);
    const patch = createDefaultsPreservationPatch({
      document,
      oldResolved,
      pathMap,
      scope: options.scope,
      sourceBundle: options.sourceBundle,
      targetBundle: options.bundle,
    });
    document = applyDcsDocumentPatch(document, patch);
    materializedPaths.push(
      ...patch.operations
        .filter((operation) => operation.op === "set")
        .map((operation) => operation.path),
    );
  }

  const parsed = parseConfigDocument(document, {
    bundle: options.bundle,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    scope: options.scope,
    syntax: snapshot.format,
  });
  if (!parsed.ok) {
    throw new TypeError(
      `DCS migration output is invalid:\n${parsed.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n")}`,
    );
  }

  return Object.freeze({
    changes: applied.changes,
    document,
    materializedPaths: Object.freeze([...new Set(materializedPaths)].sort()),
    plan,
    snapshot,
  });
}

/** Applies a planned migration atomically and writes a reversible receipt. */
export async function applyDcsConfigMigration(
  options: ApplyDcsConfigMigrationOptions,
): Promise<ApplyDcsConfigMigrationResult> {
  const plan = await planDcsConfigMigration(options);
  const expectedRevision = options.expectedRevision ?? plan.snapshot.documentRevision;
  if (expectedRevision !== plan.snapshot.documentRevision) {
    throw new TypeError(
      `DCS migration expected revision does not match current document revision at ${plan.snapshot.location}.`,
    );
  }
  const beforeText = await readFile(plan.snapshot.location, "utf8");
  const result = await replaceConfigDocument({
    ...options,
    bundle: options.bundle,
    document: plan.document,
    expectedRevision,
    skipEffectiveValidation: true,
    sourceBundle: options.sourceBundle,
  });
  const receipt = await createReceipt({ beforeText, options, plan, result });
  await writeMigrationReceipt(options.receiptPath, receipt);
  return Object.freeze({ plan, receipt, result });
}

/** Restores exact receipt text with an optimistic revision check. */
export async function restoreDcsConfigMigration(
  options: RestoreDcsConfigMigrationOptions,
): Promise<RestoreDcsConfigMigrationResult> {
  const receipt = await readMigrationReceipt(options.receiptPath);
  assertReceiptMatchesBundles(receipt, options.sourceBundle, options.currentBundle);
  const expectedRevision = options.expectedRevision ?? receipt.after.documentRevision;
  const document = parseReceiptDocument(receipt);
  const result = await replaceConfigDocument({
    bundle: options.sourceBundle,
    document,
    expectedRevision,
    format: receipt.format,
    includeLocal: true,
    includeUser: true,
    includeWorkspace: true,
    ...(receipt.profile === undefined ? {} : { profile: receipt.profile }),
    scope: receipt.scope,
    sourceBundle: options.currentBundle,
    skipEffectiveValidation: true,
    textOverride: receipt.before.text,
    workspaceRoot: dirname(receipt.location),
  });
  return Object.freeze({ receipt, result });
}

export async function readMigrationReceipt(location: string): Promise<DcsMigrationReceipt> {
  const value: unknown = JSON.parse(await readFile(location, "utf8"));
  if (!isReceipt(value)) {
    throw new TypeError(`DCS migration receipt is invalid: ${location}.`);
  }
  return value;
}

function createDefaultsPreservationPatch(input: {
  readonly document: JsonObject;
  readonly oldResolved: DcsResolvedConfig;
  readonly pathMap: Readonly<Record<string, string>>;
  readonly scope: PersistentConfigScope;
  readonly sourceBundle: ConfigContractBundle;
  readonly targetBundle: ConfigContractBundle;
}): DcsDocumentPatch {
  const operations: DcsDocumentPatch["operations"][number][] = [];
  for (const [sourcePath, targetPath] of Object.entries(input.pathMap).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceDefault = getJsonPointer(input.sourceBundle.defaults, sourcePath);
    const targetDefault = getJsonPointer(input.targetBundle.defaults, targetPath);
    const provenance = input.oldResolved.provenance[sourcePath];
    const targetMetadata = input.targetBundle.fields[targetPath];
    if (
      sourceDefault === undefined ||
      targetDefault === undefined ||
      provenance?.effectiveSource.kind !== "defaults"
    ) {
      continue;
    }
    if (canonicalizeJson(sourceDefault) === canonicalizeJson(targetDefault)) {
      continue;
    }
    if (targetMetadata === undefined || !targetMetadata.scopes.includes(input.scope)) {
      continue;
    }
    if (getJsonPointer(input.document, targetPath) !== undefined) {
      continue;
    }
    const effectiveValue = getJsonPointer(input.oldResolved.value, sourcePath);
    if (effectiveValue !== undefined) {
      operations.push({ op: "set", path: targetPath, value: effectiveValue });
    }
  }
  return Object.freeze({ operations: Object.freeze(operations) });
}

async function resolveOldEffectiveConfig(
  options: PlanDcsConfigMigrationOptions,
): Promise<DcsResolvedConfig> {
  const result = await resolveConfig({
    bundle: options.sourceBundle,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.format === undefined ? {} : { format: options.format }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.includeLocal === undefined ? {} : { includeLocal: options.includeLocal }),
    ...(options.includeUser === undefined ? {} : { includeUser: options.includeUser }),
    ...(options.includeWorkspace === undefined
      ? {}
      : { includeWorkspace: options.includeWorkspace }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    workspaceRoot: options.workspaceRoot,
  });
  if (!result.ok || result.resolved === undefined) {
    throw new TypeError(
      `DCS cannot preserve effective defaults because the source configuration does not resolve cleanly.`,
    );
  }
  return result.resolved;
}

async function createReceipt(input: {
  readonly beforeText: string;
  readonly options: ApplyDcsConfigMigrationOptions;
  readonly plan: DcsMigrationPlanResult;
  readonly result: DcsConfigWriteResult;
}): Promise<DcsMigrationReceipt> {
  return Object.freeze({
    $dcs: Object.freeze({ format: DCS_MIGRATION_RECEIPT_FORMAT, version: "0.0.1" as const }),
    after: Object.freeze({
      documentRevision: input.result.documentRevision,
      semanticRevision: input.result.semanticRevision,
    }),
    before: Object.freeze({
      documentRevision: input.plan.snapshot.documentRevision,
      semanticRevision: input.plan.snapshot.semanticRevision,
      text: input.beforeText,
      textDigest: `sha256:${await sha256Hex(input.beforeText)}`,
    }),
    changes: Object.freeze(input.plan.changes),
    contract: Object.freeze({
      id: input.options.bundle.$dcs.id,
      source: Object.freeze({ ...input.options.sourceBundle.$dcs }),
      target: Object.freeze({ ...input.options.bundle.$dcs }),
    }),
    format: input.plan.snapshot.format,
    location: input.plan.snapshot.location,
    materializedPaths: Object.freeze(input.plan.materializedPaths),
    mode: input.options.mode,
    plan: Object.freeze({
      ...input.plan.plan.$dcs,
      from: { ...input.plan.plan.$dcs.from },
      to: { ...input.plan.plan.$dcs.to },
    }),
    ...(input.options.profile === undefined ? {} : { profile: input.options.profile }),
    scope: input.options.scope,
  });
}

async function writeMigrationReceipt(
  location: string,
  receipt: DcsMigrationReceipt,
): Promise<void> {
  const directory = dirname(location);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(location)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await rename(temporary, location);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseReceiptDocument(receipt: DcsMigrationReceipt): JsonObject {
  if (receipt.format === "jsonc") {
    const parsed = parseJsoncText(receipt.before.text);
    if (parsed.ok && parsed.parsed !== undefined && isJsonObject(parsed.parsed.value)) {
      return parsed.parsed.value;
    }
  } else {
    const value: unknown = JSON.parse(receipt.before.text);
    if (isJsonObject(value)) {
      return value;
    }
  }
  throw new TypeError(
    "DCS migration receipt backup does not contain a valid configuration document.",
  );
}

function assertReceiptMatchesBundles(
  receipt: DcsMigrationReceipt,
  source: ConfigContractBundle,
  current: ConfigContractBundle,
): void {
  if (receipt.contract.id !== source.$dcs.id || receipt.contract.id !== current.$dcs.id) {
    throw new TypeError("DCS migration receipt contract id does not match supplied bundles.");
  }
  if (
    receipt.contract.source.contractVersion !== source.$dcs.contractVersion ||
    receipt.contract.source.documentVersion !== source.$dcs.documentVersion
  ) {
    throw new TypeError("DCS migration receipt source contract does not match --from-bundle.");
  }
  if (
    receipt.contract.target.contractVersion !== current.$dcs.contractVersion ||
    receipt.contract.target.documentVersion !== current.$dcs.documentVersion
  ) {
    throw new TypeError("DCS migration receipt target contract does not match --bundle.");
  }
}

function isReceipt(value: unknown): value is DcsMigrationReceipt {
  if (
    !isJsonObject(value) ||
    !isJsonObject(value.$dcs) ||
    value.$dcs.format !== DCS_MIGRATION_RECEIPT_FORMAT ||
    value.$dcs.version !== "0.0.1"
  ) {
    return false;
  }
  return (
    isJsonObject(value.before) &&
    isJsonObject(value.after) &&
    typeof value.location === "string" &&
    typeof value.scope === "string" &&
    typeof value.format === "string"
  );
}
