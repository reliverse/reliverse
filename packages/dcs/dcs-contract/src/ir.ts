import { canonicalizeJson } from "./canonical";
import {
  isSecretReference,
  type DcsCollectionMetadata,
  type DcsDiagnostic,
  type DcsFieldMetadata,
  type DcsFieldPresentation,
  type DcsMergeStrategy,
  type DcsMetadata,
  type DcsScope,
  type ConfigContractBundle,
  createConfigContractBundle,
  JSON_SCHEMA_2020_12_DIALECT,
} from "./contract";
import { type DcsExtensionRequirement } from "./extensions";
import {
  cloneJsonValue,
  escapeJsonPointerSegment,
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json";
import { type DcsMigrationPlan } from "./migration";
import { type JsonSchema, validateJsonValueAgainstSchema } from "./schema";
import { DCS_SECRET_PROVIDER_ID_PATTERN } from "./secrets";

export type DcsConfigIrNode =
  | DcsConfigIrArrayNode
  | DcsConfigIrBooleanNode
  | DcsConfigIrEnumNode
  | DcsConfigIrNumberNode
  | DcsConfigIrObjectNode
  | DcsConfigIrSecretReferenceNode
  | DcsConfigIrStringNode;

export interface DcsConfigIr {
  readonly $dcs: DcsMetadata;
  /** Product-declared compatibility constraints emitted into the target CCB. */
  readonly extensionRequirements?: readonly DcsExtensionRequirement[];
  /** Optional declarative routes carried into the generated target CCB. */
  readonly migrations?: readonly DcsMigrationPlan[];
  readonly root: DcsConfigIrObjectNode;
}

export interface DcsConfigIrBaseNode {
  readonly collection?: DcsCollectionMetadata;
  readonly defaultValue?: JsonValue;
  readonly deprecated?: boolean | string;
  readonly merge: DcsMergeStrategy;
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly presentation?: DcsFieldPresentation;
  readonly resettable: boolean;
  readonly scopes: readonly DcsScope[];
  readonly secret: boolean;
  readonly visibility?: string;
}

export interface DcsConfigIrArrayNode extends DcsConfigIrBaseNode {
  readonly item: DcsConfigIrNode;
  readonly kind: "array";
}

export interface DcsConfigIrBooleanNode extends DcsConfigIrBaseNode {
  readonly kind: "boolean";
}

export interface DcsConfigIrEnumNode extends DcsConfigIrBaseNode {
  readonly kind: "enum";
  readonly values: readonly (boolean | null | number | string)[];
}

export interface DcsConfigIrNumberNode extends DcsConfigIrBaseNode {
  readonly kind: "number";
}

export interface DcsConfigIrObjectNode extends DcsConfigIrBaseNode {
  readonly kind: "object";
  readonly shape: Readonly<Record<string, DcsConfigIrNode>>;
}

export interface DcsConfigIrSecretReferenceNode extends DcsConfigIrBaseNode {
  readonly kind: "secret-reference";
}

export interface DcsConfigIrStringNode extends DcsConfigIrBaseNode {
  readonly kind: "string";
}

export class DcsConfigIrValidationError extends Error {
  public readonly diagnostics: readonly DcsDiagnostic[];

  public constructor(diagnostics: readonly DcsDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n") || "Config IR validation failed.",
    );
    this.name = "DcsConfigIrValidationError";
    this.diagnostics = diagnostics;
  }
}

