import {
  type DcsCollectionIdentity,
  type DcsDiagnostic,
  type DcsFieldMetadata,
  type DcsScope,
  type ConfigContractBundle,
} from "./contract";
import { validateDcsExtensionDocument, type DcsExtensionRegistry } from "./extensions";
import {
  getJsonPointer,
  isJsonArray,
  isJsonObject,
  isValidJsonPointer,
  type JsonObject,
  type JsonValue,
} from "./json";
import { jsoncErrorMessage, parseJsoncText, type DcsDocumentSyntax } from "./jsonc";
import { type DcsProfileName, isDcsProfileName } from "./profiles";
import { type JsonSchema, validateJsonValueAgainstSchema } from "./schema";
import { isDcsSecretReference } from "./secrets";
export type PersistentConfigScope = Exclude<DcsScope, "invocation">;
export type ConfigDocumentScope = DcsScope;

/** Identity-based reorder directive for a collection field. */
export interface DcsCollectionMove {
  readonly before?: DcsCollectionIdentity;
  readonly id: DcsCollectionIdentity;
}

export interface ParsedConfigDocument {
  readonly envelope: {
    readonly collectionMoves: Readonly<Record<string, readonly DcsCollectionMove[]>>;
    readonly collectionRemovals: Readonly<Record<string, readonly DcsCollectionIdentity[]>>;
    readonly contractVersion?: number;
    readonly documentVersion?: number;
    readonly id?: string;
    readonly profile?: DcsProfileName;
    readonly resets: readonly string[];
  };
  readonly extensions: JsonObject;
  readonly product: JsonObject;
  readonly schema?: string;
}

export interface ParseConfigDocumentOptions {
  readonly bundle: ConfigContractBundle;
  /** Locally loaded descriptors for known extension validation. Unknown data remains opaque. */
  readonly extensionRegistry?: DcsExtensionRegistry;
  readonly scope: ConfigDocumentScope;
  /** Expected profile for a profile-overlay document. Omit for a base document. */
  readonly profile?: DcsProfileName;
  /** JSON is the portable default. JSONC must be chosen explicitly by a host adapter. */
  readonly syntax?: DcsDocumentSyntax;
}

export interface ParseConfigDocumentResult {
  readonly diagnostics: readonly DcsDiagnostic[];
  readonly document?: ParsedConfigDocument;
  readonly ok: boolean;
}

export function parseConfigDocument(
  input: JsonObject | string,
  options: ParseConfigDocumentOptions,
): ParseConfigDocumentResult {
  const diagnostics: DcsDiagnostic[] = [];
  const documentValue = parseInput(input, diagnostics, options.syntax ?? "json");

  if (!isJsonObject(documentValue)) {
    if (documentValue !== undefined) {
      diagnostics.push(diag("DCS2002", "Configuration document root must be an object.", ""));
    }
    return { diagnostics, ok: false };
  }

  const envelope = parseEnvelope(documentValue.$dcs, options.bundle, diagnostics, options.profile);
  const extensions = parseExtensions(documentValue.$extensions, diagnostics);
  const schema = parseSchemaReference(documentValue.$schema, diagnostics);
  const product = productFields(documentValue, diagnostics);

  diagnostics.push(
    ...validateDcsExtensionDocument({
      bundle: options.bundle,
      extensions,
      ...(options.extensionRegistry === undefined ? {} : { registry: options.extensionRegistry }),
    }),
  );

  validateResets(envelope.resets, product, options.bundle, options.scope, diagnostics);
  validateCollectionDirectives(envelope, options.bundle, options.scope, diagnostics);
  validateProduct(product, options.bundle, options.scope, "", diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, ok: false };
  }

  return {
    diagnostics,
    document: {
      envelope,
      extensions,
      product,
      ...(schema === undefined ? {} : { schema }),
    },
    ok: true,
  };
}

function parseInput(
  input: JsonObject | string,
  diagnostics: DcsDiagnostic[],
  syntax: DcsDocumentSyntax,
): JsonValue | undefined {
  if (typeof input !== "string") {
    return input;
  }

  if (syntax === "jsonc") {
    const parsed = parseJsoncText(input);
    if (parsed.ok && parsed.parsed !== undefined) {
      return parsed.parsed.value;
    }
    diagnostics.push(
      diag(
        "DCS2001",
        `Unable to parse JSONC configuration document: ${parsed.error === undefined ? "Unknown JSONC parse error." : jsoncErrorMessage(parsed.error)}`,
      ),
    );
    return undefined;
  }

  try {
    return JSON.parse(input) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    diagnostics.push(diag("DCS2001", `Unable to parse JSON configuration document: ${message}`));
    return undefined;
  }
}

