export {
  DCS_SECRET_PROVIDER_REGISTRY_VERSION,
  DcsSecretValue,
  createDcsSecretProviderRegistry,
  createDcsSecretValue,
  dcsSecret,
  redactDcsSecretResolution,
  revealDcsSecretValue,
  resolveDcsSecretReference,
  type DcsRedactedSecretResolution,
  type DcsSecretProvider,
  type DcsSecretProviderRegistry,
  type DcsSecretProviderResult,
  type DcsSecretResolution,
} from "./secrets";

/**
 * Browser-safe DCS SDK entry point.
 *
 * It contains TS authoring and pure document-operation types only. Filesystem
 * discovery, safe writes, and server adapters intentionally live under
 * `@reliverse/dcs/node` or `@reliverse/dcs/bun` so frontend bundles
 * never acquire a hidden `node:fs` dependency.
 */
export {
  c,
  ConfigDefinitionError,
  defineConfig,
  type ConfigField,
  type ConfigShape,
  type DefineConfigInput,
  type DefinedConfig,
  type InferConfigShape,
  type SecretReference,
} from "./dsl";
export {
  applyDcsDocumentPatch,
  createDcsConfigDocument,
  createDcsConfigDocumentSchema,
  createDcsEditorModel,
  type CreateDcsEditorModelOptions,
  type DcsDocumentOperation,
  type DcsConfigRevisions,
  type DcsDocumentPatch,
  type DcsDocumentRevision,
  type DcsEffectiveRevision,
  type DcsSemanticRevision,
  type DcsEditorDocument,
  type DcsEditorExtension,
  type DcsEditorField,
  type DcsEditorFieldState,
  type DcsEditorGroup,
  type DcsEditorModel,
} from "./editor";
export {
  buildDcsArtifacts,
  generateDcsTypeScriptDeclarations,
  type DcsArtifactBuild,
  type DcsArtifactManifest,
  type DcsArtifactManifestEntry,
  type DcsSdkArtifactKind,
  type DcsArtifactBuildOptions,
} from "./build";
export {
  DCS_EDITOR_INVALIDATION_VERSION,
  DCS_EDITOR_SESSION_VERSION,
  applyDcsEditorSessionPatch,
  createDcsEditorInvalidationEvent,
  createDcsEditorSession,
  createDcsEditorSessionView,
  rebaseDcsDocumentPatch,
  type CreateDcsEditorSessionOptions,
  type DcsDocumentRebaseResult,
  type DcsEditorCollectionConflict,
  type DcsEditorDocumentConflict,
  type DcsEditorInvalidationCause,
  type DcsEditorInvalidationEvent,
  type DcsEditorSession,
  type DcsEditorSessionRevisions,
  type DcsEditorSessionPatchSummary,
  type DcsEditorSessionView,
} from "./session";
export {
  createDcsSecretReference,
  redactDcsSecretReferences,
  summarizeDcsSecretReference,
  type DcsSecretReference,
  type DcsSecretReferenceSummary,
} from "@reliverse/dcs-contract";

export {
  DCS_PROFILE_NAME_PATTERN,
  assertDcsProfileName,
  isDcsProfileName,
  type DcsProfileName,
} from "@reliverse/dcs-contract";

export {
  parseConfigDocument,
  type ConfigDocumentScope,
  type ParseConfigDocumentOptions,
  type ParseConfigDocumentResult,
  type ParsedConfigDocument,
  type PersistentConfigScope,
} from "./document";
export {
  explainConfigPath,
  resolveConfigLayers,
  type DcsConfigLayerSource,
  type DcsConfigSource,
  type DcsConfigSourceKind,
  type DcsEffectiveConfigSource,
  type DcsFieldProvenance,
  type DcsMixedConfigSource,
  type DcsProvenanceAction,
  type DcsProvenanceSource,
  type DcsResolvedConfig,
  type DcsResolvedExtensionLayer,
  type DcsResolutionLayer,
  type ResolveConfigLayersOptions,
  type ResolveConfigLayersResult,
} from "@reliverse/dcs-contract";
