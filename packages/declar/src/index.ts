export {
  createDeclarDiagnostic,
  createDeclarError,
  createDeclarWarning,
  hasDeclarErrors,
} from "./diagnostics";
export { discoverPackageEntrypoints } from "./package-exports";
export { createDeclarPipelinePlan } from "./plan";
export { loadDeclarTsconfig } from "./tsconfig";
export { emitTypeScriptDeclarations } from "./typescript-emit";
export { collectDeclarConditionPaths, validateDeclarEntrypointFiles } from "./validate";
export type {
  DeclarConditionPath,
  DeclarDiagnostic,
  DeclarDiagnosticCode,
  DeclarDiagnosticSeverity,
  DeclarEntrypoint,
  DeclarEntrypointDiscoveryResult,
  DeclarEntrypointDiscoveryValueResult,
  DeclarEntrypointKind,
  DeclarPackageJson,
  DeclarPipelineOptions,
  DeclarPipelinePhase,
  DeclarPipelinePlan,
} from "./types";
export type {
  DeclarParsedCommandLine,
  DeclarReadConfigFileResult,
  DeclarTsconfigLoadOptions,
  DeclarTsconfigLoadResult,
  DeclarTypeScriptConfigAdapter,
  DeclarTypeScriptConfigHost,
  DeclarTypeScriptSys,
} from "./tsconfig";
export type {
  DeclarTypeScriptDeclarationEmitOptions,
  DeclarTypeScriptDeclarationEmitResult,
  DeclarTypeScriptEmitAdapter,
  DeclarTypeScriptEmitOutput,
  DeclarTypeScriptFormatHost,
  DeclarTypeScriptProgram,
} from "./typescript-emit";
export type {
  DeclarEntrypointFileValidationOptions,
  DeclarEntrypointFileValidationResult,
  DeclarFileSystemHost,
} from "./validate";
