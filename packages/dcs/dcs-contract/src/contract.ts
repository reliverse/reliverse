import { validateDcsExtensionRequirements, type DcsExtensionRequirement } from "./extensions";
import {
  cloneJsonValue,
  freezeJsonValue,
  getJsonPointer,
  isJsonObject,
  isValidJsonPointer,
  type JsonObject,
  type JsonValue,
} from "./json";
import { validateDcsMigrationPlans, type DcsMigrationPlan } from "./migration";
import {
  isSchemaObject,
  schemaAtJsonPointer,
  type JsonSchema,
  validateJsonValueAgainstSchema,
} from "./schema";
import { isDcsSecretReference, validateDcsSecretReference } from "./secrets";

export const DCS_SPEC_VERSION = "0.0.1" as const;
export const JSON_SCHEMA_2020_12_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

export type DcsScope = "invocation" | "local" | "user" | "workspace";
export type DcsMergeStrategy = "append" | "deep" | "keyed" | "replace" | "unique";

/** Stable scalar identity used by keyed collection operations. */
export type DcsCollectionIdentity = number | string;

/**
 * Metadata for array fields using a collection-aware merge strategy.
 * `identity` is a JSON Pointer relative to each array item, such as `/id`.
 */
export interface DcsCollectionMetadata {
  readonly identity?: string;
}
export type DcsDiagnosticSeverity = "error" | "warning";

/**
 * Non-semantic rendering hint for a DCS field. Renderers may ignore hints they
 * do not understand, but hints MUST NOT change validation, resolution, scope,
 * defaults, or policy semantics.
 */
export type DcsPresentationControl =
  | "auto"
  | "checkbox"
  | "number"
  | "select"
  | "text"
  | "textarea";

export interface DcsFieldPresentation {
  readonly control?: DcsPresentationControl;
  readonly description?: string;
  readonly group?: string;
  readonly label?: string;
  readonly order?: number;
  readonly placeholder?: string;
}

export interface DcsDiagnosticSource {
  readonly kind: string;
  readonly location?: string;
}

export interface DcsDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly severity: DcsDiagnosticSeverity;
  readonly source?: DcsDiagnosticSource;
}

export interface DcsFieldMetadata {
  readonly collection?: DcsCollectionMetadata;
  readonly deprecated?: boolean | string;
  readonly merge: DcsMergeStrategy;
  readonly presentation?: DcsFieldPresentation;
  readonly resettable?: boolean;
  readonly scopes: readonly DcsScope[];
  readonly secret?: boolean;
  readonly visibility?: string;
}

export interface DcsMetadata {
  readonly contractVersion: number;
  readonly documentVersion: number;
  readonly fileStem: string;
  readonly id: string;
  readonly specVersion: string;
}

export interface ConfigContractBundle {
  readonly $dcs: DcsMetadata;
  readonly defaults: JsonObject;
  /** Product-declared compatibility constraints for locally supplied extension contracts. */
  readonly extensionRequirements?: readonly DcsExtensionRequirement[];
  readonly fields: Readonly<Record<string, DcsFieldMetadata>>;
  /** Declarative legacy-version routes understood by this target contract. */
  readonly migrations?: readonly DcsMigrationPlan[];
  readonly schema: JsonSchema;
}

export class DcsContractValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n") || "Config Contract Bundle validation failed.",
    );
    this.name = "DcsContractValidationError";
    this.diagnostics = diagnostics;
  }
}

export function createConfigContractBundle(bundle: ConfigContractBundle): ConfigContractBundle {
  const diagnostics = validateConfigContractBundle(bundle);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new DcsContractValidationError(diagnostics);
  }

  return freezeBundle(bundle);
}

export function validateConfigContractBundle(
  bundle: ConfigContractBundle,
): readonly DcsDiagnostic[] {
  const diagnostics: DcsDiagnostic[] = [];

  validateMetadata(bundle.$dcs, diagnostics);
  validateSchema(bundle.schema, diagnostics);
  validateDefaults(bundle.defaults, bundle.schema, diagnostics);
  validateFields(bundle, diagnostics);
  validateSecretDefaults(bundle, diagnostics);
  diagnostics.push(...validateDcsExtensionRequirements(bundle.extensionRequirements));
  diagnostics.push(...validateDcsMigrationPlans(bundle.migrations, bundle));

  return diagnostics;
}

export function isSecretReference(value: JsonValue): boolean {
  return isDcsSecretReference(value);
}

function validateSecretDefaults(bundle: ConfigContractBundle, diagnostics: DcsDiagnostic[]): void {
  for (const [pointer, metadata] of Object.entries(bundle.fields)) {
    if (metadata.secret !== true) {
      continue;
    }
    const value = getJsonPointer(bundle.defaults, pointer);
    if (value === undefined) {
      continue;
    }
    for (const issue of validateDcsSecretReference(value, pointer)) {
      diagnostics.push(error(issue.code, issue.message, issue.path ?? pointer));
    }
  }
}

