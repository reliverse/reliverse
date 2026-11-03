import {
  canonicalizeJson,
  cloneJsonValue,
  getJsonPointer,
  isJsonArray,
  isJsonObject,
  type ConfigContractBundle,
  type DcsCollectionIdentity,
  type DcsEditorStaticValue,
  type DcsProfileName,
  type JsonObject,
  type JsonValue,
  type PersistentConfigScope,
  type DcsResolvedConfig,
} from "@reliverse/dcs-contract";

import {
  applyDcsDocumentPatch,
  createDcsEditorModel,
  type CreateDcsEditorModelOptions,
  type DcsDocumentOperation,
  type DcsDocumentPatch,
  type DcsEditorDocument,
  type DcsEditorModel,
} from "./editor";

export const DCS_EDITOR_SESSION_VERSION = "0.0.1" as const;
export const DCS_EDITOR_INVALIDATION_VERSION = "0.0.1" as const;

/**
 * Host-owned state for a config edit. It includes raw documents and MUST stay
 * on the trusted host when a document has secret references. Browser clients
 * receive `createDcsEditorSessionView()` instead.
 */
export interface DcsEditorSessionRevisions {
  readonly documentRevision: string;
  readonly effectiveRevision?: string;
  readonly semanticRevision?: string;
}

export interface DcsEditorSession {
  readonly $dcs: {
    readonly contract: ConfigContractBundle["$dcs"];
    readonly format: "dcs-editor-session";
    readonly version: typeof DCS_EDITOR_SESSION_VERSION;
  };
  /** Host-owned CCB used to validate/rebuild local editor state. */
  readonly bundle: ConfigContractBundle;
  readonly base: Required<Pick<DcsEditorDocument, "document" | "documentRevision">> &
    DcsEditorSessionRevisions;
  readonly document: JsonObject;
  readonly model: DcsEditorModel;
  /** Host-owned resolved state used for provenance until a local patch makes it stale. */
  readonly resolved?: DcsResolvedConfig;
  readonly patch: DcsDocumentPatch;
  /** Effective values are current only until the working document changes. */
  readonly resolutionState: "current" | "stale";
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}

/** Browser-safe session envelope. It intentionally omits raw documents. */
export interface DcsEditorSessionPatchSummary {
  readonly operationCount: number;
  readonly touchedPaths: readonly string[];
}

export interface DcsEditorSessionView {
  readonly $dcs: {
    readonly contract: ConfigContractBundle["$dcs"];
    readonly format: "dcs-editor-session-view";
    readonly version: typeof DCS_EDITOR_SESSION_VERSION;
  };
  readonly baseRevisions: DcsEditorSessionRevisions;
  /** Browser-safe model: raw documents, secret refs and host locations are omitted. */
  readonly model: DcsEditorModel;
  /** Metadata-only summary. Raw patch values remain in the trusted session. */
  readonly patch: DcsEditorSessionPatchSummary;
  readonly resolutionState: "current" | "stale";
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}

export interface CreateDcsEditorSessionOptions extends CreateDcsEditorModelOptions {}

export interface DcsEditorCollectionConflict {
  readonly baseIds: readonly DcsCollectionIdentity[];
  readonly identity?: string;
  readonly latestIds: readonly DcsCollectionIdentity[];
}

export interface DcsEditorDocumentConflict {
  readonly base: DcsEditorStaticValue;
  readonly latest: DcsEditorStaticValue;
  readonly collection?: DcsEditorCollectionConflict;
  readonly operation: DcsDocumentOperation;
  readonly path: string;
  readonly proposed: DcsEditorStaticValue;
  readonly reason: "collection-overlap" | "overlapping-change";
}

export type DcsDocumentRebaseResult =
  | {
      readonly changedPaths: readonly string[];
      readonly document: JsonObject;
      readonly kind: "rebased";
      readonly patch: DcsDocumentPatch;
    }
  | {
      readonly changedPaths: readonly string[];
      readonly conflicts: readonly DcsEditorDocumentConflict[];
      readonly kind: "conflict";
    };

export type DcsEditorInvalidationCause =
  | "contract-changed"
  | "document-changed"
  | "document-deleted";

