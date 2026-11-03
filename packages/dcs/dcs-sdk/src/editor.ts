import {
  cloneJsonValue,
  createDcsEditorDescriptor,
  deleteJsonObjectPointer,
  getJsonPointer,
  hasJsonPointer,
  isJsonArray,
  isJsonObject,
  redactDcsSecretReferences,
  parseConfigDocument,
  setJsonObjectPointer,
  type ConfigContractBundle,
  type DcsCollectionIdentity,
  type DcsDiagnostic,
  type DcsEditorDescriptor,
  type DcsEditorStaticValue,
  type DcsExtensionPresentation,
  type DcsExtensionRegistry,
  type DcsEffectiveConfigSource,
  type DcsFieldMetadata,
  type DcsProfileName,
  type DcsCollectionMove,
  type DcsFieldProvenance,
  type DcsResolvedConfig,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type PersistentConfigScope,
} from "@reliverse/dcs-contract";

/**
 * Opaque document revision issued by a host adapter. A revision represents the
 * original document bytes, not merely the resolved effective configuration.
 */
export type DcsDocumentRevision = string;
/** Hash of parsed document data. Formatting/comment-only edits do not change it. */
export type DcsSemanticRevision = string;
/** Hash of the resolved runtime configuration after defaults and layers. */
export type DcsEffectiveRevision = string;

export interface DcsConfigRevisions {
  readonly documentRevision: DcsDocumentRevision;
  readonly effectiveRevision?: DcsEffectiveRevision;
  readonly semanticRevision: DcsSemanticRevision;
}

/**
 * Framework-neutral document edit vocabulary. It deliberately contains no DOM,
 * component, HTTP, or filesystem notions, so a CLI, server action, and browser
 * editor can all describe the same intent.
 */
export type DcsDocumentOperation =
  | {
      /** Legacy positional move. Identity-based moves are preferred for collection fields. */
      readonly from: number;
      readonly op: "move";
      readonly path: string;
      readonly to: number;
    }
  | {
      readonly before?: DcsCollectionIdentity;
      readonly id: DcsCollectionIdentity;
      readonly op: "move-by-id";
      readonly path: string;
    }
  | {
      readonly id: DcsCollectionIdentity;
      readonly op: "remove";
      readonly path: string;
    }
  | {
      readonly op: "reset";
      readonly path: string;
    }
  | {
      readonly op: "set";
      readonly path: string;
      readonly value: JsonValue;
    }
  | {
      readonly op: "unset";
      readonly path: string;
    };

export interface DcsDocumentPatch {
  readonly operations: readonly DcsDocumentOperation[];
}

/**
 * Small host-neutral data shape for future form and drag-and-drop editors.
 * A server host supplies the revision and current raw document; a renderer must
 * submit it back as `expectedRevision` instead of blindly overwriting a file.
 */
export interface DcsEditorDocument {
  readonly document: JsonObject;
  /** Canonical byte-level revision to send back with a save operation. */
  readonly documentRevision?: DcsDocumentRevision;
  readonly effectiveRevision?: DcsEffectiveRevision;
  /** @deprecated Use documentRevision. Retained during DCS 0.0.x migration. */
  readonly revision?: DcsDocumentRevision;
  readonly semanticRevision?: DcsSemanticRevision;
}

export function createDcsConfigDocument(
  bundle: ConfigContractBundle,
  options: { readonly profile?: DcsProfileName; readonly schema?: string } = {},
): JsonObject {
  return {
    ...(options.schema === undefined ? {} : { $schema: options.schema }),
    $dcs: {
      contractVersion: bundle.$dcs.contractVersion,
      documentVersion: bundle.$dcs.documentVersion,
      id: bundle.$dcs.id,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    },
  };
}