function validateMetadata(metadata: DcsMetadata, diagnostics: DcsDiagnostic[]): void {
  if (!isContractId(metadata.id)) {
    diagnostics.push(
      error("DCS1001", "Contract ID must be a lower-case reverse-domain identifier.", "/$dcs/id"),
    );
  }

  if (metadata.specVersion !== DCS_SPEC_VERSION) {
    diagnostics.push(
      error(
        "DCS1002",
        `Unsupported DCS spec version ${JSON.stringify(metadata.specVersion)}.`,
        "/$dcs/specVersion",
      ),
    );
  }

  if (!isNonNegativeInteger(metadata.contractVersion)) {
    diagnostics.push(
      error("DCS1003", "contractVersion must be a non-negative integer.", "/$dcs/contractVersion"),
    );
  }

  if (!isNonNegativeInteger(metadata.documentVersion)) {
    diagnostics.push(
      error("DCS1004", "documentVersion must be a non-negative integer.", "/$dcs/documentVersion"),
    );
  }

  if (!isFileStem(metadata.fileStem)) {
    diagnostics.push(
      error(
        "DCS1005",
        "fileStem must use lower-case ASCII letters, digits, and single hyphens.",
        "/$dcs/fileStem",
      ),
    );
  }
}

function validateSchema(schema: JsonSchema, diagnostics: DcsDiagnostic[]): void {
  if (!isJsonObject(schema)) {
    diagnostics.push(error("DCS1006", "schema must be a JSON object.", "/schema"));
    return;
  }

  if (typeof schema.$schema !== "string") {
    diagnostics.push(
      error(
        "DCS1007",
        "schema must declare its JSON Schema dialect in $schema.",
        "/schema/$schema",
      ),
    );
  }

  if (!isSchemaObject(schema)) {
    diagnostics.push(error("DCS1008", "schema root must describe an object.", "/schema"));
  }

  if (!isJsonObject(schema.properties)) {
    diagnostics.push(
      error("DCS1009", "schema root must declare properties.", "/schema/properties"),
    );
    return;
  }

  for (const key of Object.keys(schema.properties)) {
    if (key === "$dcs" || key === "$extensions" || key.startsWith("$")) {
      diagnostics.push(
        error(
          "DCS1010",
          `Schema property ${JSON.stringify(key)} is reserved.`,
          `/schema/properties/${key}`,
        ),
      );
    }
  }
}

function validateDefaults(
  defaults: JsonObject,
  schema: JsonSchema,
  diagnostics: DcsDiagnostic[],
): void {
  if (!isJsonObject(defaults)) {
    diagnostics.push(error("DCS1011", "defaults must be a JSON object.", "/defaults"));
    return;
  }

  for (const issue of validateJsonValueAgainstSchema(defaults, schema, "/defaults")) {
    diagnostics.push(error("DCS1012", `defaults are invalid: ${issue.message}`, issue.path));
  }
}

