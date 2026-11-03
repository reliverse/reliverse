import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import process from "node:process";

import {
  applyJsoncEdits,
  canonicalizeJson,
  getJsonPointer,
  isJsonObject,
  parseConfigDocument,
  parseJsoncText,
  resolveConfigLayers,
  sha256Hex,
  type DcsConfigLayerSource,
  type DcsDiagnostic,
  type DcsDocumentSyntax,
  type DcsProfileName,
  type DcsResolutionLayer,
  type JsoncEdit,
  type ConfigContractBundle,
  type JsonObject,
  type JsonValue,
  type PersistentConfigScope,
} from "@reliverse/dcs-contract";

import {
  applyDcsDocumentPatch,
  createDcsConfigDocument,
  type DcsDocumentPatch,
  type DcsDocumentRevision,
  type DcsEffectiveRevision,
  type DcsSemanticRevision,
} from "../editor";
import {
  discoverConfigDocuments,
  effectiveConfigRevision,
  locateConfigVariants,
  locateProfileConfigVariants,
  type CanonicalConfigPathVariants,
  type DiscoverConfigDocumentsOptions,
} from "./discovery";

export interface ReadDcsConfigDocumentOptions extends DiscoverConfigDocumentsOptions {
  readonly scope: PersistentConfigScope;
}

export interface DcsConfigDocumentSnapshot {
  readonly document: JsonObject;
  /** Canonical byte-level revision. It changes for comments and formatting too. */
  readonly documentRevision: DcsDocumentRevision;
  readonly exists: boolean;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  /** @deprecated Use documentRevision. */
  readonly revision: DcsDocumentRevision;
  /** Parsed-data revision. Comment/format-only changes leave it stable. */
  readonly semanticRevision: DcsSemanticRevision;
  /** Explicit profile overlay selected for this document, if any. */
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}

export interface DcsConfigDocumentMutationOptions extends ReadDcsConfigDocumentOptions {
  readonly expectedRevision?: DcsDocumentRevision;
  readonly patch: DcsDocumentPatch;
}

/**
 * Host-only whole-document replacement used by declarative migrations. The
 * source bundle may be legacy while `bundle` validates the target document.
 */
export interface DcsConfigDocumentReplacementOptions extends ReadDcsConfigDocumentOptions {
  readonly document: JsonObject;
  readonly expectedRevision: DcsDocumentRevision;
  readonly sourceBundle?: ConfigContractBundle;
  /** Legacy multi-layer migrations cannot resolve target effective config until every layer migrated. */
  readonly skipEffectiveValidation?: boolean;
  /** Exact source text for restore. It is parsed and compared before commit. */
  readonly textOverride?: string;
}

export interface DcsInitializeConfigDocumentOptions extends ReadDcsConfigDocumentOptions {
  readonly force?: boolean;
  /** Relative or absolute editor-schema URI written as top-level $schema metadata. */
  readonly schema?: string;
}

export interface DcsConfigWriteResult extends DcsConfigDocumentSnapshot {
  /** Effective revision after the candidate layer is resolved successfully. */
  readonly effectiveRevision?: DcsEffectiveRevision;
  readonly previousRevision: DcsDocumentRevision;
}

export class DcsConfigDocumentValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];
  public readonly location: string;

  public constructor(location: string, diagnostics: readonly DcsDiagnostic[]) {
    super(`DCS configuration document at ${location} is invalid.`);
    this.name = "DcsConfigDocumentValidationError";
    this.diagnostics = diagnostics;
    this.location = location;
  }
}

export class DcsConfigWriteConflictError extends Error {
  public readonly actualRevision: DcsDocumentRevision;
  public readonly expectedRevision: DcsDocumentRevision;
  public readonly location: string;

  public constructor(input: {
    readonly actualRevision: DcsDocumentRevision;
    readonly expectedRevision: DcsDocumentRevision;
    readonly location: string;
  }) {
    super(
      `DCS configuration document changed before this write could be committed: ${input.location}.`,
    );
    this.name = "DcsConfigWriteConflictError";
    this.actualRevision = input.actualRevision;
    this.expectedRevision = input.expectedRevision;
    this.location = input.location;
  }
}

export class DcsConfigWriteExistsError extends Error {
  public readonly location: string;

  public constructor(location: string) {
    super(`DCS configuration document already exists: ${location}.`);
    this.name = "DcsConfigWriteExistsError";
    this.location = location;
  }
}

export class DcsConfigWriteLockError extends Error {
  public readonly location: string;