export function createDcsConfigDocumentSchema(bundle: ConfigContractBundle): JsonSchema {
  const sparseProductSchema = createSparseConfigObjectSchema(bundle.schema, bundle.fields);
  const productProperties = isJsonObject(sparseProductSchema.properties)
    ? sparseProductSchema.properties
    : {};
  const { required: _effectiveRequired, ...documentSchema } = sparseProductSchema;
  return {
    ...documentSchema,
    properties: {
      $schema: {
        type: "string",
        minLength: 1,
        description:
          "Relative or absolute URI for the editor schema associated with this config document.",
      },
      $dcs: {
        type: "object",
        additionalProperties: true,
        description: "Define Config Standard document envelope.",
        properties: {
          id: { type: "string", const: bundle.$dcs.id },
          contractVersion: { type: "integer", const: bundle.$dcs.contractVersion },
          documentVersion: { type: "integer", const: bundle.$dcs.documentVersion },
          profile: { type: "string" },
          resets: { type: "array", items: { type: "string" } },
        },
      },
      $extensions: {
        type: "object",
        additionalProperties: true,
        description: "Opaque DCS extension documents validated by their own contracts.",
      },
      ...productProperties,
    },
  };
}

function createSparseConfigObjectSchema(
  schema: JsonSchema,
  fields: Readonly<Record<string, DcsFieldMetadata>>,
  pointer = "",
): JsonSchema {
  const result = { ...cloneJsonValue(schema) } as Record<string, JsonValue>;
  if (result.type !== "object") return result;

  delete result.required;
  if (!isJsonObject(result.properties)) return result;
  const properties: Record<string, JsonValue> = { ...result.properties };
  for (const [name, property] of Object.entries(properties)) {
    if (!isJsonObject(property) || property.type !== "object") continue;
    const childPointer = `${pointer}/${escapePointerSegment(name)}`;
    if (fields[childPointer]?.merge !== "deep") continue;
    properties[name] = createSparseConfigObjectSchema(property, fields, childPointer);
  }
  return { ...result, properties };
}

export function applyDcsDocumentPatch(document: JsonObject, patch: DcsDocumentPatch): JsonObject {
  let result = cloneJsonValue(document);

  for (const operation of patch.operations) {
    result = applyOperation(result, operation);
  }

  return result;
}

function applyOperation(document: JsonObject, operation: DcsDocumentOperation): JsonObject {
  assertProductPointer(operation.path);

  switch (operation.op) {
    case "set": {
      const next = setJsonObjectPointer(document, operation.path, operation.value);
      return setResets(next, removeOverlappingResets(readResets(next), operation.path));
    }
    case "unset": {
      const next = deleteJsonObjectPointer(document, operation.path);
      return setResets(next, removeOverlappingResets(readResets(next), operation.path));
    }
    case "move": {
      const current = getJsonPointer(document, operation.path);
      if (!isJsonArray(current)) {
        throw new TypeError(`DCS move target ${operation.path} must be an array field.`);
      }
      if (
        !Number.isInteger(operation.from) ||
        !Number.isInteger(operation.to) ||
        operation.from < 0 ||
        operation.to < 0 ||
        operation.from >= current.length ||
        operation.to >= current.length
      ) {
        throw new RangeError(
          `DCS move indexes for ${operation.path} must reference existing array items.`,
        );
      }
      const items = [...current];
      const [item] = items.splice(operation.from, 1);
      items.splice(operation.to, 0, item!);
      const next = setJsonObjectPointer(document, operation.path, items);
      return setResets(next, removeOverlappingResets(readResets(next), operation.path));
    }
    case "remove": {
      const next = setCollectionRemovals(document, operation.path, [
        ...readCollectionRemovals(document, operation.path),
        operation.id,
      ]);
      return removeCollectionMoves(next, operation.path, operation.id);
    }
    case "move-by-id": {
      const prior = readCollectionMoves(document, operation.path).filter(
        (move) => !collectionIdentityEquals(move.id, operation.id),
      );
      return setCollectionMoves(document, operation.path, [
        ...prior,
        {
          id: operation.id,
          ...(operation.before === undefined ? {} : { before: operation.before }),
        },
      ]);
    }
    case "reset": {
      const next = deleteJsonObjectPointer(document, operation.path);
      const reset = setResets(next, [
        ...removeOverlappingResets(readResets(next), operation.path),
        operation.path,
      ]);
      return clearOverlappingCollectionDirectives(reset, operation.path);
    }
  }
}

function assertProductPointer(path: string): void {
  if (path === "" || !path.startsWith("/") || path.startsWith("/$")) {
    throw new TypeError("DCS document operations require a non-reserved, non-root JSON Pointer.");
  }
}

