import {
  assertJsonValue,
  canonicalizeJson,
  cloneJsonValue,
  DcsConfigIrValidationError,
  digestCanonicalJson,
  generateConfigContractBundleFromIr,
  type DcsConfigIr,
  type DcsConfigIrArtifact,
  createDcsConfigIrArtifact,
  serializeDcsConfigIrArtifact,
  type DcsConfigIrNode,
  type DcsCollectionMetadata,
  type DcsSecretReference,
  type DcsFieldPresentation,
  type DcsExtensionRequirement,
  type DcsMergeStrategy,
  type DcsMigrationPlan,
  type DcsScope,
  type ConfigContractBundle,
  type JsonPrimitive,
  type JsonValue,
} from "@reliverse/dcs-contract";

import { buildDcsArtifacts, type DcsArtifactBuild, type DcsArtifactBuildOptions } from "./build";

const fieldBrand = Symbol("@reliverse/dcs/field");
const defaultScopes = [
  "user",
  "workspace",
  "local",
  "invocation",
] as const satisfies readonly DcsScope[];

type FieldKind = "array" | "boolean" | "enum" | "number" | "object" | "secret-reference" | "string";

interface FieldOptions {
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

interface BaseNode extends FieldOptions {
  readonly kind: FieldKind;
}

interface ArrayNode extends BaseNode {
  readonly item: InternalNode;
  readonly kind: "array";
}

interface EnumNode extends BaseNode {
  readonly kind: "enum";
  readonly values: readonly JsonPrimitive[];
}

interface ObjectNode extends BaseNode {
  readonly kind: "object";
  readonly shape: ConfigShape;
}

type PrimitiveNode = BaseNode & {
  readonly kind: "boolean" | "number" | "secret-reference" | "string";
};

type InternalNode = ArrayNode | EnumNode | ObjectNode | PrimitiveNode;

interface FieldLike {
  readonly [fieldBrand]: InternalNode;
}

export interface ConfigField<Value, Optional extends boolean = false> extends FieldLike {
  collection(value: DcsCollectionMetadata): ConfigField<Value, Optional>;
  default(value: Value): ConfigField<Value, false>;
  deprecated(value?: boolean | string): ConfigField<Value, Optional>;
  merge(value: DcsMergeStrategy): ConfigField<Value, Optional>;
  nullable(): ConfigField<Value | null, Optional>;
  optional(): ConfigField<Value, true>;
  presentation(value: DcsFieldPresentation): ConfigField<Value, Optional>;
  resettable(value?: boolean): ConfigField<Value, Optional>;
  scopes(value: readonly DcsScope[]): ConfigField<Value, Optional>;
  secret(value?: boolean): ConfigField<Value, Optional>;
  visibility(value: string): ConfigField<Value, Optional>;
}

export type ConfigShape = Readonly<Record<string, FieldLike>>;

type FieldValue<Field> = Field extends ConfigField<infer Value, boolean> ? Value : never;
type FieldOptional<Field> = Field extends ConfigField<unknown, infer Optional> ? Optional : never;

type RequiredKeys<Shape extends ConfigShape> = {
  [Key in keyof Shape]-?: FieldOptional<Shape[Key]> extends true ? never : Key;
}[keyof Shape];

type OptionalKeys<Shape extends ConfigShape> = {
  [Key in keyof Shape]-?: FieldOptional<Shape[Key]> extends true ? Key : never;
}[keyof Shape];

export type InferConfigShape<Shape extends ConfigShape> = {
  [Key in RequiredKeys<Shape>]: FieldValue<Shape[Key]>;
} & {
  [Key in OptionalKeys<Shape>]?: FieldValue<Shape[Key]>;
};

/** @deprecated Use the canonical DcsSecretReference type from @reliverse/dcs-contract. */
export type SecretReference = DcsSecretReference;

export interface DefineConfigInput<Shape extends ConfigShape> {
  readonly contractVersion?: number;
  readonly documentVersion?: number;
  readonly fileStem: string;
  readonly id: string;
  /** Local extension descriptor compatibility constraints emitted into the CCB. */
  readonly extensionRequirements?: readonly DcsExtensionRequirement[];
  /** Declarative migration routes emitted into the target Config Contract Bundle. */
  readonly migrations?: readonly DcsMigrationPlan[];
  readonly root: ConfigField<InferConfigShape<Shape>, false>;
}

export interface DefinedConfig<Value> {
  readonly bundle: ConfigContractBundle;
  buildArtifacts(options?: Omit<DcsArtifactBuildOptions, "ir">): Promise<DcsArtifactBuild>;
  toIrArtifact(): DcsConfigIrArtifact;
  toIrJson(): string;
  readonly configType?: Value;
  readonly ir: DcsConfigIr;
  digest(): Promise<string>;
  toBundle(): ConfigContractBundle;
  toJson(): string;
}

export class ConfigDefinitionError extends Error {
  public readonly diagnostics: readonly import("@reliverse/dcs-contract").DcsDiagnostic[];