  public constructor(location: string) {
    super(`DCS configuration document remained locked too long: ${location}.`);
    this.name = "DcsConfigWriteLockError";
    this.location = location;
  }
}

export class DcsConfigDocumentFormatConflictError extends Error {
  public readonly jsonLocation: string;
  public readonly jsoncLocation: string;
  public readonly scope: PersistentConfigScope;

  public constructor(input: {
    readonly jsonLocation: string;
    readonly jsoncLocation: string;
    readonly scope: PersistentConfigScope;
  }) {
    super(
      `Both JSON and JSONC DCS documents exist for ${input.scope} scope. Select one syntax explicitly or remove the duplicate.`,
    );
    this.name = "DcsConfigDocumentFormatConflictError";
    this.jsonLocation = input.jsonLocation;
    this.jsoncLocation = input.jsoncLocation;
    this.scope = input.scope;
  }
}

interface InternalEditableDocument {
  readonly snapshot: DcsConfigDocumentSnapshot;
  readonly text?: string;
}

/**
 * Reads one editable persistent layer and issues both byte-level and semantic
 * revisions. JSONC comments remain part of documentRevision but not
 * semanticRevision.
 */
export async function readConfigDocumentForEdit(
  options: ReadDcsConfigDocumentOptions,
): Promise<DcsConfigDocumentSnapshot> {
  return (await readEditableDocument(options)).snapshot;
}

/** Creates a sparse contract-bound document in the requested JSON or JSONC syntax. */
export async function initializeConfigDocument(
  options: DcsInitializeConfigDocumentOptions,
): Promise<DcsConfigWriteResult> {
  const current = await readEditableDocument(options);
  if (current.snapshot.exists && options.force !== true) {
    throw new DcsConfigWriteExistsError(current.snapshot.location);
  }

  const next = createDcsConfigDocument(options.bundle, {
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.schema === undefined ? {} : { schema: options.schema }),
  });
  validateDocument(
    next,
    options.bundle,
    options.scope,
    current.snapshot.location,
    current.snapshot.format,
    options.extensionRegistry,
    options.profile,
  );
  const text = serializeNewDocument(next, current.snapshot.format);
  const effectiveRevision = await validateEffectiveCandidate({
    document: next,
    format: current.snapshot.format,
    location: current.snapshot.location,
    options,
  });
  return commitText({
    bundle: options.bundle,
    document: next,
    effectiveRevision,
    expectedRevision: current.snapshot.documentRevision,
    format: current.snapshot.format,
    location: current.snapshot.location,
    previousRevision: current.snapshot.documentRevision,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    scope: options.scope,
    text,
  });
}

/**
 * Applies a structured patch to one selected scope using optimistic concurrency.
 * Existing JSONC documents are edited node-by-node, preserving comments,
 * unrelated formatting, order, and trailing-comma style.
 */
export async function mutateConfigDocument(
  options: DcsConfigDocumentMutationOptions,
): Promise<DcsConfigWriteResult> {
  assertPatchTargets(options.bundle, options.patch);

  const current = await readEditableDocument(options);
  const expectedRevision = options.expectedRevision ?? current.snapshot.documentRevision;
  if (expectedRevision !== current.snapshot.documentRevision) {
    throw new DcsConfigWriteConflictError({
      actualRevision: current.snapshot.documentRevision,
      expectedRevision,
      location: current.snapshot.location,
    });
  }

  const next = applyDcsDocumentPatch(current.snapshot.document, options.patch);
  validateDocument(
    next,
    options.bundle,
    options.scope,
    current.snapshot.location,
    current.snapshot.format,
    options.extensionRegistry,
    options.profile,
  );
  const effectiveRevision = await validateEffectiveCandidate({
    document: next,
    format: current.snapshot.format,
    location: current.snapshot.location,
    options,
  });

  return withExclusiveDocumentLock(current.snapshot.location, async () => {
    const latest = await readEditableDocumentAt({
      bundle: options.bundle,
      ...(options.extensionRegistry === undefined
        ? {}
        : { extensionRegistry: options.extensionRegistry }),
      format: current.snapshot.format,
      location: current.snapshot.location,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      scope: options.scope,
    });
    if (latest.snapshot.documentRevision !== expectedRevision) {
      throw new DcsConfigWriteConflictError({
        actualRevision: latest.snapshot.documentRevision,
        expectedRevision,
        location: current.snapshot.location,
      });
    }

    const text =
      latest.text === undefined || latest.snapshot.format === "json"
        ? serializeNewDocument(next, latest.snapshot.format)
        : applyDcsPatchToSource({
            after: next,
            before: latest.snapshot.document,
            patch: options.patch,
            source: latest.text,
          });

    const parsedWritten = parseDocumentText(
      text,
      latest.snapshot.format,
      current.snapshot.location,
    );
    if (canonicalizeJson(parsedWritten) !== canonicalizeJson(next)) {
      throw new Error(
        "DCS JSONC writer produced a semantic document different from the requested patch.",
      );
    }

    return writeCommittedText({
      document: next,
      effectiveRevision,
      format: latest.snapshot.format,
      location: latest.snapshot.location,
      previousRevision: latest.snapshot.documentRevision,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      scope: latest.snapshot.scope,
      text,
    });
  });
}