function parseEnvelope(
  value: JsonValue | undefined,
  bundle: ConfigContractBundle,
  diagnostics: DcsDiagnostic[],
  expectedProfile: DcsProfileName | undefined,
): ParsedConfigDocument["envelope"] {
  if (value === undefined) {
    if (expectedProfile !== undefined) {
      diagnostics.push(
        diag(
          "DCS2026",
          `Profile document must declare $dcs.profile ${JSON.stringify(expectedProfile)}.`,
          "/$dcs/profile",
        ),
      );
    }
    return { collectionMoves: {}, collectionRemovals: {}, resets: [] };
  }

  if (!isJsonObject(value)) {
    diagnostics.push(diag("DCS2002", "$dcs must be an object.", "/$dcs"));
    return { collectionMoves: {}, collectionRemovals: {}, resets: [] };
  }

  const id = value.id;
  const contractVersion = value.contractVersion;
  const documentVersion = value.documentVersion;
  const resets = value.resets;
  const profile = value.profile;
  const collectionRemovals = parseCollectionRemovals(value.collectionRemovals, diagnostics);
  const collectionMoves = parseCollectionMoves(value.collectionMoves, diagnostics);

  if (id !== undefined && id !== bundle.$dcs.id) {
    diagnostics.push(diag("DCS2003", "$dcs.id does not match the selected contract.", "/$dcs/id"));
  }

  if (contractVersion !== undefined && contractVersion !== bundle.$dcs.contractVersion) {
    diagnostics.push(
      diag(
        "DCS2004",
        "$dcs.contractVersion is unsupported by the selected contract.",
        "/$dcs/contractVersion",
      ),
    );
  }

  if (documentVersion !== undefined && documentVersion !== bundle.$dcs.documentVersion) {
    diagnostics.push(
      diag(
        "DCS2005",
        "$dcs.documentVersion is unsupported by the selected contract.",
        "/$dcs/documentVersion",
      ),
    );
  }

  if (id !== undefined && typeof id !== "string") {
    diagnostics.push(diag("DCS2006", "$dcs.id must be a string.", "/$dcs/id"));
  }

  if (contractVersion !== undefined && !isNonNegativeInteger(contractVersion)) {
    diagnostics.push(
      diag(
        "DCS2007",
        "$dcs.contractVersion must be a non-negative integer.",
        "/$dcs/contractVersion",
      ),
    );
  }

  if (documentVersion !== undefined && !isNonNegativeInteger(documentVersion)) {
    diagnostics.push(
      diag(
        "DCS2008",
        "$dcs.documentVersion must be a non-negative integer.",
        "/$dcs/documentVersion",
      ),
    );
  }

  if (resets !== undefined && !isJsonArray(resets)) {
    diagnostics.push(
      diag("DCS2009", "$dcs.resets must be an array of JSON Pointers.", "/$dcs/resets"),
    );
  }

  const parsedResets = isJsonArray(resets)
    ? resets.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (isJsonArray(resets) && parsedResets.length !== resets.length) {
    diagnostics.push(diag("DCS2010", "$dcs.resets must contain strings only.", "/$dcs/resets"));
  }

  if (profile !== undefined && (typeof profile !== "string" || !isDcsProfileName(profile))) {
    diagnostics.push(
      diag("DCS2024", "$dcs.profile must be a lower-case profile name.", "/$dcs/profile"),
    );
  }
  if (expectedProfile === undefined && profile !== undefined) {
    diagnostics.push(
      diag(
        "DCS2025",
        "$dcs.profile is only valid in an explicitly selected profile overlay.",
        "/$dcs/profile",
      ),
    );
  }
  if (expectedProfile !== undefined && profile !== expectedProfile) {
    diagnostics.push(
      diag(
        "DCS2026",
        `Profile document must declare $dcs.profile ${JSON.stringify(expectedProfile)}.`,
        "/$dcs/profile",
      ),
    );
  }

  return {
    ...(typeof contractVersion === "number" ? { contractVersion } : {}),
    ...(typeof documentVersion === "number" ? { documentVersion } : {}),
    ...(typeof id === "string" ? { id } : {}),
    collectionMoves,
    collectionRemovals,
    ...(typeof profile === "string" && isDcsProfileName(profile) ? { profile } : {}),
    resets: parsedResets,
  };
}

