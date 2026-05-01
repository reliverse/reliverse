export type DeclarDiagnosticCode =
  | "DECLAR_EXPORT_CONDITION_UNSUPPORTED"
  | "DECLAR_EXPORT_MISSING_RUNTIME_TARGET"
  | "DECLAR_EXPORT_MISSING_TYPES"
  | "DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED"
  | "DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED"
  | "DECLAR_EXPORT_TARGET_NOT_RELATIVE"
  | "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST"
  | "DECLAR_EXPORT_UNSUPPORTED_SHAPE"
  | "DECLAR_PACKAGE_MISSING_EXPORTS";

export type DeclarDiagnosticSeverity = "error" | "info" | "warning";

export interface DeclarDiagnostic {
  readonly code: DeclarDiagnosticCode;
  readonly message: string;
  readonly path?: readonly string[] | undefined;
  readonly severity: DeclarDiagnosticSeverity;
}

export type DeclarEntrypointKind = "root" | "subpath" | "pattern";

export interface DeclarConditionPath {
  readonly condition: string;
  readonly path: string;
}

export interface DeclarEntrypoint {
  readonly exportPath: string;
  readonly kind: DeclarEntrypointKind;
  readonly defaultPath?: string | undefined;
  readonly defaultTypesPath?: string | undefined;
  readonly importPath?: string | undefined;
  readonly importTypesPath?: string | undefined;
  readonly requirePath?: string | undefined;
  readonly requireTypesPath?: string | undefined;
  readonly runtimeConditions: readonly DeclarConditionPath[];
  readonly sourcePath?: string | undefined;
  readonly typesConditions: readonly DeclarConditionPath[];
  readonly typesPath?: string | undefined;
}

export interface DeclarPackageJson {
  readonly exports?: unknown;
  readonly main?: string | undefined;
  readonly module?: string | undefined;
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly types?: string | undefined;
  readonly typings?: string | undefined;
}

export interface DeclarPipelineOptions {
  readonly declarationMap?: boolean | undefined;
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly packageJson: DeclarPackageJson;
  readonly rollup?: boolean | undefined;
  readonly tsconfigPath?: string | undefined;
  readonly updatePackageJson?: boolean | undefined;
}

export interface DeclarPipelinePlan {
  readonly declarationMap: boolean;
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly outDir: string;
  readonly packageDir: string;
  readonly phases: readonly DeclarPipelinePhase[];
  readonly rollup: boolean;
  readonly tsconfigPath: string;
  readonly updatePackageJson: boolean;
}

export type DeclarPipelinePhase =
  | "bundle-declarations"
  | "discover-entrypoints"
  | "read-tsconfig"
  | "typescript-declaration-emit"
  | "validate-package-types"
  | "warn"
  | "wire-package-types";