function readResets(document: JsonObject): readonly string[] {
  const envelope = document.$dcs;
  if (!isJsonObject(envelope) || !isJsonArray(envelope.resets)) {
    return [];
  }

  return envelope.resets.filter((value): value is string => typeof value === "string");
}

function setResets(document: JsonObject, resets: readonly string[]): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const currentEnvelope = isJsonObject(next.$dcs) ? next.$dcs : {};
  const envelope: Record<string, JsonValue> = { ...currentEnvelope };

  if (resets.length === 0) {
    delete envelope.resets;
  } else {
    envelope.resets = [...new Set(resets)].sort();
  }

  next.$dcs = envelope;
  return next;
}

function removeOverlappingResets(resets: readonly string[], target: string): readonly string[] {
  return resets.filter((candidate) => !pointersOverlap(candidate, target));
}

function pointersOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function readCollectionRemovals(
  document: JsonObject,
  path: string,
): readonly DcsCollectionIdentity[] {
  const envelope = document.$dcs;
  if (!isJsonObject(envelope) || !isJsonObject(envelope.collectionRemovals)) {
    return [];
  }
  const entries = envelope.collectionRemovals[path];
  return isJsonArray(entries)
    ? entries.filter(
        (entry): entry is DcsCollectionIdentity =>
          typeof entry === "string" || typeof entry === "number",
      )
    : [];
}

function readCollectionMoves(document: JsonObject, path: string): readonly DcsCollectionMove[] {
  const envelope = document.$dcs;
  if (!isJsonObject(envelope) || !isJsonObject(envelope.collectionMoves)) {
    return [];
  }
  const entries = envelope.collectionMoves[path];
  if (!isJsonArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) =>
    isJsonObject(entry) &&
    (typeof entry.id === "string" || typeof entry.id === "number") &&
    (entry.before === undefined ||
      typeof entry.before === "string" ||
      typeof entry.before === "number")
      ? [{ id: entry.id, ...(entry.before === undefined ? {} : { before: entry.before }) }]
      : [],
  );
}

function setCollectionRemovals(
  document: JsonObject,
  path: string,
  identities: readonly DcsCollectionIdentity[],
): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const envelope = isJsonObject(next.$dcs) ? ({ ...next.$dcs } as Record<string, JsonValue>) : {};
  const all = isJsonObject(envelope.collectionRemovals)
    ? ({ ...envelope.collectionRemovals } as Record<string, JsonValue>)
    : {};
  all[path] = [
    ...new Map(identities.map((id) => [`${typeof id}:${String(id)}`, id] as const)).values(),
  ];
  envelope.collectionRemovals = all;
  next.$dcs = envelope;
  return next;
}

function setCollectionMoves(
  document: JsonObject,
  path: string,
  moves: readonly DcsCollectionMove[],
): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const envelope = isJsonObject(next.$dcs) ? ({ ...next.$dcs } as Record<string, JsonValue>) : {};
  const all = isJsonObject(envelope.collectionMoves)
    ? ({ ...envelope.collectionMoves } as Record<string, JsonValue>)
    : {};
  if (moves.length === 0) {
    delete all[path];
  } else {
    all[path] = moves.map((move) => ({
      id: move.id,
      ...(move.before === undefined ? {} : { before: move.before }),
    }));
  }
  if (Object.keys(all).length === 0) {
    delete envelope.collectionMoves;
  } else {
    envelope.collectionMoves = all;
  }
  next.$dcs = envelope;
  return next;
}

function removeCollectionMoves(
  document: JsonObject,
  path: string,
  id: DcsCollectionIdentity,
): JsonObject {
  return setCollectionMoves(
    document,
    path,
    readCollectionMoves(document, path).filter(
      (move) =>
        !collectionIdentityEquals(move.id, id) && !collectionIdentityEquals(move.before, id),
    ),
  );
}