  public constructor(diagnostics: readonly import("@reliverse/dcs-contract").DcsDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n") || "Config definition is invalid.",
    );
    this.name = "ConfigDefinitionError";
    this.diagnostics = diagnostics;
  }
}

export const c = Object.freeze({
  array<Item extends FieldLike>(item: Item): ConfigField<FieldValue<Item>[], false> {
    return createField({ ...baseOptions(), item: readNode(item), kind: "array" });
  },

  boolean(): ConfigField<boolean, false> {
    return createField({ ...baseOptions(), kind: "boolean" });
  },

  enum<const Values extends readonly [JsonPrimitive, ...JsonPrimitive[]]>(
    values: Values,
  ): ConfigField<Values[number], false> {
    if (values.length === 0) {
      throw new TypeError("c.enum() requires at least one JSON primitive value.");
    }

    for (const value of values) {
      assertJsonValue(value);
    }

    return createField({ ...baseOptions(), kind: "enum", values: [...values] });
  },

  number(): ConfigField<number, false> {
    return createField({ ...baseOptions(), kind: "number" });
  },

  object<Shape extends ConfigShape>(shape: Shape): ConfigField<InferConfigShape<Shape>, false> {
    return createField({ ...baseOptions(), kind: "object", shape });
  },

  secretReference(): ConfigField<SecretReference, true> {
    return createField({
      ...baseOptions(),
      kind: "secret-reference",
      optional: true,
      secret: true,
    });
  },

  string(): ConfigField<string, false> {
    return createField({ ...baseOptions(), kind: "string" });
  },
});

export function defineConfig<Shape extends ConfigShape>(
  input: DefineConfigInput<Shape>,
): DefinedConfig<InferConfigShape<Shape>> {
  const root = readNode(input.root);
  if (root.kind !== "object") {
    throw new ConfigDefinitionError([
      {
        code: "DCS1101",
        message: "defineConfig() root must be c.object(...).",
        path: "/root",
        severity: "error",
      },
    ]);
  }

  const ir: DcsConfigIr = {
    $dcs: {
      contractVersion: input.contractVersion ?? 1,
      documentVersion: input.documentVersion ?? 1,
      fileStem: input.fileStem,
      id: input.id,
      specVersion: "0.0.1",
    },
    ...(input.extensionRequirements === undefined
      ? {}
      : { extensionRequirements: input.extensionRequirements }),
    ...(input.migrations === undefined ? {} : { migrations: input.migrations }),
    root: toIrNode(root) as DcsConfigIr["root"],
  };

  let bundle: ConfigContractBundle;
  try {
    bundle = generateConfigContractBundleFromIr(ir);
  } catch (error) {
    if (error instanceof DcsConfigIrValidationError) {
      throw new ConfigDefinitionError(error.diagnostics);
    }

    throw error;
  }

  return Object.freeze({
    bundle,
    buildArtifacts(options: Omit<DcsArtifactBuildOptions, "ir"> | undefined) {
      return buildDcsArtifacts(bundle, { ...options, emitIr: options?.emitIr ?? true, ir });
    },
    toIrArtifact() {
      return createDcsConfigIrArtifact(ir);
    },
    toIrJson() {
      return serializeDcsConfigIrArtifact(ir);
    },
    digest() {
      return digestCanonicalJson(bundle as unknown as JsonValue);
    },
    ir,
    toBundle() {
      return bundle;
    },
    toJson() {
      return `${canonicalizeJson(bundle as unknown as JsonValue)}\n`;
    },
  });
}