/** A transport-neutral signal. File watching, SSE and WebSocket are adapters. */
export interface DcsEditorInvalidationEvent {
  readonly $dcs: {
    readonly format: "dcs-editor-invalidation";
    readonly version: typeof DCS_EDITOR_INVALIDATION_VERSION;
  };
  readonly cause: DcsEditorInvalidationCause;
  readonly documentRevision?: string;
  readonly effectiveRevision?: string;
  readonly location?: string;
  /** Explicit profile overlay affected by this event, if any. */
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
  readonly semanticRevision?: string;
}

export function createDcsEditorSession(input: CreateDcsEditorSessionOptions): DcsEditorSession {
  const documentRevision = input.document.documentRevision ?? input.document.revision;
  if (documentRevision === undefined) {
    throw new TypeError("DcsEditorDocument requires documentRevision.");
  }
  const baseDocument = cloneJsonValue(input.document.document);
  const base: DcsEditorSession["base"] = Object.freeze({
    document: baseDocument,
    documentRevision,
    ...(input.document.effectiveRevision === undefined
      ? {}
      : { effectiveRevision: input.document.effectiveRevision }),
    ...(input.document.semanticRevision === undefined
      ? {}
      : { semanticRevision: input.document.semanticRevision }),
  });
  const model = createDcsEditorModel(input);
  return Object.freeze({
    $dcs: Object.freeze({
      contract: Object.freeze({ ...input.bundle.$dcs }),
      format: "dcs-editor-session" as const,
      version: DCS_EDITOR_SESSION_VERSION,
    }),
    base,
    bundle: input.bundle,
    document: cloneJsonValue(baseDocument),
    model,
    ...(input.resolved === undefined ? {} : { resolved: input.resolved }),
    patch: Object.freeze({ operations: Object.freeze([]) }),
    resolutionState: "current" as const,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
  });
}

/** Applies edits locally. A host re-resolves before persisting the session. */
export function applyDcsEditorSessionPatch(
  session: DcsEditorSession,
  patch: DcsDocumentPatch,
): DcsEditorSession {
  if (patch.operations.length === 0) {
    return session;
  }
  const document = applyDcsDocumentPatch(session.document, patch);
  const model = createDcsEditorModel({
    bundle: session.bundle,
    document: {
      document,
      documentRevision: session.base.documentRevision,
      ...(session.base.semanticRevision === undefined
        ? {}
        : { semanticRevision: session.base.semanticRevision }),
    },
    ...(session.profile === undefined ? {} : { profile: session.profile }),
    ...(session.resolved === undefined ? {} : { resolved: session.resolved }),
    scope: session.scope,
  });
  return Object.freeze({
    ...session,
    document,
    model,
    patch: Object.freeze({
      operations: Object.freeze([...session.patch.operations, ...patch.operations]),
    }),
    resolutionState: "stale" as const,
  });
}

/**
 * Produces a safe payload for a browser or client renderer. Raw document data
 * remains inside the session host because it may contain secret references.
 */
export function createDcsEditorSessionView(session: DcsEditorSession): DcsEditorSessionView {
  return Object.freeze({
    $dcs: Object.freeze({
      contract: Object.freeze({ ...session.$dcs.contract }),
      format: "dcs-editor-session-view" as const,
      version: DCS_EDITOR_SESSION_VERSION,
    }),
    baseRevisions: Object.freeze({
      documentRevision: session.base.documentRevision,
      ...(session.base.effectiveRevision === undefined
        ? {}
        : { effectiveRevision: session.base.effectiveRevision }),
      ...(session.base.semanticRevision === undefined
        ? {}
        : { semanticRevision: session.base.semanticRevision }),
    }),
    model: browserSafeEditorModel(session.model),
    patch: Object.freeze({
      operationCount: session.patch.operations.length,
      touchedPaths: Object.freeze(
        [...new Set(session.patch.operations.map((operation) => operation.path))].sort(),
      ),
    }),
    resolutionState: session.resolutionState,
    ...(session.profile === undefined ? {} : { profile: session.profile }),
    scope: session.scope,
  });
}