function clearOverlappingCollectionDirectives(document: JsonObject, target: string): JsonObject {
  const next = cloneJsonValue(document) as Record<string, JsonValue>;
  const envelope = isJsonObject(next.$dcs) ? ({ ...next.$dcs } as Record<string, JsonValue>) : {};
  for (const key of ["collectionRemovals", "collectionMoves"] as const) {
    if (!isJsonObject(envelope[key])) {
      continue;
    }
    const map = { ...envelope[key] } as Record<string, JsonValue>;
    for (const path of Object.keys(map)) {
      if (pointersOverlap(path, target)) {
        delete map[path];
      }
    }
    if (Object.keys(map).length === 0) {
      delete envelope[key];
    } else {
      envelope[key] = map;
    }
  }
  next.$dcs = envelope;
  return next;
}

function collectionIdentityEquals(
  left: DcsCollectionIdentity | undefined,
  right: DcsCollectionIdentity | undefined,
): boolean {
  return (
    left !== undefined && right !== undefined && typeof left === typeof right && left === right
  );
}

export type DcsEditorFieldState = "inherited" | "overridden" | "reset";

export interface DcsEditorField {
  readonly children: readonly string[];
  readonly control: string;
  readonly defaultValue: DcsEditorStaticValue;
  readonly depth: number;
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly documentValue: DcsEditorStaticValue;
  readonly editable: boolean;
  readonly effectiveSource?: DcsEffectiveConfigSource;
  readonly effectiveValue: DcsEditorStaticValue;
  readonly group: string;
  readonly label: string;
  readonly metadata: DcsFieldMetadata;
  readonly parentPath?: string;
  readonly path: string;
  readonly provenance?: DcsFieldProvenance;
  readonly schema: JsonSchema;
  readonly state: DcsEditorFieldState;
}

export interface DcsEditorGroup {
  readonly fields: readonly string[];
  readonly id: string;
  readonly label: string;
  readonly order: number;
}

/**
 * Renderer-safe extension namespace descriptor. Unknown namespaces stay visible
 * and preserved but are intentionally read-only until a local contract exists.
 */
export interface DcsEditorExtension {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly editable: boolean;
  readonly extensionVersion?: number;
  readonly id: string;
  readonly known: boolean;
  readonly presentation?: DcsExtensionPresentation;
  readonly schema?: JsonSchema;
  readonly value: DcsEditorStaticValue;
}

export interface DcsEditorModel {
  readonly $dcs: {
    readonly contract: ConfigContractBundle["$dcs"];
    readonly format: "dcs-editor-model";
    readonly version: "0.0.1";
  };
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly documentRevision: DcsDocumentRevision;
  readonly effectiveRevision?: DcsEffectiveRevision;
  readonly extensions: readonly DcsEditorExtension[];
  readonly fields: readonly DcsEditorField[];
  readonly groups: readonly DcsEditorGroup[];
  /** Explicit selected profile for this editable overlay, if any. */
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
  readonly semanticRevision?: DcsSemanticRevision;
}

export interface CreateDcsEditorModelOptions {
  readonly bundle: ConfigContractBundle;
  readonly descriptor?: DcsEditorDescriptor;
  readonly diagnostics?: readonly DcsDiagnostic[];
  readonly document: DcsEditorDocument;
  /** Locally supplied extension contracts; unknown namespaces remain opaque. */
  readonly extensionRegistry?: DcsExtensionRegistry;
  readonly resolved?: DcsResolvedConfig;
  /** The explicit profile overlay represented by this editor model. */
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}

/**
 * Creates a framework-neutral, redaction-aware form model for one selected
 * document layer. The model exposes no filesystem handles and never includes
 * raw secret-reference values, so it is safe to serialize for a browser host.
 */
