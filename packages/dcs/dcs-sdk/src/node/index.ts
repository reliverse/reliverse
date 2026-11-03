export {
  createDcsEnvironmentSecretProvider,
  createDcsFileSecretProvider,
  createDcsKeychainSecretProvider,
  type DcsEnvironmentSecretProviderOptions,
  type DcsFileSecretProviderOptions,
  type DcsKeychainSecretProviderOptions,
} from "./secrets";

export {
  createDcsHostConfigProvider,
  type DcsHostConfigProviderOptions,
  type DcsHostConfigResolution,
  type DcsHostResolveInput,
} from "./host-provider";

export {
  DCS_DISCOVERY_FORMATS,
  defineDcsOwner,
  discoverDcsOwnerConfig,
  type DcsDiscoveryCandidate,
  type DcsDiscoveryDiagnostic,
  type DcsDiscoveryFormat,
  type DcsDiscoveryKind,
  type DcsDiscoveryLayout,
  type DcsDiscoveryScope,
  type DcsDiscoveryScopeRoot,
  type DcsOwnerDiscoveryPlan,
  type DcsOwnerRegistration,
  type DefinedDcsOwner,
  type DiscoverDcsOwnerConfigOptions,
} from "./owner-discovery";

/** Node/Bun server-side DCS host adapter. */
export {
  discoverConfigDocuments,
  effectiveConfigRevision,
  explainConfig,
  locateConfig,
  locateConfigVariants,
  locateProfileConfig,
  locateProfileConfigVariants,
  resolveConfig,
  validateConfig,
  type CanonicalConfigPaths,
  type CanonicalConfigPathVariants,
  type DcsReferencePlatform,
  type DcsDiscoveredProfile,
  type DiscoverConfigDocumentsOptions,
  type DiscoverConfigDocumentsResult,
  type DiscoveredConfigDocument,
  type ExplainConfigOptions,
  type ExplainConfigResult,
  type ResolveConfigOptions,
  type ResolveConfigResult,
} from "./discovery";
export {
  DcsConfigDocumentFormatConflictError,
  DcsConfigDocumentValidationError,
  DcsConfigWriteConflictError,
  DcsConfigWriteExistsError,
  DcsConfigWriteLockError,
  initializeConfigDocument,
  mutateConfigDocument,
  readConfigDocumentForEdit,
  replaceConfigDocument,
  type DcsConfigDocumentMutationOptions,
  type DcsConfigDocumentReplacementOptions,
  type DcsConfigDocumentSnapshot,
  type DcsConfigWriteResult,
  type DcsInitializeConfigDocumentOptions,
  type ReadDcsConfigDocumentOptions,
} from "./writer";

export {
  checkDcsGeneratedArtifacts,
  writeDcsGeneratedArtifacts,
  writeDcsSchemaProjection,
  type DcsGeneratedArtifactState,
  type DcsGeneratedArtifactStatus,
  type DcsGeneratedArtifactsCheckResult,
  type DcsGeneratedArtifactsOptions,
  type DcsGeneratedArtifactsWriteResult,
} from "./build";

export {
  commitDcsEditorSession,
  openDcsEditorSession,
  type DcsEditorSessionCommitOptions,
  type DcsEditorSessionCommitResult,
  type DcsEditorSessionOpenOptions,
} from "./session";

export {
  DCS_MIGRATION_RECEIPT_FORMAT,
  DcsMigrationPlanNotFoundError,
  applyDcsConfigMigration,
  planDcsConfigMigration,
  readMigrationReceipt,
  restoreDcsConfigMigration,
  type ApplyDcsConfigMigrationOptions,
  type ApplyDcsConfigMigrationResult,
  type DcsMigrationPlanResult,
  type DcsMigrationReceipt,
  type PlanDcsConfigMigrationOptions,
  type RestoreDcsConfigMigrationOptions,
  type RestoreDcsConfigMigrationResult,
} from "./migration";

export {
  loadDcsExtensionRegistry,
  readPackageExtensionBundles,
  type DcsExtensionBundleSource,
  type DcsExtensionRegistryLoadResult,
  type LoadDcsExtensionRegistryOptions,
} from "./extensions";

export {
  DcsUiGeneratedSourceConflictError,
  DcsUiProjectCompatibilityError,
  doctorDcsUiProject,
  generateDcsUi,
  type DcsUiDoctorCheck,
  type DcsUiDoctorCheckStatus,
  type DcsUiDoctorOptions,
  type DcsUiDoctorResult,
  type GenerateDcsUiOptions,
  type GenerateDcsUiResult,
} from "./ui";

export {
  DCS_LOCK_GENERATOR,
  DcsConfigLockMismatchError,
  DcsConfigLockResolutionError,
  DcsConfigLockValidationError,
  assertDcsFrozenResolve,
  createDcsConfigLockfile,
  diffDcsConfigLockfile,
  explainDcsConfigLockfile,
  locateDcsConfigLockfile,
  readDcsConfigLockfile,
  verifyDcsConfigLockfile,
  writeDcsConfigLockfile,
  type DcsConfigLockDiffEntry,
  type DcsConfigLockDiffResult,
  type DcsConfigLockOptions,
  type DcsConfigLockVerifyOptions,
  type DcsConfigLockVerifyResult,
  type DcsConfigLockWriteOptions,
  type DcsConfigLockWriteResult,
} from "./lock";

export {
  DCS_ROOT_TOPOLOGY_SCHEMA,
  dcsPrivateProductRoot,
  dcsUserProductRoot,
  resolveDcsRootTopology,
  type DcsRootTopologyV0,
  type ResolveDcsRootTopologyOptions,
} from "./root-topology";