function browserSafeEditorModel(model: DcsEditorModel): DcsEditorModel {
  const redactSource = <Source extends object>(source: Source): Source => {
    const safe = { ...source } as Record<string, unknown>;
    delete safe.location;
    return Object.freeze(safe) as Source;
  };
  const redactDiagnostic = (
    diagnostic: import("@reliverse/dcs-contract").DcsDiagnostic,
  ): import("@reliverse/dcs-contract").DcsDiagnostic => {
    if (diagnostic.source?.location === undefined) return diagnostic;
    return Object.freeze({
      ...diagnostic,
      source: Object.freeze({ kind: diagnostic.source.kind }),
    });
  };
  const redactProvenance = (
    provenance: import("@reliverse/dcs-contract").DcsFieldProvenance | undefined,
  ): import("@reliverse/dcs-contract").DcsFieldProvenance | undefined =>
    provenance === undefined
      ? undefined
      : Object.freeze({
          ...provenance,
          consideredSources: Object.freeze(
            provenance.consideredSources.map((entry) =>
              Object.freeze({
                ...entry,
                source: redactSource(entry.source),
              }),
            ),
          ),
          effectiveSource: redactSource(provenance.effectiveSource),
        });
  return Object.freeze({
    ...model,
    diagnostics: Object.freeze(model.diagnostics.map(redactDiagnostic)),
    extensions: Object.freeze(
      model.extensions.map((extension) =>
        Object.freeze({
          ...extension,
          diagnostics: Object.freeze(extension.diagnostics.map(redactDiagnostic)),
        }),
      ),
    ),
    fields: Object.freeze(
      model.fields.map((field) =>
        Object.freeze({
          ...field,
          diagnostics: Object.freeze(field.diagnostics.map(redactDiagnostic)),
          ...(field.effectiveSource === undefined
            ? {}
            : { effectiveSource: redactSource(field.effectiveSource) }),
          ...(field.provenance === undefined
            ? {}
            : { provenance: redactProvenance(field.provenance)! }),
        }),
      ),
    ),
  });
}

/**
 * Rebases an editor patch from a base document onto a latest document. DCS
 * auto-rebases only when changed paths do not overlap. It never picks a winner
 * for two edits of the same field.
 */
export function rebaseDcsDocumentPatch(input: {
  readonly baseDocument: JsonObject;
  readonly bundle: ConfigContractBundle;
  readonly latestDocument: JsonObject;
  readonly patch: DcsDocumentPatch;
}): DcsDocumentRebaseResult {
  const changedPaths = diffDcsDocumentPaths(input.baseDocument, input.latestDocument);
  const conflicts = input.patch.operations.flatMap((operation) => {
    const overlapping = changedPaths.some((path) => pointersOverlap(path, operation.path));
    if (!overlapping) {
      return [];
    }
    const collection = collectionConflict(
      input.bundle,
      input.baseDocument,
      input.latestDocument,
      operation,
    );
    return [
      Object.freeze({
        base: redactValue(
          input.bundle,
          operation.path,
          getJsonPointer(input.baseDocument, operation.path),
        ),
        latest: redactValue(
          input.bundle,
          operation.path,
          getJsonPointer(input.latestDocument, operation.path),
        ),
        operation: cloneOperation(operation),
        path: operation.path,
        proposed: proposedValue(input.bundle, input.baseDocument, operation),
        ...(collection === undefined ? {} : { collection }),
        reason:
          collection === undefined
            ? ("overlapping-change" as const)
            : ("collection-overlap" as const),
      }),
    ];
  });

  if (conflicts.length > 0) {
    return Object.freeze({
      changedPaths: Object.freeze(changedPaths),
      conflicts: Object.freeze(conflicts),
      kind: "conflict" as const,
    });
  }

  return Object.freeze({
    changedPaths: Object.freeze(changedPaths),
    document: applyDcsDocumentPatch(input.latestDocument, input.patch),
    kind: "rebased" as const,
    patch: freezePatch(input.patch),
  });
}

export function createDcsEditorInvalidationEvent(
  input: Omit<DcsEditorInvalidationEvent, "$dcs">,
): DcsEditorInvalidationEvent {
  return Object.freeze({
    $dcs: Object.freeze({
      format: "dcs-editor-invalidation" as const,
      version: DCS_EDITOR_INVALIDATION_VERSION,
    }),
    ...input,
  });
}