export function createDcsEditorModel(input: CreateDcsEditorModelOptions): DcsEditorModel {
  const descriptor = input.descriptor ?? createDcsEditorDescriptor(input.bundle);
  const parsed = parseConfigDocument(input.document.document, {
    bundle: input.bundle,
    ...(input.extensionRegistry === undefined
      ? {}
      : { extensionRegistry: input.extensionRegistry }),
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
  });
  const diagnostics = Object.freeze([...(input.diagnostics ?? []), ...parsed.diagnostics]);
  const product = parsed.document?.product ?? {};
  const resets = parsed.document?.envelope.resets ?? [];
  const extensions = createEditorExtensions({
    diagnostics,
    extensions: parsed.document?.extensions ?? {},
    ...(input.extensionRegistry === undefined ? {} : { registry: input.extensionRegistry }),
  });
  const fieldPaths = new Set(descriptor.fields.map((field) => field.path));
  const childrenByParent = new Map<string, string[]>();

  const fields = descriptor.fields.map((descriptorField) => {
    const parentPath = findParentPath(descriptorField.path, fieldPaths);
    if (parentPath !== undefined) {
      const children = childrenByParent.get(parentPath) ?? [];
      children.push(descriptorField.path);
      childrenByParent.set(parentPath, children);
    }

    return createEditorField({
      descriptorField,
      diagnostics,
      product,
      resets,
      ...(input.resolved === undefined ? {} : { resolved: input.resolved }),
      scope: input.scope,
      ...(parentPath === undefined ? {} : { parentPath }),
    });
  });

  const fieldsWithChildren = fields
    .map((field) =>
      Object.freeze({
        ...field,
        children: Object.freeze(
          [...(childrenByParent.get(field.path) ?? [])].sort(compareFieldsByPath),
        ),
      }),
    )
    .sort(compareEditorFields);
  const groups = buildGroups(fieldsWithChildren);

  const documentRevision = input.document.documentRevision ?? input.document.revision;
  if (documentRevision === undefined) {
    throw new TypeError("DcsEditorDocument requires documentRevision.");
  }

  return Object.freeze({
    $dcs: Object.freeze({
      contract: Object.freeze({ ...input.bundle.$dcs }),
      format: "dcs-editor-model" as const,
      version: "0.0.1" as const,
    }),
    diagnostics,
    documentRevision,
    ...(input.document.effectiveRevision === undefined
      ? {}
      : { effectiveRevision: input.document.effectiveRevision }),
    extensions,
    fields: Object.freeze(fieldsWithChildren),
    groups,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    scope: input.scope,
    ...(input.document.semanticRevision === undefined
      ? {}
      : { semanticRevision: input.document.semanticRevision }),
  });
}