function parseCollectionRemovals(
  value: JsonValue | undefined,
  diagnostics: DcsDiagnostic[],
): Readonly<Record<string, readonly DcsCollectionIdentity[]>> {
  if (value === undefined) {
    return {};
  }
  if (!isJsonObject(value)) {
    diagnostics.push(
      diag(
        "DCS2030",
        "$dcs.collectionRemovals must be an object keyed by collection JSON Pointer.",
        "/$dcs/collectionRemovals",
      ),
    );
    return {};
  }
  const result: Record<string, readonly DcsCollectionIdentity[]> = {};
  for (const [path, entries] of Object.entries(value)) {
    if (!isJsonArray(entries)) {
      diagnostics.push(
        diag(
          "DCS2031",
          `Collection removals for ${path} must be an array of string or number identities.`,
          `/$dcs/collectionRemovals/${escapeSegment(path)}`,
        ),
      );
      continue;
    }
    const ids = entries.filter(
      (entry): entry is DcsCollectionIdentity =>
        typeof entry === "string" || typeof entry === "number",
    );
    if (ids.length !== entries.length) {
      diagnostics.push(
        diag(
          "DCS2031",
          `Collection removals for ${path} must contain string or number identities only.`,
          `/$dcs/collectionRemovals/${escapeSegment(path)}`,
        ),
      );
    }
    result[path] = ids;
  }
  return result;
}

function parseCollectionMoves(
  value: JsonValue | undefined,
  diagnostics: DcsDiagnostic[],
): Readonly<Record<string, readonly DcsCollectionMove[]>> {
  if (value === undefined) {
    return {};
  }
  if (!isJsonObject(value)) {
    diagnostics.push(
      diag(
        "DCS2032",
        "$dcs.collectionMoves must be an object keyed by collection JSON Pointer.",
        "/$dcs/collectionMoves",
      ),
    );
    return {};
  }
  const result: Record<string, readonly DcsCollectionMove[]> = {};
  for (const [path, entries] of Object.entries(value)) {
    if (!isJsonArray(entries)) {
      diagnostics.push(
        diag(
          "DCS2033",
          `Collection moves for ${path} must be an array.`,
          `/$dcs/collectionMoves/${escapeSegment(path)}`,
        ),
      );
      continue;
    }
    const moves: DcsCollectionMove[] = [];
    for (const entry of entries) {
      if (
        !isJsonObject(entry) ||
        (typeof entry.id !== "string" && typeof entry.id !== "number") ||
        (entry.before !== undefined &&
          typeof entry.before !== "string" &&
          typeof entry.before !== "number")
      ) {
        diagnostics.push(
          diag(
            "DCS2034",
            `Collection move for ${path} must declare string or number id and optional before identity.`,
            `/$dcs/collectionMoves/${escapeSegment(path)}`,
          ),
        );
        continue;
      }
      if (entry.before !== undefined && entry.before === entry.id) {
        diagnostics.push(
          diag(
            "DCS2035",
            `Collection move for ${path} cannot move an item before itself.`,
            `/$dcs/collectionMoves/${escapeSegment(path)}`,
          ),
        );
        continue;
      }
      moves.push({ id: entry.id, ...(entry.before === undefined ? {} : { before: entry.before }) });
    }
    result[path] = moves;
  }
  return result;
}

function parseExtensions(value: JsonValue | undefined, diagnostics: DcsDiagnostic[]): JsonObject {
  if (value === undefined) {
    return {};
  }

  if (!isJsonObject(value)) {
    diagnostics.push(diag("DCS4001", "$extensions must be an object.", "/$extensions"));
    return {};
  }

  return value;
}

function parseSchemaReference(
  value: JsonValue | undefined,
  diagnostics: DcsDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(diag("DCS2012", "$schema must be a non-empty URI reference.", "/$schema"));
    return undefined;
  }
  return value;
}

