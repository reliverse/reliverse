import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  canonicalizeJson,
  cloneJsonValue,
  createDcsLockfile,
  parseDcsLockfile,
  redactDcsSecretReferences,
  serializeDcsLockfile,
  sha256Hex,
  type ConfigContractBundle,
  type DcsDiagnostic,
  type DcsLockfile,
  type DcsLockInputRecord,
  type JsonObject,
  type JsonValue,
} from "@reliverse/dcs-contract";

import type { DcsDocumentRevision, DcsSemanticRevision } from "../editor";
import {
  resolveConfig,
  type DiscoverConfigDocumentsOptions,
  type ResolveConfigOptions,
} from "./discovery";

export const DCS_LOCK_GENERATOR = "@reliverse/dcs-cli@0.1.0";

export interface DcsConfigLockOptions extends ResolveConfigOptions {
  readonly generatedBy?: string;
  readonly includeRedactedEffective?: boolean;
  readonly policyDigest?: string;
}

export interface DcsConfigLockWriteOptions extends DcsConfigLockOptions {
  readonly outputPath?: string;
}

export interface DcsConfigLockVerifyOptions extends DcsConfigLockOptions {
  readonly lockPath: string;
}

export interface DcsConfigLockWriteResult {
  readonly lockfile: DcsLockfile;
  readonly lockfileDigest: string;
  readonly outputPath: string;
  readonly written: boolean;
}

export interface DcsConfigLockVerifyResult {
  readonly current: DcsLockfile;
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly expected: DcsLockfile;
  readonly lockfileDigest: string;
  readonly matches: boolean;
  readonly ok: boolean;
}

export interface DcsConfigLockDiffEntry {
  readonly actual?: JsonValue;
  readonly expected?: JsonValue;
  readonly path: string;
}

export interface DcsConfigLockDiffResult extends DcsConfigLockVerifyResult {
  readonly differences: readonly DcsConfigLockDiffEntry[];
}

export function locateDcsConfigLockfile(options: DiscoverConfigDocumentsOptions): string {
  const suffix = options.profile === undefined ? "" : `.${options.profile}`;
  return resolve(
    options.workspaceRoot,
    `${options.bundle.$dcs.fileStem}.config${suffix}.lock.json`,
  );
}

export async function createDcsConfigLockfile(options: DcsConfigLockOptions): Promise<DcsLockfile> {
  const resolved = await resolveConfig(options);
  if (!resolved.ok || resolved.resolved === undefined || resolved.effectiveRevision === undefined) {
    throw new DcsConfigLockResolutionError(resolved.diagnostics);
  }

  const inputs: DcsLockInputRecord[] = [];
  for (const document of resolved.discovery.documents) {
    const text = await readFile(document.location, "utf8");
    const semantic = document.layer.document as unknown as JsonObject;
    inputs.push({
      documentRevision: await documentRevisionForText(text),
      format: document.format,
      location: document.location,
      ...(document.profile === undefined ? {} : { profile: document.profile }),
      scope: document.layer.scope as "local" | "user" | "workspace",
      semanticRevision: await semanticRevisionForJson(semantic),
      sourceKind: document.layer.source.kind,
    });
  }

  const extensions = await Promise.all(
    resolved.resolved.extensions.map(async (entry) => ({
      digest: `sha256:${await sha256Hex(`dcs-lock-extension-v0\u0000${canonicalizeJson(entry.extensions)}`)}`,
      ...(entry.source.location === undefined ? {} : { location: entry.source.location }),
      ...(entry.source.profile === undefined ? {} : { profile: entry.source.profile }),
      sourceKind: entry.source.kind,
    })),
  );

  const effectiveSnapshot =
    options.includeRedactedEffective === true
      ? redactResolvedValue(options.bundle, resolved.resolved.value)
      : undefined;

  return createDcsLockfile({
    $dcsLock: {
      contractVersion: options.bundle.$dcs.contractVersion,
      documentVersion: options.bundle.$dcs.documentVersion,
      fileStem: options.bundle.$dcs.fileStem,
      format: "org.reliverse.dcs.lock",
      generatedBy: options.generatedBy ?? DCS_LOCK_GENERATOR,
      id: options.bundle.$dcs.id,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      version: 1,
    },
    contract: {
      digest: await contractDigest(options.bundle),
    },
    effective: {
      redacted: options.includeRedactedEffective === true,
      revision: resolved.effectiveRevision,
      ...(effectiveSnapshot === undefined ? {} : { snapshot: effectiveSnapshot }),
    },
    extensions,
    inputs,
    ...(options.policyDigest === undefined ? {} : { policy: { digest: options.policyDigest } }),
  });
}

export async function writeDcsConfigLockfile(
  options: DcsConfigLockWriteOptions,
): Promise<DcsConfigLockWriteResult> {
  const outputPath = options.outputPath ?? locateDcsConfigLockfile(options);
  const lockfile = await createDcsConfigLockfile(options);
  const text = serializeDcsLockfile(lockfile);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, "utf8");
  return {
    lockfile,
    lockfileDigest: await lockfileDigest(lockfile),
    outputPath,
    written: true,
  };
}