function baseOptions(): FieldOptions {
  return {
    merge: "replace",
    nullable: false,
    optional: false,
    resettable: true,
    scopes: defaultScopes,
    secret: false,
  };
}

function createField<Value, Optional extends boolean = false>(
  node: InternalNode,
): ConfigField<Value, Optional> {
  const update = <NextValue, NextOptional extends boolean>(
    patch: Partial<FieldOptions>,
  ): ConfigField<NextValue, NextOptional> => createField({ ...node, ...patch } as InternalNode);

  return Object.freeze({
    [fieldBrand]: node,
    collection(value: DcsCollectionMetadata): ConfigField<Value, Optional> {
      return update<Value, Optional>({ collection: { ...value } });
    },
    default(value: Value): ConfigField<Value, false> {
      assertJsonValue(value);
      return update<Value, false>({ defaultValue: cloneJsonValue(value) });
    },
    deprecated(value: boolean | string = true): ConfigField<Value, Optional> {
      return update<Value, Optional>({ deprecated: value });
    },
    merge(value: DcsMergeStrategy): ConfigField<Value, Optional> {
      return update<Value, Optional>({ merge: value });
    },
    nullable(): ConfigField<Value | null, Optional> {
      return update<Value | null, Optional>({ nullable: true });
    },
    optional(): ConfigField<Value, true> {
      return update<Value, true>({ optional: true });
    },
    presentation(value: DcsFieldPresentation): ConfigField<Value, Optional> {
      return update<Value, Optional>({ presentation: { ...value } });
    },
    resettable(value = true): ConfigField<Value, Optional> {
      return update<Value, Optional>({ resettable: value });
    },
    scopes(value: readonly DcsScope[]): ConfigField<Value, Optional> {
      return update<Value, Optional>({ scopes: [...value] });
    },
    secret(value = true): ConfigField<Value, Optional> {
      return update<Value, Optional>({ secret: value });
    },
    visibility(value: string): ConfigField<Value, Optional> {
      return update<Value, Optional>({ visibility: value });
    },
  }) as ConfigField<Value, Optional>;
}

function readNode(value: FieldLike): InternalNode {
  if (!(fieldBrand in value)) {
    throw new TypeError("Expected a field created by @reliverse/dcs c.*().");
  }

  return value[fieldBrand];
}

function toIrNode(node: InternalNode): DcsConfigIrNode {
  const options = toIrOptions(node);

  switch (node.kind) {
    case "array":
      return { ...options, item: toIrNode(node.item), kind: "array" };
    case "boolean":
      return { ...options, kind: "boolean" };
    case "enum":
      return { ...options, kind: "enum", values: [...node.values] };
    case "number":
      return { ...options, kind: "number" };
    case "object": {
      const shape: Record<string, DcsConfigIrNode> = {};
      for (const key of Object.keys(node.shape).sort()) {
        shape[key] = toIrNode(readNode(node.shape[key] as FieldLike));
      }
      return { ...options, kind: "object", shape };
    }
    case "secret-reference":
      return { ...options, kind: "secret-reference" };
    case "string":
      return { ...options, kind: "string" };
  }
}

function toIrOptions(node: InternalNode): Omit<DcsConfigIrNode, "kind"> {
  return {
    ...(node.defaultValue === undefined ? {} : { defaultValue: cloneJsonValue(node.defaultValue) }),
    ...(node.collection === undefined ? {} : { collection: { ...node.collection } }),
    ...(node.deprecated === undefined ? {} : { deprecated: node.deprecated }),
    merge: node.merge,
    nullable: node.nullable,
    optional: node.optional,
    ...(node.presentation === undefined ? {} : { presentation: { ...node.presentation } }),
    resettable: node.resettable,
    scopes: [...node.scopes],
    secret: node.secret,
    ...(node.visibility === undefined ? {} : { visibility: node.visibility }),
  } as Omit<DcsConfigIrNode, "kind">;
}