function createEditorExtensions(input: {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly extensions: JsonObject;
  readonly registry?: DcsExtensionRegistry;
}): readonly DcsEditorExtension[] {
  return Object.freeze(
    Object.entries(input.extensions)
      .map(([id, value]) => {
        const contract = input.registry?.contracts[id];
        const path = `/$extensions/${escapePointerSegment(id)}`;
        return Object.freeze({
          diagnostics: Object.freeze(
            input.diagnostics.filter((diagnostic) => touchesPath(diagnostic.path, path)),
          ),
          editable: contract !== undefined,
          ...(contract === undefined ? {} : { extensionVersion: contract.$dcs.extensionVersion }),
          id,
          known: contract !== undefined,
          ...(contract?.presentation === undefined ? {} : { presentation: contract.presentation }),
          ...(contract === undefined ? {} : { schema: contract.schema }),
          value: { state: "value" as const, value: redactExtensionValue(value) },
        });
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function redactExtensionValue(value: JsonValue): JsonValue {
  return redactDcsSecretReferences(value);
}

function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function createEditorField(input: {
  readonly descriptorField: DcsEditorDescriptor["fields"][number];
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly parentPath?: string;
  readonly product: JsonObject;
  readonly resets: readonly string[];
  readonly resolved?: DcsResolvedConfig;
  /** The explicit profile overlay represented by this editor model. */
  readonly profile?: DcsProfileName;
  readonly scope: PersistentConfigScope;
}): Omit<DcsEditorField, "children"> {
  const { descriptorField } = input;
  const metadata = descriptorField.metadata;
  const documentHasValue = hasJsonPointer(input.product, descriptorField.path);
  const reset =
    !documentHasValue &&
    input.resets.some((candidate) => resetsPath(candidate, descriptorField.path));
  const state: DcsEditorFieldState = documentHasValue
    ? "overridden"
    : reset
      ? "reset"
      : "inherited";
  const effective =
    input.resolved === undefined
      ? descriptorField.defaultValue
      : toEditorValue(
          metadata,
          hasJsonPointer(input.resolved.value, descriptorField.path)
            ? getJsonPointer(input.resolved.value, descriptorField.path)
            : undefined,
        );
  const provenance = input.resolved?.provenance[descriptorField.path];

  return {
    control: metadata.presentation?.control ?? inferControl(descriptorField.schema),
    defaultValue: descriptorField.defaultValue,
    depth: descriptorField.path.split("/").length - 1,
    diagnostics: Object.freeze(
      input.diagnostics.filter((diagnostic) => touchesPath(diagnostic.path, descriptorField.path)),
    ),
    documentValue: documentHasValue
      ? toEditorValue(metadata, getJsonPointer(input.product, descriptorField.path))
      : { state: "absent" },
    editable: metadata.scopes.includes(input.scope),
    ...(provenance === undefined
      ? {}
      : { effectiveSource: provenance.effectiveSource, provenance }),
    effectiveValue: effective,
    group: metadata.presentation?.group ?? "General",
    label: metadata.presentation?.label ?? labelFromPointer(descriptorField.path),
    metadata,
    ...(input.parentPath === undefined ? {} : { parentPath: input.parentPath }),
    path: descriptorField.path,
    schema: descriptorField.schema,
    state,
  };
}

function toEditorValue(
  metadata: DcsFieldMetadata,
  value: JsonValue | undefined,
): DcsEditorStaticValue {
  if (metadata.secret === true && value !== undefined) {
    return { state: "redacted" };
  }

  return value === undefined
    ? { state: "absent" }
    : { state: "value", value: cloneJsonValue(value) };
}

function findParentPath(path: string, candidates: ReadonlySet<string>): string | undefined {
  const segments = path.split("/").slice(1);
  while (segments.length > 1) {
    segments.pop();
    const candidate = `/${segments.join("/")}`;
    if (candidates.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function buildGroups(fields: readonly DcsEditorField[]): readonly DcsEditorGroup[] {
  const groups = new Map<string, { label: string; order: number; fields: string[] }>();
  for (const field of fields) {
    const group = field.group;
    const existing = groups.get(group);
    const order = field.metadata.presentation?.order ?? Number.MAX_SAFE_INTEGER;
    if (existing === undefined) {
      groups.set(group, { fields: [field.path], label: group, order });
    } else {
      existing.fields.push(field.path);
      existing.order = Math.min(existing.order, order);
    }
  }

  return Object.freeze(
    [...groups.entries()]
      .map(([id, group]) =>
        Object.freeze({
          fields: Object.freeze([...group.fields].sort(compareFieldsByPath)),
          id,
          label: group.label,
          order: group.order,
        }),
      )
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
  );
}

function inferControl(schema: JsonSchema): string {
  if (Array.isArray(schema.enum)) {
    return "select";
  }
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type];
  if (types.includes("boolean")) {
    return "checkbox";
  }
  if (types.includes("number") || types.includes("integer")) {
    return "number";
  }
  if (types.includes("string")) {
    return "text";
  }
  return "auto";
}

function touchesPath(diagnosticPath: string | undefined, fieldPath: string): boolean {
  if (diagnosticPath === undefined || diagnosticPath === "") {
    return true;
  }
  return (
    diagnosticPath === fieldPath ||
    diagnosticPath.startsWith(`${fieldPath}/`) ||
    fieldPath.startsWith(`${diagnosticPath}/`)
  );
}

function resetsPath(reset: string, path: string): boolean {
  return reset === path || path.startsWith(`${reset}/`);
}

function labelFromPointer(path: string): string {
  const last = path.split("/").at(-1) ?? path;
  return last
    .replaceAll("~1", "/")
    .replaceAll("~0", "~")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/^./, (value) => value.toUpperCase());
}

function compareFieldsByPath(left: string, right: string): number {
  const leftDepth = left.split("/").length;
  const rightDepth = right.split("/").length;
  return leftDepth - rightDepth || left.localeCompare(right);
}

function compareEditorFields(left: DcsEditorField, right: DcsEditorField): number {
  const leftOrder = left.metadata.presentation?.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.metadata.presentation?.order ?? Number.MAX_SAFE_INTEGER;
  return (
    left.group.localeCompare(right.group) ||
    leftOrder - rightOrder ||
    left.depth - right.depth ||
    left.path.localeCompare(right.path)
  );
}