export async function readDcsConfigLockfile(lockPath: string): Promise<DcsLockfile> {
  const parsed = parseDcsLockfile(await readFile(lockPath, "utf8"));
  if (!parsed.ok || parsed.lockfile === undefined) {
    throw new DcsConfigLockValidationError(parsed.diagnostics);
  }
  return parsed.lockfile;
}

export async function verifyDcsConfigLockfile(
  options: DcsConfigLockVerifyOptions,
): Promise<DcsConfigLockVerifyResult> {
  const expected = await readDcsConfigLockfile(options.lockPath);
  const current = await createDcsConfigLockfile({
    ...options,
    includeRedactedEffective: expected.effective.snapshot !== undefined,
  });
  const diagnostics = compareLockfiles(expected, current);
  const matches = diagnostics.length === 0;
  return {
    current,
    diagnostics,
    expected,
    lockfileDigest: await lockfileDigest(expected),
    matches,
    ok: matches,
  };
}

export async function diffDcsConfigLockfile(
  options: DcsConfigLockVerifyOptions,
): Promise<DcsConfigLockDiffResult> {
  const verify = await verifyDcsConfigLockfile(options);
  return {
    ...verify,
    differences: lockfileDifferences(verify.expected, verify.current),
  };
}

export async function explainDcsConfigLockfile(
  lockPath: string,
): Promise<{ readonly digest: string; readonly lockfile: DcsLockfile }> {
  const lockfile = await readDcsConfigLockfile(lockPath);
  return {
    digest: await lockfileDigest(lockfile),
    lockfile,
  };
}

export async function assertDcsFrozenResolve(
  options: DcsConfigLockVerifyOptions,
): Promise<DcsConfigLockVerifyResult> {
  const result = await verifyDcsConfigLockfile(options);
  if (!result.ok) {
    throw new DcsConfigLockMismatchError(result.diagnostics, result);
  }
  return result;
}

export class DcsConfigLockResolutionError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super("Unable to create DCS lockfile because configuration resolution failed.");
    this.name = "DcsConfigLockResolutionError";
    this.diagnostics = diagnostics;
  }
}

export class DcsConfigLockValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super("DCS lockfile is invalid.");
    this.name = "DcsConfigLockValidationError";
    this.diagnostics = diagnostics;
  }
}

export class DcsConfigLockMismatchError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];
  public readonly result: DcsConfigLockVerifyResult;

  public constructor(diagnostics: readonly DcsDiagnostic[], result: DcsConfigLockVerifyResult) {
    super("DCS frozen resolve does not match the selected lockfile.");
    this.name = "DcsConfigLockMismatchError";
    this.diagnostics = diagnostics;
    this.result = result;
  }
}

function compareLockfiles(expected: DcsLockfile, current: DcsLockfile): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];
  if (expected.$dcsLock.id !== current.$dcsLock.id)
    diagnostics.push(
      lockDiag("DCS9101", "DCS lock contract id does not match current bundle.", "/$dcsLock/id"),
    );
  if (expected.$dcsLock.contractVersion !== current.$dcsLock.contractVersion)
    diagnostics.push(
      lockDiag(
        "DCS9102",
        "DCS lock contractVersion does not match current bundle.",
        "/$dcsLock/contractVersion",
      ),
    );
  if (expected.$dcsLock.documentVersion !== current.$dcsLock.documentVersion)
    diagnostics.push(
      lockDiag(
        "DCS9103",
        "DCS lock documentVersion does not match current bundle.",
        "/$dcsLock/documentVersion",
      ),
    );
  if (expected.$dcsLock.profile !== current.$dcsLock.profile)
    diagnostics.push(
      lockDiag(
        "DCS9104",
        "DCS lock profile does not match current selection.",
        "/$dcsLock/profile",
      ),
    );
  if (expected.contract.digest !== current.contract.digest)
    diagnostics.push(
      lockDiag(
        "DCS9105",
        "DCS lock contract digest does not match current bundle.",
        "/contract/digest",
      ),
    );
  if (expected.effective.revision !== current.effective.revision)
    diagnostics.push(
      lockDiag("DCS9106", "DCS effective revision does not match lockfile.", "/effective/revision"),
    );
  compareRecordArray(
    "inputs",
    expected.inputs as unknown as readonly JsonObject[],
    current.inputs as unknown as readonly JsonObject[],
    diagnostics,
    ["scope", "profile", "location"],
  );
  compareRecordArray(
    "extensions",
    expected.extensions as unknown as readonly JsonObject[],
    current.extensions as unknown as readonly JsonObject[],
    diagnostics,
    ["sourceKind", "profile", "location"],
  );
  if ((expected.policy?.digest ?? null) !== (current.policy?.digest ?? null))
    diagnostics.push(
      lockDiag("DCS9109", "DCS policy digest does not match lockfile.", "/policy/digest"),
    );
  return Object.freeze(diagnostics);
}