function productFields(value: JsonObject, diagnostics: DcsDiagnostic[]): JsonObject {
  const product: Record<string, JsonValue> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$dcs" || key === "$extensions" || key === "$schema") {
      continue;
    }

    if (key.startsWith("$")) {
      diagnostics.push(
        diag("DCS2011", `Top-level key ${JSON.stringify(key)} is reserved.`, `/${key}`),
      );
      continue;
    }

    Object.defineProperty(product, key, {
      value: entry,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return product;
}

function validateResets(
  resets: readonly string[],
  product: JsonObject,
  bundle: ConfigContractBundle,
  scope: ConfigDocumentScope,
  diagnostics: DcsDiagnostic[],
): void {
  const seen = new Set<string>();

  for (const pointer of resets) {
    if (!isValidJsonPointer(pointer) || pointer === "") {
      diagnostics.push(
        diag("DCS3001", "A reset must reference a non-root JSON Pointer.", "/$dcs/resets"),
      );
      continue;
    }

    if (seen.has(pointer)) {
      diagnostics.push(
        diag("DCS3002", `Reset ${pointer} is declared more than once.`, "/$dcs/resets"),
      );
      continue;
    }
    seen.add(pointer);

    const metadata = bundle.fields[pointer];
    if (metadata === undefined) {
      diagnostics.push(
        diag("DCS3003", `Reset ${pointer} does not target a declared field.`, "/$dcs/resets"),
      );
      continue;
    }

    if (metadata.resettable === false) {
      diagnostics.push(diag("DCS3004", `Field ${pointer} cannot be reset.`, "/$dcs/resets"));
    }

    if (!metadata.scopes.includes(scope)) {
      diagnostics.push(
        diag(
          "DCS3006",
          `Field ${pointer} does not allow ${scope} scope for reset.`,
          "/$dcs/resets",
        ),
      );
    }

    if (hasOverlappingProductPointer(product, pointer, bundle)) {
      diagnostics.push(
        diag(
          "DCS3005",
          `Document must not reset and set overlapping path ${pointer} in the same layer.`,
          pointer,
        ),
      );
    }
  }
}

function validateCollectionDirectives(
  envelope: ParsedConfigDocument["envelope"],
  bundle: ConfigContractBundle,
  scope: ConfigDocumentScope,
  diagnostics: DcsDiagnostic[],
): void {
  for (const [path, identities] of Object.entries(envelope.collectionRemovals)) {
    validateCollectionDirectivePath(path, bundle, scope, diagnostics, "/$dcs/collectionRemovals");
    if (new Set(identities.map(collectionIdentityKey)).size !== identities.length) {
      diagnostics.push(
        diag(
          "DCS2036",
          `Collection removals for ${path} repeat an identity.`,
          `/$dcs/collectionRemovals/${escapeSegment(path)}`,
        ),
      );
    }
  }
  for (const [path, moves] of Object.entries(envelope.collectionMoves)) {
    validateCollectionDirectivePath(path, bundle, scope, diagnostics, "/$dcs/collectionMoves");
    const seen = new Set<string>();
    for (const move of moves) {
      const key = collectionIdentityKey(move.id);
      if (seen.has(key)) {
        diagnostics.push(
          diag(
            "DCS2037",
            `Collection moves for ${path} repeat identity ${JSON.stringify(move.id)}.`,
            `/$dcs/collectionMoves/${escapeSegment(path)}`,
          ),
        );
      }
      seen.add(key);
    }
  }

  const directivePaths = [
    ...Object.keys(envelope.collectionRemovals),
    ...Object.keys(envelope.collectionMoves),
  ];
  for (const reset of envelope.resets) {
    if (directivePaths.some((path) => pointersOverlap(path, reset))) {
      diagnostics.push(
        diag(
          "DCS2042",
          `Document must not reset and apply collection directives to overlapping path ${reset} in the same layer.`,
          "/$dcs",
        ),
      );
    }
  }
}

function pointersOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function validateCollectionDirectivePath(
  path: string,
  bundle: ConfigContractBundle,
  scope: ConfigDocumentScope,
  diagnostics: DcsDiagnostic[],
  envelopePath: string,
): void {
  if (!isValidJsonPointer(path) || path === "") {
    diagnostics.push(
      diag("DCS2038", "Collection directive must target a non-root JSON Pointer.", envelopePath),
    );
    return;
  }
  const metadata = bundle.fields[path];
  if (metadata === undefined) {
    diagnostics.push(
      diag(
        "DCS2039",
        `Collection directive ${path} does not target a declared field.`,
        envelopePath,
      ),
    );
    return;
  }
  if (
    (metadata.merge !== "keyed" && metadata.merge !== "unique") ||
    metadata.collection?.identity === undefined
  ) {
    diagnostics.push(
      diag(
        "DCS2040",
        `Collection directive ${path} requires a keyed or identity-aware unique collection.`,
        envelopePath,
      ),
    );
  }
  if (!metadata.scopes.includes(scope)) {
    diagnostics.push(
      diag("DCS2041", `Collection directive ${path} does not allow ${scope} scope.`, envelopePath),
    );
  }
}

function collectionIdentityKey(value: DcsCollectionIdentity): string {
  return `${typeof value}:${String(value)}`;
}

function hasOverlappingProductPointer(
  product: JsonObject,
  pointer: string,
  bundle: ConfigContractBundle,
): boolean {
  const explicitFields = Object.entries(bundle.fields)
    .filter(([candidate, metadata]) => {
      const value = getJsonPointer(product, candidate);
      if (value === undefined) {
        return false;
      }

      // A deep object is a sparse container. Its nested declared children, not
      // the container itself, are the explicit field assignments.
      return !(metadata.merge === "deep" && isJsonObject(value));
    })
    .map(([candidate]) => candidate);

  return explicitFields.some(
    (candidate) =>
      candidate === pointer ||
      candidate.startsWith(`${pointer}/`) ||
      pointer.startsWith(`${candidate}/`),
  );
}

function validateProduct(
  value: JsonObject,
  bundle: ConfigContractBundle,
  scope: ConfigDocumentScope,
  path: string,
  diagnostics: DcsDiagnostic[],
): void {
  const properties = isJsonObject(bundle.schema.properties) ? bundle.schema.properties : {};

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${escapeSegment(key)}`;
    const schema = properties[key];

    if (!isJsonObject(schema)) {
      diagnostics.push(
        diag("DCS2012", `Property ${childPath} is not declared by the contract schema.`, childPath),
      );
      continue;
    }

    validateExplicitField(child, schema, childPath, bundle, scope, diagnostics);
  }
}

function validateExplicitField(
  value: JsonValue,
  schema: JsonSchema,
  path: string,
  bundle: ConfigContractBundle,
  scope: ConfigDocumentScope,
  diagnostics: DcsDiagnostic[],
  inheritedMetadata?: DcsFieldMetadata,
): void {
  const metadata = bundle.fields[path] ?? inheritedMetadata;
  if (metadata === undefined) {
    diagnostics.push(diag("DCS2013", `Field ${path} has no contract metadata.`, path));
    return;
  }

  if (!metadata.scopes.includes(scope)) {
    diagnostics.push(diag("DCS2014", `Field ${path} does not allow ${scope} scope.`, path));
  }

  if (metadata.secret && !isDcsSecretReference(value)) {
    diagnostics.push(
      diag("DCS2015", `Secret field ${path} must contain a canonical $secret reference.`, path),
    );
    return;
  }

  if (metadata.merge === "deep" && isJsonObject(value) && isJsonObject(schema.properties)) {
    const nestedProperties = schema.properties;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}/${escapeSegment(key)}`;
      const declaredChildSchema = nestedProperties[key];
      const additionalChildSchema = isJsonObject(schema.additionalProperties)
        ? schema.additionalProperties
        : undefined;
      const childSchema = isJsonObject(declaredChildSchema)
        ? declaredChildSchema
        : additionalChildSchema;
      if (!isJsonObject(childSchema)) {
        diagnostics.push(
          diag(
            "DCS2016",
            `Property ${childPath} is not declared by the contract schema.`,
            childPath,
          ),
        );
        continue;
      }

      validateExplicitField(
        child,
        childSchema,
        childPath,
        bundle,
        scope,
        diagnostics,
        bundle.fields[childPath] === undefined ? metadata : undefined,
      );
    }

    return;
  }

  for (const issue of validateJsonValueAgainstSchema(value, schema, path)) {
    diagnostics.push(diag("DCS2017", `Invalid value: ${issue.message}`, issue.path));
  }
}

function escapeSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isNonNegativeInteger(value: JsonValue): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function diag(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}