/**
 * Replaces one document after validating it against the target bundle. JSONC
 * replacement is AST-addressed: only changed paths are touched, leaving
 * unrelated comments and layout intact. This is intentionally node-host only.
 */
export async function replaceConfigDocument(
  options: DcsConfigDocumentReplacementOptions,
): Promise<DcsConfigWriteResult> {
  const sourceOptions: ReadDcsConfigDocumentOptions = {
    ...options,
    bundle: options.sourceBundle ?? options.bundle,
  };
  const current = await readEditableDocument(sourceOptions);
  if (current.snapshot.documentRevision !== options.expectedRevision) {
    throw new DcsConfigWriteConflictError({
      actualRevision: current.snapshot.documentRevision,
      expectedRevision: options.expectedRevision,
      location: current.snapshot.location,
    });
  }

  validateDocument(
    options.document,
    options.bundle,
    options.scope,
    current.snapshot.location,
    current.snapshot.format,
    options.extensionRegistry,
    options.profile,
  );
  const effectiveRevision =
    options.skipEffectiveValidation === true
      ? undefined
      : await validateEffectiveCandidate({
          document: options.document,
          format: current.snapshot.format,
          location: current.snapshot.location,
          options,
        });

  return withExclusiveDocumentLock(current.snapshot.location, async () => {
    const latest = await readEditableDocumentAt({
      bundle: options.sourceBundle ?? options.bundle,
      ...(options.extensionRegistry === undefined
        ? {}
        : { extensionRegistry: options.extensionRegistry }),
      format: current.snapshot.format,
      location: current.snapshot.location,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      scope: options.scope,
    });
    if (latest.snapshot.documentRevision !== options.expectedRevision) {
      throw new DcsConfigWriteConflictError({
        actualRevision: latest.snapshot.documentRevision,
        expectedRevision: options.expectedRevision,
        location: current.snapshot.location,
      });
    }

    const text =
      options.textOverride ??
      (latest.text === undefined || latest.snapshot.format === "json"
        ? serializeNewDocument(options.document, latest.snapshot.format)
        : applyJsoncDocumentReplacement(latest.text, latest.snapshot.document, options.document));
    const parsedWritten = parseDocumentText(text, latest.snapshot.format, latest.snapshot.location);
    if (canonicalizeJson(parsedWritten) !== canonicalizeJson(options.document)) {
      throw new Error(
        "DCS replacement writer produced a semantic document different from the requested document.",
      );
    }
    return writeCommittedText({
      document: options.document,
      ...(effectiveRevision === undefined ? {} : { effectiveRevision }),
      format: latest.snapshot.format,
      location: latest.snapshot.location,
      previousRevision: latest.snapshot.documentRevision,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      scope: latest.snapshot.scope,
      text,
    });
  });
}

async function readEditableDocument(
  options: ReadDcsConfigDocumentOptions,
): Promise<InternalEditableDocument> {
  const variants =
    options.profile === undefined
      ? locateConfigVariants(options)
      : locateProfileConfigVariants(options, options.profile);
  const selection = await selectEditableLocation(variants, options.scope, options.format);
  return readEditableDocumentAt({
    bundle: options.bundle,
    ...(options.extensionRegistry === undefined
      ? {}
      : { extensionRegistry: options.extensionRegistry }),
    format: selection.format,
    location: selection.location,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    scope: options.scope,
  });
}