function compareRecordArray(
  label: "extensions" | "inputs",
  expected: readonly JsonObject[],
  current: readonly JsonObject[],
  diagnostics: DcsDiagnostic[],
  keyFields: readonly string[],
): void {
  const expectedByKey = new Map(expected.map((entry) => [lockRecordKey(entry, keyFields), entry]));
  const currentByKey = new Map(current.map((entry) => [lockRecordKey(entry, keyFields), entry]));
  for (const key of [...new Set([...expectedByKey.keys(), ...currentByKey.keys()])].sort()) {
    const expectedEntry = expectedByKey.get(key);
    const currentEntry = currentByKey.get(key);
    if (expectedEntry === undefined) {
      diagnostics.push(
        lockDiag(
          label === "inputs" ? "DCS9107" : "DCS9108",
          `Current DCS ${label} contain an extra record ${key}.`,
          `/${label}`,
        ),
      );
      continue;
    }
    if (currentEntry === undefined) {
      diagnostics.push(
        lockDiag(
          label === "inputs" ? "DCS9107" : "DCS9108",
          `Current DCS ${label} are missing record ${key}.`,
          `/${label}`,
        ),
      );
      continue;
    }
    if (canonicalizeJson(expectedEntry) !== canonicalizeJson(currentEntry)) {
      diagnostics.push(
        lockDiag(
          label === "inputs" ? "DCS9107" : "DCS9108",
          `DCS ${label} record ${key} does not match lockfile.`,
          `/${label}`,
        ),
      );
    }
  }
}

function lockfileDifferences(
  expected: DcsLockfile,
  current: DcsLockfile,
): readonly DcsConfigLockDiffEntry[] {
  const output: DcsConfigLockDiffEntry[] = [];
  diffJson(expected as unknown as JsonValue, current as unknown as JsonValue, "", output);
  return Object.freeze(output);
}

function diffJson(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
  path: string,
  output: DcsConfigLockDiffEntry[],
): void {
  if (canonicalizeJsonOrAbsent(expected) === canonicalizeJsonOrAbsent(actual)) {
    return;
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      diffJson(expected[key], actual[key], `${path}/${escapePointer(key)}`, output);
    }
    return;
  }
  output.push({
    path,
    ...(actual === undefined ? {} : { actual }),
    ...(expected === undefined ? {} : { expected }),
  });
}

function canonicalizeJsonOrAbsent(value: JsonValue | undefined): string {
  return value === undefined ? "<absent>" : canonicalizeJson(value);
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined && !Array.isArray(value) && typeof value === "object" && value !== null
  );
}

function lockRecordKey(entry: JsonObject, fields: readonly string[]): string {
  return fields.map((field) => `${field}=${canonicalizeJson(entry[field] ?? "")}`).join("|");
}

function redactResolvedValue(bundle: ConfigContractBundle, value: JsonObject): JsonObject {
  let redacted = redactDcsSecretReferences(value) as JsonObject;
  for (const [pointer, metadata] of Object.entries(bundle.fields)) {
    if (metadata.secret) {
      redacted = setPointer(redacted, pointer, "<redacted>");
    }
  }
  return redacted;
}

function setPointer(root: JsonObject, pointer: string, value: JsonValue): JsonObject {
  if (pointer === "") {
    return cloneJsonValue(value) as JsonObject;
  }
  const clone = cloneJsonValue(root) as Record<string, JsonValue>;
  const segments = pointer.slice(1).split("/").map(unescapePointer);
  let current: Record<string, JsonValue> = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const next = current[segment];
    current[segment] = isPlainObject(next) ? cloneJsonValue(next) : {};
    current = current[segment] as Record<string, JsonValue>;
  }
  current[segments.at(-1)!] = value;
  return clone;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

async function contractDigest(bundle: ConfigContractBundle): Promise<string> {
  return `sha256:${await sha256Hex(`dcs-contract-lock-v0\u0000${canonicalizeJson(bundle as unknown as JsonObject)}`)}`;
}

async function lockfileDigest(lockfile: DcsLockfile): Promise<string> {
  return `sha256:${await sha256Hex(`dcs-lockfile-v0\u0000${canonicalizeJson(lockfile as unknown as JsonObject)}`)}`;
}

async function documentRevisionForText(text: string): Promise<DcsDocumentRevision> {
  return `sha256:${await sha256Hex(`dcs-document-v0\u0000${text}`)}`;
}

async function semanticRevisionForJson(document: JsonObject): Promise<DcsSemanticRevision> {
  return `sha256:${await sha256Hex(`dcs-semantic-v0\u0000${canonicalizeJson(document)}`)}`;
}

function lockDiag(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}
