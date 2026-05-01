export type DeclarDiagnosticCode =
  | "DECLAR_BUNDLE_CYCLE"
  | "DECLAR_BUNDLE_ENTRYPOINT_MISSING"
  | "DECLAR_BUNDLE_NAME_COLLISION"
  | "DECLAR_BUNDLE_PATTERN_TARGET_UNSUPPORTED"
  | "DECLAR_BUNDLE_READ_FAILED"
  | "DECLAR_BUNDLE_TYPESCRIPT_CHECK_FAILED"
  | "DECLAR_BUNDLE_UNRESOLVED_LOCAL_IMPORT"
  | "DECLAR_BUNDLE_WRITE_FAILED"
  | "DECLAR_DECLARATION_TARGET_MISSING"
  | "DECLAR_DECLARATION_TARGET_NOT_EMITTED"
  | "DECLAR_EXPORT_CONDITION_UNSUPPORTED"
  | "DECLAR_EXPORT_MISSING_RUNTIME_TARGET"
  | "DECLAR_EXPORT_MISSING_TYPES"
  | "DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED"
  | "DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED"
  | "DECLAR_EXPORT_TARGET_NOT_RELATIVE"
  | "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST"
  | "DECLAR_EXPORT_UNSUPPORTED_SHAPE"
  | "DECLAR_FAST_PATH_EMITTER_UNAVAILABLE"
  | "DECLAR_FAST_PATH_FALLBACK"
  | "DECLAR_FAST_PATH_INVALID_OUTPUT"
  | "DECLAR_FAST_PATH_SKIPPED"
  | "DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX"
  | "DECLAR_FAST_PATH_USED"
  | "DECLAR_PACKAGE_JSON_WRITE_FAILED"
  | "DECLAR_PACKAGE_MISSING_EXPORTS"
  | "DECLAR_PACKAGE_WIRING_UNSUPPORTED"
  | "DECLAR_RUNTIME_TARGET_MISSING"
  | "DECLAR_TARGET_OUTSIDE_PACKAGE"
  | "DECLAR_TSCONFIG_PARSE_FAILED"
  | "DECLAR_TSCONFIG_READ_FAILED"
  | "DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE"
  | "DECLAR_TYPESCRIPT_EMIT_FAILED";

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

export type DeclarFastDeclarationMode = false | "auto" | "typescript";

export type DeclarFastDeclarationOption = DeclarFastDeclarationMode | true;

export type DeclarFastDeclarationFallback = "error" | "typescript";

export interface DeclarPipelineOptions {
  readonly declarationMap?: boolean | undefined;
  readonly fastDeclarationFallback?: DeclarFastDeclarationFallback | undefined;
  readonly fastDeclarations?: DeclarFastDeclarationOption | undefined;
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
  readonly fastDeclarationFallback: DeclarFastDeclarationFallback;
  readonly fastDeclarations: DeclarFastDeclarationMode;
  readonly outDir: string;
  readonly packageDir: string;
  readonly phases: readonly DeclarPipelinePhase[];
  readonly rollup: boolean;
  readonly tsconfigPath: string;
  readonly updatePackageJson: boolean;
}

export type DeclarPipelinePhase =
  | "read-tsconfig"
  | "discover-entrypoints"
  | "fast-isolated-declaration-emit"
  | "typescript-declaration-emit"
  | "validate-package-types"
  | "bundle-declarations"
  | "wire-package-types"
  | "warn";

export interface DeclarEntrypointDiscoveryResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly entrypoints: readonly DeclarEntrypoint[];
}

export interface DeclarEntrypointDiscoveryValueResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly entrypoint?: DeclarEntrypoint | undefined;
}