async function readEditableDocumentAt(input: {
  readonly bundle: ConfigContractBundle;
  readonly extensionRegistry?: import("@reliverse/dcs-contract").DcsExtensionRegistry;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}): Promise<InternalEditableDocument> {
  const loaded = await readDocumentBytes(input.location);
  if (!loaded.exists) {
    const document = createDcsConfigDocument(
      input.bundle,
      input.profile === undefined ? {} : { profile: input.profile },
    );
    const documentRevision = await missingRevision(input.location, input.format);
    const semanticRevision = await calculateSemanticRevision(document);
    return {
      snapshot: Object.freeze({
        document,
        documentRevision,
        exists: false,
        format: input.format,
        location: input.location,
        revision: documentRevision,
        ...(input.profile === undefined ? {} : { profile: input.profile }),
        scope: input.scope,
        semanticRevision,
      }),
    };
  }

  const document = parseDocumentText(loaded.text, input.format, input.location);
  validateDocument(
    document,
    input.bundle,
    input.scope,
    input.location,
    input.format,
    input.extensionRegistry,
    input.profile,
  );
  const documentRevision = await documentRevisionForText(loaded.text);
  const semantic = await calculateSemanticRevision(document);
  return {
    snapshot: Object.freeze({
      document,
      documentRevision,
      exists: true,
      format: input.format,
      location: input.location,
      revision: documentRevision,
      ...(input.profile === undefined ? {} : { profile: input.profile }),
      scope: input.scope,
      semanticRevision: semantic,
    }),
    text: loaded.text,
  };
}

async function selectEditableLocation(
  variants: CanonicalConfigPathVariants,
  scope: PersistentConfigScope,
  requestedFormat: DcsDocumentSyntax | undefined,
): Promise<{ readonly format: DcsDocumentSyntax; readonly location: string }> {
  if (requestedFormat !== undefined) {
    return { format: requestedFormat, location: variants[requestedFormat][scope] };
  }

  const json = variants.json[scope];
  const jsonc = variants.jsonc[scope];
  const [jsonExists, jsoncExists] = await Promise.all([fileExists(json), fileExists(jsonc)]);
  if (jsonExists && jsoncExists) {
    throw new DcsConfigDocumentFormatConflictError({
      jsonLocation: json,
      jsoncLocation: jsonc,
      scope,
    });
  }
  if (jsoncExists) {
    return { format: "jsonc", location: jsonc };
  }
  return { format: "json", location: json };
}

async function commitText(input: {
  readonly bundle: ConfigContractBundle;
  readonly document: JsonObject;
  readonly effectiveRevision?: DcsEffectiveRevision;
  readonly expectedRevision: DcsDocumentRevision;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  readonly previousRevision: DcsDocumentRevision;
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
  readonly text: string;
}): Promise<DcsConfigWriteResult> {
  return withExclusiveDocumentLock(input.location, async () => {
    const current = await readDocumentBytes(input.location);
    const actualRevision = current.exists
      ? await documentRevisionForText(current.text)
      : await missingRevision(input.location, input.format);
    if (actualRevision !== input.expectedRevision) {
      throw new DcsConfigWriteConflictError({
        actualRevision,
        expectedRevision: input.expectedRevision,
        location: input.location,
      });
    }
    return writeCommittedText(input);
  });
}

async function writeCommittedText(input: {
  readonly document: JsonObject;
  readonly effectiveRevision?: DcsEffectiveRevision;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  readonly previousRevision: DcsDocumentRevision;
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
  readonly text: string;
}): Promise<DcsConfigWriteResult> {
  await atomicWriteUtf8(input.location, input.text);
  const documentRevision = await documentRevisionForText(input.text);
  return Object.freeze({
    document: input.document,
    documentRevision,
    ...(input.effectiveRevision === undefined
      ? {}
      : { effectiveRevision: input.effectiveRevision }),
    exists: true,
    format: input.format,
    location: input.location,
    previousRevision: input.previousRevision,
    revision: documentRevision,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
    semanticRevision: await calculateSemanticRevision(input.document),
  });
}