function validateFields(bundle: ConfigContractBundle, diagnostics: DcsDiagnostic[]): void {
  const defaultValue = bundle.defaults as JsonValue;
  const rootProperties = isJsonObject(bundle.schema.properties) ? bundle.schema.properties : {};

  for (const key of Object.keys(rootProperties)) {
    const pointer = `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (!(pointer in bundle.fields)) {
      diagnostics.push(
        error("DCS1013", `Schema field ${pointer} has no metadata entry.`, `/fields/${pointer}`),
      );
    }
  }

  for (const [pointer, metadata] of Object.entries(bundle.fields)) {
    if (pointer === "" || !isValidJsonPointer(pointer)) {
      diagnostics.push(
        error(
          "DCS1014",
          `Field key ${JSON.stringify(pointer)} must be a non-root JSON Pointer.`,
          `/fields/${pointer}`,
        ),
      );
      continue;
    }

    const fieldSchema = schemaAtJsonPointer(bundle.schema, pointer);
    if (fieldSchema === undefined) {
      diagnostics.push(
        error(
          "DCS1015",
          `Field metadata points to an undeclared schema path: ${pointer}.`,
          `/fields/${pointer}`,
        ),
      );
      continue;
    }

    validateFieldMetadata(pointer, metadata, fieldSchema, defaultValue, bundle.fields, diagnostics);
  }
}

function validateFieldMetadata(
  pointer: string,
  metadata: DcsFieldMetadata,
  fieldSchema: JsonSchema,
  defaults: JsonValue,
  fields: Readonly<Record<string, DcsFieldMetadata>>,
  diagnostics: DcsDiagnostic[],
): void {
  if (!Array.isArray(metadata.scopes) || metadata.scopes.length === 0) {
    diagnostics.push(
      error(
        "DCS1016",
        `Field ${pointer} must allow at least one scope.`,
        `/fields/${pointer}/scopes`,
      ),
    );
  } else {
    const seenScopes = new Set<DcsScope>();
    for (const scope of metadata.scopes) {
      if (!isDcsScope(scope)) {
        diagnostics.push(
          error(
            "DCS1017",
            `Field ${pointer} declares unsupported scope ${JSON.stringify(scope)}.`,
            `/fields/${pointer}/scopes`,
          ),
        );
      }
      if (seenScopes.has(scope)) {
        diagnostics.push(
          error(
            "DCS1018",
            `Field ${pointer} repeats scope ${JSON.stringify(scope)}.`,
            `/fields/${pointer}/scopes`,
          ),
        );
      }
      seenScopes.add(scope);
    }
  }

  if (!isDcsMergeStrategy(metadata.merge)) {
    diagnostics.push(
      error(
        "DCS1019",
        `Field ${pointer} declares an unsupported merge strategy.`,
        `/fields/${pointer}/merge`,
      ),
    );
  }

  validateCollectionMetadata(pointer, metadata, fieldSchema, diagnostics);

  if (metadata.merge === "deep") {
    const defaultAtPath = getJsonPointer(defaults, pointer);
    if (!isSchemaObject(fieldSchema) || !isJsonObject(defaultAtPath)) {
      diagnostics.push(
        error(
          "DCS1020",
          `Deep field ${pointer} must be an object in both schema and defaults.`,
          `/fields/${pointer}`,
        ),
      );
      return;
    }

    const properties = isJsonObject(fieldSchema.properties) ? fieldSchema.properties : {};
    for (const key of Object.keys(properties)) {
      const childPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!(childPointer in fields)) {
        diagnostics.push(
          error(
            "DCS1021",
            `Deep field ${pointer} requires metadata for child ${childPointer}.`,
            `/fields/${childPointer}`,
          ),
        );
      }
    }
  }

  validateFieldPresentation(pointer, metadata.presentation, diagnostics);
}

function validateCollectionMetadata(
  pointer: string,
  metadata: DcsFieldMetadata,
  fieldSchema: JsonSchema,
  diagnostics: DcsDiagnostic[],
): void {
  const collectionMerge =
    metadata.merge === "append" || metadata.merge === "unique" || metadata.merge === "keyed";
  const arraySchema = schemaAllowsType(fieldSchema, "array");

  if (collectionMerge && !arraySchema) {
    diagnostics.push(
      error(
        "DCS1031",
        `Collection merge ${JSON.stringify(metadata.merge)} at ${pointer} requires an array schema.`,
        `/fields/${pointer}/merge`,
      ),
    );
  }

  if (!collectionMerge && metadata.collection !== undefined) {
    diagnostics.push(
      error(
        "DCS1032",
        `Field ${pointer} declares collection metadata without a collection merge strategy.`,
        `/fields/${pointer}/collection`,
      ),
    );
    return;
  }

  if (!collectionMerge || metadata.collection === undefined) {
    if (metadata.merge === "keyed") {
      diagnostics.push(
        error(
          "DCS1033",
          `Keyed collection ${pointer} must declare collection.identity.`,
          `/fields/${pointer}/collection/identity`,
        ),
      );
    }
    return;
  }

  const identity = metadata.collection.identity;
  if (metadata.merge === "keyed" && identity === undefined) {
    diagnostics.push(
      error(
        "DCS1033",
        `Keyed collection ${pointer} must declare collection.identity.`,
        `/fields/${pointer}/collection/identity`,
      ),
    );
    return;
  }

  if (identity === undefined) {
    return;
  }

  if (!isValidJsonPointer(identity) || identity === "") {
    diagnostics.push(
      error(
        "DCS1034",
        `Collection identity at ${pointer} must be a non-root JSON Pointer relative to each item.`,
        `/fields/${pointer}/collection/identity`,
      ),
    );
    return;
  }

  const itemSchema = isJsonObject(fieldSchema.items)
    ? (fieldSchema.items as JsonSchema)
    : undefined;
  const identitySchema =
    itemSchema === undefined ? undefined : schemaAtRelativePointer(itemSchema, identity);
  if (identitySchema === undefined || !schemaAllowsIdentity(identitySchema)) {
    diagnostics.push(
      error(
        "DCS1035",
        `Collection identity ${identity} at ${pointer} must resolve to a string or number item field.`,
        `/fields/${pointer}/collection/identity`,
      ),
    );
  }
}

function schemaAtRelativePointer(schema: JsonSchema, pointer: string): JsonSchema | undefined {
  let current: JsonSchema | undefined = schema;
  for (const segment of pointer
    .slice(1)
    .split("/")
    .map((entry) => entry.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!isJsonObject(current) || !isJsonObject(current.properties)) {
      return undefined;
    }
    const next = current.properties[segment];
    if (!isJsonObject(next)) {
      return undefined;
    }
    current = next as JsonSchema;
  }
  return current;
}

function schemaAllowsType(schema: JsonSchema, type: string): boolean {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function schemaAllowsIdentity(schema: JsonSchema): boolean {
  if (schemaAllowsType(schema, "string") || schemaAllowsType(schema, "number")) {
    return true;
  }
  return (
    Array.isArray(schema.enum) &&
    schema.enum.every((value) => typeof value === "string" || typeof value === "number")
  );
}

function validateFieldPresentation(
  pointer: string,
  presentation: unknown,
  diagnostics: DcsDiagnostic[],
): void {
  if (presentation === undefined) {
    return;
  }

  if (!isJsonObject(presentation)) {
    diagnostics.push(
      error(
        "DCS1028",
        `Field ${pointer} presentation must be an object when present.`,
        `/fields/${pointer}/presentation`,
      ),
    );
    return;
  }

  const typedPresentation = presentation as DcsFieldPresentation;
  const textKeys: readonly (keyof Pick<
    DcsFieldPresentation,
    "description" | "group" | "label" | "placeholder"
  >)[] = ["description", "group", "label", "placeholder"];

  for (const key of textKeys) {
    const value = typedPresentation[key];
    if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
      diagnostics.push(
        error(
          "DCS1028",
          `Field ${pointer} presentation.${key} must be a non-empty string when present.`,
          `/fields/${pointer}/presentation/${key}`,
        ),
      );
    }
  }

  if (
    typedPresentation.order !== undefined &&
    (!Number.isFinite(typedPresentation.order) || !Number.isInteger(typedPresentation.order))
  ) {
    diagnostics.push(
      error(
        "DCS1029",
        `Field ${pointer} presentation.order must be a finite integer when present.`,
        `/fields/${pointer}/presentation/order`,
      ),
    );
  }

  if (
    typedPresentation.control !== undefined &&
    !isDcsPresentationControl(typedPresentation.control)
  ) {
    diagnostics.push(
      error(
        "DCS1030",
        `Field ${pointer} presentation.control is unsupported: ${JSON.stringify(typedPresentation.control)}.`,
        `/fields/${pointer}/presentation/control`,
      ),
    );
  }
}

function isDcsPresentationControl(value: unknown): value is DcsPresentationControl {
  return (
    value === "auto" ||
    value === "checkbox" ||
    value === "number" ||
    value === "select" ||
    value === "text" ||
    value === "textarea"
  );
}

function freezeBundle(bundle: ConfigContractBundle): ConfigContractBundle {
  const fields: Record<string, DcsFieldMetadata> = {};
  for (const [pointer, metadata] of Object.entries(bundle.fields)) {
    fields[pointer] = Object.freeze({
      ...metadata,
      ...(metadata.collection === undefined
        ? {}
        : { collection: Object.freeze({ ...metadata.collection }) }),
      ...(metadata.presentation === undefined
        ? {}
        : { presentation: Object.freeze({ ...metadata.presentation }) }),
      scopes: Object.freeze([...metadata.scopes]),
    });
  }

  return Object.freeze({
    $dcs: Object.freeze({ ...bundle.$dcs }),
    defaults: freezeJsonValue(cloneJsonValue(bundle.defaults)),
    ...(bundle.extensionRequirements === undefined
      ? {}
      : {
          extensionRequirements: Object.freeze(
            bundle.extensionRequirements.map((requirement) => Object.freeze({ ...requirement })),
          ),
        }),
    fields: Object.freeze(fields),
    ...(bundle.migrations === undefined
      ? {}
      : {
          migrations: Object.freeze(
            bundle.migrations.map(
              (plan) =>
                freezeJsonValue(
                  cloneJsonValue(plan as unknown as JsonValue),
                ) as unknown as DcsMigrationPlan,
            ),
          ),
        }),
    schema: freezeJsonValue(cloneJsonValue(bundle.schema)) as JsonSchema,
  });
}

function isContractId(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function isDcsMergeStrategy(value: string): value is DcsMergeStrategy {
  return (
    value === "replace" ||
    value === "deep" ||
    value === "append" ||
    value === "unique" ||
    value === "keyed"
  );
}

function isDcsScope(value: string): value is DcsScope {
  return value === "user" || value === "workspace" || value === "local" || value === "invocation";
}

function isFileStem(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function error(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}