function proposedValue(
  bundle: ConfigContractBundle,
  baseDocument: JsonObject,
  operation: DcsDocumentOperation,
): DcsEditorStaticValue {
  const proposed = applyDcsDocumentPatch(baseDocument, { operations: [operation] });
  return redactValue(bundle, operation.path, getJsonPointer(proposed, operation.path));
}

function collectionConflict(
  bundle: ConfigContractBundle,
  baseDocument: JsonObject,
  latestDocument: JsonObject,
  operation: DcsDocumentOperation,
): DcsEditorCollectionConflict | undefined {
  if (operation.op !== "move-by-id" && operation.op !== "remove") {
    return undefined;
  }
  const identity = bundle.fields[operation.path]?.collection?.identity;
  if (identity === undefined) {
    return undefined;
  }
  return Object.freeze({
    baseIds: Object.freeze(collectionIds(getJsonPointer(baseDocument, operation.path), identity)),
    identity,
    latestIds: Object.freeze(
      collectionIds(getJsonPointer(latestDocument, operation.path), identity),
    ),
  });
}

function collectionIds(value: JsonValue | undefined, identity: string): DcsCollectionIdentity[] {
  if (!isJsonArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const candidate = getJsonPointer(item, identity);
    return typeof candidate === "string" || typeof candidate === "number" ? [candidate] : [];
  });
}

function redactValue(
  bundle: ConfigContractBundle,
  path: string,
  value: JsonValue | undefined,
): DcsEditorStaticValue {
  if (bundle.fields[path]?.secret === true && value !== undefined) {
    return { state: "redacted" };
  }
  return value === undefined
    ? { state: "absent" }
    : { state: "value", value: cloneJsonValue(value) };
}

function cloneOperation(operation: DcsDocumentOperation): DcsDocumentOperation {
  if (operation.op === "set") {
    return { op: "set", path: operation.path, value: cloneJsonValue(operation.value) };
  }
  if (operation.op === "move") {
    return { from: operation.from, op: "move", path: operation.path, to: operation.to };
  }
  if (operation.op === "move-by-id") {
    return {
      id: operation.id,
      ...(operation.before === undefined ? {} : { before: operation.before }),
      op: "move-by-id",
      path: operation.path,
    };
  }
  if (operation.op === "remove") {
    return { id: operation.id, op: "remove", path: operation.path };
  }
  return { op: operation.op, path: operation.path };
}

function freezePatch(patch: DcsDocumentPatch): DcsDocumentPatch {
  return Object.freeze({ operations: Object.freeze(patch.operations.map(cloneOperation)) });
}

function diffDcsDocumentPaths(base: JsonObject, latest: JsonObject): string[] {
  const paths = new Set<string>();
  diffJson(productFields(base), productFields(latest), "", paths);
  const baseResets = readResets(base);
  const latestResets = readResets(latest);
  for (const path of new Set([...baseResets, ...latestResets])) {
    if (baseResets.has(path) !== latestResets.has(path)) {
      paths.add(path);
    }
  }
  return [...paths].sort(comparePointers);
}

function productFields(document: JsonObject): JsonObject {
  const product: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(document)) {
    if (key !== "$dcs" && key !== "$extensions") {
      product[key] = value;
    }
  }
  return product;
}

function readResets(document: JsonObject): Set<string> {
  const envelope = document.$dcs;
  return isJsonObject(envelope) && isJsonArray(envelope.resets)
    ? new Set(envelope.resets.filter((entry): entry is string => typeof entry === "string"))
    : new Set();
}

function diffJson(
  base: JsonValue | undefined,
  latest: JsonValue | undefined,
  path: string,
  paths: Set<string>,
): void {
  if (canonicalizeJsonOrAbsent(base) === canonicalizeJsonOrAbsent(latest)) {
    return;
  }
  if (isJsonObject(base) && isJsonObject(latest)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(latest)]);
    for (const key of keys) {
      const child = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      diffJson(base[key], latest[key], child, paths);
    }
    return;
  }
  paths.add(path === "" ? "/" : path);
}

function canonicalizeJsonOrAbsent(value: JsonValue | undefined): string {
  return value === undefined ? "<absent>" : canonicalizeJson(value);
}

function pointersOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function comparePointers(left: string, right: string): number {
  const leftDepth = left.split("/").length;
  const rightDepth = right.split("/").length;
  return leftDepth - rightDepth || left.localeCompare(right);
}