async function validateEffectiveCandidate(input: {
  readonly document: JsonObject;
  readonly format: DcsDocumentSyntax;
  readonly location: string;
  readonly options: ReadDcsConfigDocumentOptions;
}): Promise<DcsEffectiveRevision> {
  const {
    bundle,
    env,
    homeDir,
    includeLocal,
    includeUser,
    includeWorkspace,
    platform,
    workspaceRoot,
  } = input.options;
  // A write format selects only the destination document. Other layers remain
  // auto-discovered so a user JSON config and workspace JSONC config can coexist.
  const discovery = await discoverConfigDocuments({
    bundle,
    ...(input.options.extensionRegistry === undefined
      ? {}
      : { extensionRegistry: input.options.extensionRegistry }),
    ...(env === undefined ? {} : { env }),
    ...(homeDir === undefined ? {} : { homeDir }),
    ...(includeLocal === undefined ? {} : { includeLocal }),
    ...(includeUser === undefined ? {} : { includeUser }),
    ...(includeWorkspace === undefined ? {} : { includeWorkspace }),
    ...(platform === undefined ? {} : { platform }),
    ...(input.options.profile === undefined ? {} : { profile: input.options.profile }),
    workspaceRoot,
  });
  const source = sourceForScope(input.options.scope, input.location, input.options.profile);
  const parsed = parseConfigDocument(input.document, {
    bundle,
    ...(input.options.extensionRegistry === undefined
      ? {}
      : { extensionRegistry: input.options.extensionRegistry }),
    ...(input.options.profile === undefined ? {} : { profile: input.options.profile }),
    scope: input.options.scope,
    syntax: input.format,
  });
  const diagnostics = [
    ...discovery.diagnostics,
    ...parsed.diagnostics.map((diagnostic) => ({ ...diagnostic, source })),
  ];
  const layers: DcsResolutionLayer[] = discovery.documents
    .filter((entry) => entry.location !== input.location)
    .map((entry) => entry.layer);
  if (parsed.document !== undefined) {
    layers.push({
      document: parsed.document,
      ...(input.options.profile === undefined ? {} : { profile: input.options.profile }),
      scope: input.options.scope,
      source,
    });
  }
  const resolved = resolveConfigLayers({ bundle, layers });
  diagnostics.push(...resolved.diagnostics);

  if (
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    resolved.resolved === undefined
  ) {
    throw new DcsConfigDocumentValidationError(input.location, diagnostics);
  }

  return effectiveConfigRevision(resolved.resolved);
}

function sourceForScope(
  scope: PersistentConfigScope,
  location: string,
  profile: DcsProfileName | undefined,
): DcsConfigLayerSource {
  const kind =
    profile === undefined
      ? scope === "local"
        ? "local-document"
        : scope === "user"
          ? "user-document"
          : "workspace-document"
      : scope === "local"
        ? "local-profile-document"
        : scope === "user"
          ? "user-profile-document"
          : "workspace-profile-document";
  return { kind, location, ...(profile === undefined ? {} : { profile }) };
}

function applyDcsPatchToSource(input: {
  readonly after: JsonObject;
  readonly before: JsonObject;
  readonly patch: DcsDocumentPatch;
  readonly source: string;
}): string {
  const edits: JsoncEdit[] = [];
  for (const operation of input.patch.operations) {
    if (operation.op === "set") {
      edits.push({ op: "set", path: operation.path, value: operation.value });
      continue;
    }
    if (operation.op === "move") {
      const value = getJsonPointer(input.after, operation.path);
      if (value === undefined) {
        throw new Error(
          `DCS move target ${operation.path} disappeared while preparing JSONC edits.`,
        );
      }
      edits.push({ op: "set", path: operation.path, value });
      continue;
    }
    if (operation.op === "unset" || operation.op === "reset") {
      edits.push({ op: "delete", path: operation.path });
    }
  }
  // Envelope directives (resets, collection removals and identity moves) are
  // diffed structurally so JSONC comments outside the touched directive survive.
  edits.push(...diffJsoncDocument(input.before.$dcs, input.after.$dcs, "/$dcs"));
  return applyJsoncEdits(input.source, dedupeJsoncEdits(edits)).text;
}