export function generateConfigContractBundleFromIr(ir: DcsConfigIr): ConfigContractBundle {
  const diagnostics: DcsDiagnostic[] = [];

  if (ir.root.kind !== "object") {
    diagnostics.push(error("DCS1101", "Config IR root must be an object node.", "/root"));
  }

  if (ir.root.optional) {
    diagnostics.push(error("DCS1102", "Config IR root cannot be optional.", "/root"));
  }

  const compilation = compileNode(ir.root, "", {
    diagnostics,
    emitMetadata: true,
    requireDefaults: true,
  });

  if (!isJsonObject(compilation.defaultValue)) {
    diagnostics.push(
      error("DCS1103", "Config IR root defaults must resolve to a JSON object.", "/root"),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new DcsConfigIrValidationError(diagnostics);
  }

  return createConfigContractBundle({
    $dcs: ir.$dcs,
    defaults: compilation.defaultValue as JsonObject,
    ...(ir.extensionRequirements === undefined
      ? {}
      : { extensionRequirements: ir.extensionRequirements }),
    fields: compilation.fields,
    ...(ir.migrations === undefined ? {} : { migrations: ir.migrations }),
    schema: {
      $schema: JSON_SCHEMA_2020_12_DIALECT,
      ...compilation.schema,
    },
  });
}

function compileNode(node: DcsConfigIrNode, path: string, options: CompileOptions): CompiledNode {
  let compiled: CompiledNode;

  switch (node.kind) {
    case "array":
      compiled = compileArray(node, path, options);
      break;
    case "boolean":
    case "number":
    case "string":
      compiled = compilePrimitive(node, path, options);
      break;
    case "enum":
      compiled = compileEnum(node, path, options);
      break;
    case "object":
      compiled = compileObject(node, path, options);
      break;
    case "secret-reference":
      compiled = compileSecretReference(node, path, options);
      break;
  }

  if (options.emitMetadata && path !== "") {
    compiled.fields[path] = metadataFor(node);
  }

  if (node.merge === "deep" && node.kind !== "object") {
    options.diagnostics.push(
      error("DCS1104", `Only object fields may use deep merge at ${path}.`, path),
    );
  }

  if (node.merge === "deep" && !isJsonObject(compiled.defaultValue)) {
    options.diagnostics.push(
      error("DCS1105", `Deep field ${path} must have an object default.`, path),
    );
  }

  return compiled;
}

function compileArray(
  node: DcsConfigIrArrayNode,
  path: string,
  options: CompileOptions,
): CompiledNode {
  const item = compileNode(node.item, `${path}/*`, {
    diagnostics: options.diagnostics,
    emitMetadata: false,
    requireDefaults: false,
  });
  const schema: JsonSchema = withNullable(
    {
      items: item.schema,
      type: "array",
    },
    node.nullable,
  );

  return compileValueDefault(node, schema, path, options, "array");
}

function compilePrimitive(
  node: DcsConfigIrBooleanNode | DcsConfigIrNumberNode | DcsConfigIrStringNode,
  path: string,
  options: CompileOptions,
): CompiledNode {
  const schema = withNullable({ type: node.kind }, node.nullable);
  return compileValueDefault(node, schema, path, options, node.kind);
}

function compileEnum(
  node: DcsConfigIrEnumNode,
  path: string,
  options: CompileOptions,
): CompiledNode {
  const values =
    node.nullable && !node.values.includes(null) ? [...node.values, null] : [...node.values];
  const schema: JsonSchema = { enum: values };
  return compileValueDefault(node, schema, path, options, "enum");
}

function compileSecretReference(
  node: DcsConfigIrSecretReferenceNode,
  path: string,
  options: CompileOptions,
): CompiledNode {
  const schema = withNullable(
    {
      additionalProperties: false,
      properties: {
        $secret: {
          additionalProperties: false,
          properties: {
            key: { minLength: 1, type: "string" },
            provider: { pattern: DCS_SECRET_PROVIDER_ID_PATTERN, type: "string" },
          },
          required: ["provider", "key"],
          type: "object",
        },
      },
      required: ["$secret"],
      type: "object",
    },
    node.nullable,
  );

  return compileValueDefault(node, schema, path, options, "secret reference");
}

function compileObject(
  node: DcsConfigIrObjectNode,
  path: string,
  options: CompileOptions,
): CompiledNode {
  const properties: Record<string, JsonValue> = {};
  const required: string[] = [];
  const defaults: Record<string, JsonValue> = {};
  const fields: Record<string, DcsFieldMetadata> = {};

  for (const key of Object.keys(node.shape).sort()) {
    const childNode = node.shape[key] as DcsConfigIrNode;
    const child = compileNode(childNode, `${path}/${escapeJsonPointerSegment(key)}`, options);
    Object.defineProperty(properties, key, {
      value: child.schema,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.assign(fields, child.fields);

    if (!childNode.optional) {
      required.push(key);
    }

    if (child.defaultValue !== undefined) {
      Object.defineProperty(defaults, key, {
        value: child.defaultValue,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  const schema: JsonSchema = withNullable(
    {
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
      type: "object",
    },
    node.nullable,
  );

  if (node.optional) {
    return {
      fields,
      hasDefault: false,
      schema,
    };
  }

  return {
    defaultValue: defaults,
    fields,
    hasDefault: true,
    schema,
  };
}

function compileValueDefault(
  node: DcsConfigIrNode,
  schema: JsonSchema,
  path: string,
  options: CompileOptions,
  description: string,
): CompiledNode {
  const fields: Record<string, DcsFieldMetadata> = {};

  if (node.defaultValue === undefined) {
    if (!node.optional && options.requireDefaults) {
      options.diagnostics.push(
        error("DCS1106", `Required ${description} field ${path} must declare a default.`, path),
      );
    }

    return { fields, hasDefault: false, schema };
  }

  if (node.secret && !isSecretReference(node.defaultValue)) {
    options.diagnostics.push(
      error("DCS1107", `Secret field ${path} must not use raw secret material as a default.`, path),
    );
  }

  for (const issue of validateJsonValueAgainstSchema(node.defaultValue, schema, path)) {
    options.diagnostics.push(
      error("DCS1108", `Invalid default at ${path}: ${issue.message}`, issue.path),
    );
  }

  return {
    defaultValue: cloneJsonValue(node.defaultValue),
    fields,
    hasDefault: true,
    schema,
  };
}

function metadataFor(node: DcsConfigIrNode): DcsFieldMetadata {
  return {
    ...(node.collection === undefined ? {} : { collection: { ...node.collection } }),
    ...(node.deprecated === undefined ? {} : { deprecated: node.deprecated }),
    merge: node.merge,
    ...(node.presentation === undefined ? {} : { presentation: { ...node.presentation } }),
    resettable: node.resettable,
    scopes: [...node.scopes],
    secret: node.secret,
    ...(node.visibility === undefined ? {} : { visibility: node.visibility }),
  };
}

function withNullable(schema: JsonSchema, nullable: boolean): JsonSchema {
  if (!nullable) {
    return schema;
  }

  if (typeof schema.type === "string") {
    return { ...schema, type: [schema.type, "null"] };
  }

  return { ...schema, type: ["null"] };
}

function error(code: string, message: string, path?: string): DcsDiagnostic {
  return { code, message, ...(path === undefined ? {} : { path }), severity: "error" };
}

interface CompiledNode {
  readonly defaultValue?: JsonValue;
  readonly fields: Record<string, DcsFieldMetadata>;
  readonly hasDefault: boolean;
  readonly schema: JsonSchema;
}

type CompileOptions = {
  readonly diagnostics: DcsDiagnostic[];
  readonly emitMetadata: boolean;
  readonly requireDefaults: boolean;
};

/**
 * The inspectable, JSON-serializable compiler artifact for DCS authoring
 * definitions. It is intentionally versioned separately from CCB: an IR may
 * evolve faster than the stable portable contract consumed by other runtimes.
 */
export const DCS_CONFIG_IR_ARTIFACT_VERSION = "0.0.1" as const;

export interface DcsConfigIrArtifact {
  readonly $dcs: {
    readonly contract: DcsMetadata;
    readonly format: "dcs-config-ir";
    readonly version: typeof DCS_CONFIG_IR_ARTIFACT_VERSION;
  };
  readonly ir: DcsConfigIr;
}

export class DcsConfigIrArtifactValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DcsConfigIrArtifactValidationError";
  }
}

/**
 * Creates a normalised compiler artifact from a language-neutral Config IR.
 * The CCB compiler is invoked as validation, but the artifact remains an
 * intermediate representation rather than an interoperability target.
 */
export function createDcsConfigIrArtifact(ir: DcsConfigIr): DcsConfigIrArtifact {
  // Validate semantic invariants before writing an artifact that another tool
  // might inspect. The returned CCB is deliberately not embedded here.
  generateConfigContractBundleFromIr(ir);
  const snapshot = cloneIr(ir);
  return Object.freeze({
    $dcs: Object.freeze({
      contract: Object.freeze({ ...snapshot.$dcs }),
      format: "dcs-config-ir" as const,
      version: DCS_CONFIG_IR_ARTIFACT_VERSION,
    }),
    ir: snapshot,
  });
}

/** Serializes the compiler artifact deterministically for inspection or CI. */
export function serializeDcsConfigIrArtifact(ir: DcsConfigIr): string {
  return `${canonicalizeJson(createDcsConfigIrArtifact(ir) as unknown as JsonValue)}\n`;
}

/**
 * Parses a committed compiler artifact without ever executing authoring code.
 * Hosts should use this for `dcs inspect-ir` and artifact forwarding only.
 */
export function parseDcsConfigIrArtifact(input: string | JsonValue): DcsConfigIrArtifact {
  let value: JsonValue;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as JsonValue;
    } catch {
      throw new DcsConfigIrArtifactValidationError("DCS Config IR artifact must be valid JSON.");
    }
  } else {
    value = input;
  }

  if (!isJsonObject(value) || !isJsonObject(value.$dcs) || !isJsonObject(value.ir)) {
    throw new DcsConfigIrArtifactValidationError(
      "DCS Config IR artifact must contain $dcs and ir objects.",
    );
  }

  const metadata = value.$dcs;
  const contract = metadata.contract;
  if (
    metadata.format !== "dcs-config-ir" ||
    metadata.version !== DCS_CONFIG_IR_ARTIFACT_VERSION ||
    !isJsonObject(contract)
  ) {
    throw new DcsConfigIrArtifactValidationError(
      "DCS Config IR artifact has an unsupported $dcs identity.",
    );
  }

  const ir = value.ir as unknown as DcsConfigIr;
  assertDcsConfigIrShape(ir);
  const artifact = createDcsConfigIrArtifact(ir);
  if (
    canonicalizeJson(artifact.$dcs.contract as unknown as JsonValue) !== canonicalizeJson(contract)
  ) {
    throw new DcsConfigIrArtifactValidationError(
      "DCS Config IR artifact contract metadata does not match ir.$dcs.",
    );
  }
  return artifact;
}

function cloneIr(ir: DcsConfigIr): DcsConfigIr {
  return JSON.parse(canonicalizeJson(ir as unknown as JsonValue)) as DcsConfigIr;
}

function assertDcsConfigIrShape(ir: DcsConfigIr): void {
  if (!isJsonObject(ir) || !isJsonObject(ir.$dcs) || !isJsonObject(ir.root)) {
    throw new DcsConfigIrArtifactValidationError(
      "DCS Config IR must contain $dcs metadata and an object root.",
    );
  }
  const metadata = ir.$dcs as unknown as Record<string, unknown>;
  for (const key of ["id", "fileStem", "specVersion"]) {
    if (typeof metadata[key] !== "string" || (metadata[key] as string).length === 0) {
      throw new DcsConfigIrArtifactValidationError(
        `DCS Config IR metadata ${key} must be a non-empty string.`,
      );
    }
  }
  for (const key of ["contractVersion", "documentVersion"]) {
    if (!Number.isInteger(metadata[key]) || (metadata[key] as number) < 0) {
      throw new DcsConfigIrArtifactValidationError(
        `DCS Config IR metadata ${key} must be a non-negative integer.`,
      );
    }
  }
  assertIrNode(ir.root, "/root");
  if (ir.root.kind !== "object") {
    throw new DcsConfigIrArtifactValidationError("DCS Config IR root must be an object node.");
  }
}

function assertIrNode(node: unknown, path: string): asserts node is DcsConfigIrNode {
  if (!isJsonObject(node) || typeof node.kind !== "string") {
    throw new DcsConfigIrArtifactValidationError(
      `DCS Config IR node at ${path} must be an object with a kind.`,
    );
  }
  const kind = node.kind;
  if (
    !["array", "boolean", "enum", "number", "object", "secret-reference", "string"].includes(kind)
  ) {
    throw new DcsConfigIrArtifactValidationError(
      `DCS Config IR node at ${path} has unsupported kind ${JSON.stringify(kind)}.`,
    );
  }
  if (node.defaultValue !== undefined && !isJsonValue(node.defaultValue)) {
    throw new DcsConfigIrArtifactValidationError(
      `DCS Config IR default at ${path} must be JSON data.`,
    );
  }
  if (node.merge !== "deep" && node.merge !== "replace") {
    throw new DcsConfigIrArtifactValidationError(
      `DCS Config IR node at ${path} has an unsupported merge strategy.`,
    );
  }
  for (const key of ["nullable", "optional", "resettable", "secret"]) {
    if (typeof node[key] !== "boolean") {
      throw new DcsConfigIrArtifactValidationError(
        `DCS Config IR node at ${path} requires boolean ${key}.`,
      );
    }
  }
  if (
    !Array.isArray(node.scopes) ||
    node.scopes.some(
      (scope) =>
        scope !== "user" && scope !== "workspace" && scope !== "local" && scope !== "invocation",
    )
  ) {
    throw new DcsConfigIrArtifactValidationError(
      `DCS Config IR node at ${path} has invalid scopes.`,
    );
  }
  if (kind === "array") {
    assertIrNode(node.item, `${path}/item`);
  }
  if (kind === "enum") {
    if (
      !Array.isArray(node.values) ||
      node.values.some(
        (value) =>
          value !== null &&
          typeof value !== "boolean" &&
          typeof value !== "number" &&
          typeof value !== "string",
      )
    ) {
      throw new DcsConfigIrArtifactValidationError(
        `DCS Config IR enum at ${path} must contain JSON primitive values.`,
      );
    }
  }
  if (kind === "object") {
    if (!isJsonObject(node.shape)) {
      throw new DcsConfigIrArtifactValidationError(
        `DCS Config IR object at ${path} must contain a shape object.`,
      );
    }
    for (const [key, child] of Object.entries(node.shape)) {
      assertIrNode(child, `${path}/${escapeJsonPointerSegment(key)}`);
    }
  }
}