function dedupeJsoncEdits(edits: readonly JsoncEdit[]): JsoncEdit[] {
  const byPath = new Map<string, JsoncEdit>();
  for (const edit of edits) {
    byPath.set(edit.path, edit);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function applyJsoncDocumentReplacement(
  source: string,
  before: JsonObject,
  after: JsonObject,
): string {
  return applyJsoncEdits(source, diffJsoncDocument(before, after, "")).text;
}

function diffJsoncDocument(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: string,
): JsoncEdit[] {
  if (canonicalizeJsonOrAbsent(before) === canonicalizeJsonOrAbsent(after)) {
    return [];
  }
  if (isJsonObject(before) && isJsonObject(after)) {
    const edits: JsoncEdit[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      edits.push(...diffJsoncDocument(before[key], after[key], childPath));
    }
    return edits;
  }
  if (path === "") {
    throw new TypeError("DCS document replacement requires an object root.");
  }
  return after === undefined ? [{ op: "delete", path }] : [{ op: "set", path, value: after }];
}

function canonicalizeJsonOrAbsent(value: JsonValue | undefined): string {
  return value === undefined ? "<absent>" : canonicalizeJson(value);
}

function serializeNewDocument(document: JsonObject, format: DcsDocumentSyntax): string {
  // Empty JSONC and JSON documents share valid JSON syntax. Comments become
  // user-authored after initialization; DCS never injects decorative comments.
  void format;
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parseDocumentText(text: string, format: DcsDocumentSyntax, location: string): JsonObject {
  if (format === "jsonc") {
    const parsed = parseJsoncText(text);
    if (parsed.ok && parsed.parsed !== undefined && isJsonObject(parsed.parsed.value)) {
      return parsed.parsed.value;
    }
    throw new DcsConfigDocumentValidationError(location, [
      {
        code: "DCS2001",
        message: `Unable to parse JSONC configuration document${parsed.error === undefined ? "." : `: ${parsed.error.message} at byte ${parsed.error.offset}.`}`,
        severity: "error",
      },
    ]);
  }

  try {
    const value: unknown = JSON.parse(text);
    if (isJsonObject(value)) {
      return value;
    }
  } catch {
    // Use a structured diagnostic below rather than leaking parser internals.
  }
  throw new DcsConfigDocumentValidationError(location, [
    {
      code: "DCS2001",
      message: "Unable to parse JSON configuration document.",
      severity: "error",
    },
  ]);
}

function validateDocument(
  document: JsonObject,
  bundle: ConfigContractBundle,
  scope: PersistentConfigScope,
  location: string,
  syntax: DcsDocumentSyntax,
  extensionRegistry?: import("@reliverse/dcs-contract").DcsExtensionRegistry,
  profile?: DcsProfileName,
): void {
  const parsed = parseConfigDocument(document, {
    bundle,
    ...(extensionRegistry === undefined ? {} : { extensionRegistry }),
    ...(profile === undefined ? {} : { profile }),
    scope,
    syntax,
  });
  if (!parsed.ok) {
    throw new DcsConfigDocumentValidationError(location, parsed.diagnostics);
  }
}

function assertPatchTargets(bundle: ConfigContractBundle, patch: DcsDocumentPatch): void {
  if (patch.operations.length === 0) {
    throw new TypeError("DCS document patch must contain at least one operation.");
  }

  for (const operation of patch.operations) {
    const metadata = bundle.fields[operation.path];
    if (metadata === undefined) {
      throw new TypeError(`DCS document patch targets an undeclared field: ${operation.path}.`);
    }
    if (
      (operation.op === "remove" || operation.op === "move-by-id") &&
      ((metadata.merge !== "keyed" && metadata.merge !== "unique") ||
        metadata.collection?.identity === undefined)
    ) {
      throw new TypeError(
        `DCS ${operation.op} requires an identity-aware keyed or unique collection field: ${operation.path}.`,
      );
    }
  }
}

async function readDocumentBytes(
  location: string,
): Promise<{ readonly exists: false } | { readonly exists: true; readonly text: string }> {
  try {
    return { exists: true, text: await readFile(location, "utf8") };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false };
    }
    throw error;
  }
}

async function documentRevisionForText(text: string): Promise<DcsDocumentRevision> {
  return `sha256:${await sha256Hex(`dcs-document-v0\u0000${text}`)}`;
}

async function calculateSemanticRevision(document: JsonObject): Promise<DcsSemanticRevision> {
  return `sha256:${await sha256Hex(`dcs-semantic-v0\u0000${canonicalizeJson(document)}`)}`;
}

async function missingRevision(
  location: string,
  format: DcsDocumentSyntax,
): Promise<DcsDocumentRevision> {
  return `sha256:${await sha256Hex(`dcs-document-missing-v0\u0000${format}\u0000${location}`)}`;
}

async function withExclusiveDocumentLock<Result>(
  location: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const directory = dirname(location);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(location)}.dcs.lock`);
  const deadline = Date.now() + 2_000;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new DcsConfigWriteLockError(location);
      }
      await pause(20);
    }
  }

  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function atomicWriteUtf8(location: string, text: string): Promise<void> {
  const directory = dirname(location);
  await mkdir(directory, { recursive: true });

  const temporary = join(
    directory,
    `.${basename(location)}.dcs-${process.pid}-${randomUUID()}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, location);
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function fileExists(location: string): Promise<boolean> {
  try {
    await readFile(location, "utf8");
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
