import type { QualitySeverity } from "@reliverse/quality";

export interface RepoRqComplexityConfig {
  readonly maxRootScripts: number;
  readonly profile: "indie-first";
  readonly rootScriptBudgetSeverity: QualitySeverity;
}

export interface RepoRqNamingConfig {
  readonly atomicFamilies: readonly string[];
  readonly legacyAllowedNames: readonly string[];
  readonly legacySeverity: QualitySeverity;
  readonly scopeOverrides: Readonly<Record<string, string>>;
}

export interface RepoRqPackagesConfig {
  readonly familyRoots: readonly string[];
}

export interface RepoRqPublicSurfaceHygieneConfig {
  readonly allowedHomePrincipals: readonly string[];
  readonly ignore: readonly string[];
  readonly misleadingReleaseLabelSeverity: QualitySeverity;
  readonly ownerLocalPathSeverity: QualitySeverity;
  readonly privateTransitionLabelSeverity: QualitySeverity;
  readonly roots: readonly string[];
}

export interface RepoRqTsconfigConfig {
  readonly allowedExtends: readonly string[];
  readonly requiredDevDependencies: Readonly<Record<string, string>>;
}

export interface RepoRqDependencyToolPolicy {
  readonly declaredName: string;
  readonly logicalRole: string;
  readonly minimumVersion: string;
  readonly ownerManifests: readonly string[];
  readonly registryName: string;
  readonly stableRequired: boolean;
}

export interface RepoRqModuleCycleException {
  readonly createdAt: string;
  readonly files: readonly string[];
  readonly owner: string;
  readonly packageName: string;
  readonly reason: string;
  readonly reviewCondition: string;
  readonly risk: string;
}

export interface RepoRqDependenciesConfig {
  readonly moduleCycleExceptions?: readonly RepoRqModuleCycleException[] | undefined;
  readonly tools: readonly RepoRqDependencyToolPolicy[];
}

export type RepoRqSchemasAdoptionMode = "off" | "observe" | "guided" | "enforced";

export interface RepoRqSchemasConfig {
  readonly adoptionMode: RepoRqSchemasAdoptionMode;
  readonly constantNameTokens: readonly string[];
  readonly ignore: readonly string[];
  readonly numericFieldNames: readonly string[];
  readonly numericGenerationSeverity: QualitySeverity;
  readonly ownedFormatNameTokens: readonly string[];
  readonly ownedFormatGenerationSeverity: QualitySeverity;
  readonly ownedNamespaces: readonly string[];
  readonly roots: readonly string[];
  readonly versionedFilenameSeverity: QualitySeverity;
}

export type RepoRqSpecsAdoptionMode = "off" | "observe" | "guided" | "enforced";

export interface RepoRqSpecsConfig {
  readonly adoptionMode: RepoRqSpecsAdoptionMode;
  readonly canonicalMetadataSeverity: QualitySeverity;
  readonly duplicateGenerationSeverity: QualitySeverity;
  readonly historicalArtifactSeverity: QualitySeverity;
  readonly ignore: readonly string[];
  readonly manifestSeverity: QualitySeverity;
  readonly maxLines: number;
  readonly oversizedSeverity: QualitySeverity;
  readonly requiredManifests: readonly string[];
  readonly roots: readonly string[];
  readonly versionedLivingSeverity: QualitySeverity;
}

export interface RepoRqConfig {
  readonly complexity: RepoRqComplexityConfig;
  readonly dependencies: RepoRqDependenciesConfig;
  readonly naming: RepoRqNamingConfig;
  readonly packages: RepoRqPackagesConfig;
  readonly publicSurfaceHygiene: RepoRqPublicSurfaceHygieneConfig;
  readonly schemas: RepoRqSchemasConfig;
  readonly specs: RepoRqSpecsConfig;
  readonly tsconfig: RepoRqTsconfigConfig;
}

export const REPO_RQ_CONFIG_DEFAULTS: RepoRqConfig = Object.freeze({
  complexity: Object.freeze({
    maxRootScripts: 24,
    profile: "indie-first",
    rootScriptBudgetSeverity: "info",
  }),
  dependencies: Object.freeze({
    moduleCycleExceptions: Object.freeze([]),
    tools: Object.freeze([]),
  }),
  naming: Object.freeze({
    atomicFamilies: Object.freeze([]),
    legacyAllowedNames: Object.freeze([]),
    legacySeverity: "warning",
    scopeOverrides: Object.freeze({}),
  }),
  packages: Object.freeze({ familyRoots: Object.freeze([]) }),
  publicSurfaceHygiene: Object.freeze({
    allowedHomePrincipals: Object.freeze([
      "deploy",
      "example",
      "operator",
      "runner",
      "someone",
      "user",
    ]),
    ignore: Object.freeze([
      "**/.git/**",
      "**/.private/**",
      "**/archive/**",
      "**/archives/**",
      "**/evidence/**",
      "**/fixtures/**",
      "**/history/**",
      "**/*.test.*",
    ]),
    misleadingReleaseLabelSeverity: "error",
    ownerLocalPathSeverity: "error",
    privateTransitionLabelSeverity: "error",
    roots: Object.freeze([
      "README.md",
      "package.json",
      "bun.lock",
      "apps",
      "docs",
      "extensions",
      "packages",
      "scripts",
    ]),
  }),
  schemas: Object.freeze({
    adoptionMode: "observe",
    constantNameTokens: Object.freeze([
      "API",
      "CONTRACT",
      "FORMAT",
      "MANIFEST",
      "PROTOCOL",
      "SCHEMA",
    ]),
    ignore: Object.freeze([]),
    numericFieldNames: Object.freeze([
      "apiVersion",
      "contractVersion",
      "documentVersion",
      "protocolVersion",
      "schemaVersion",
    ]),
    numericGenerationSeverity: "error",
    ownedFormatNameTokens: Object.freeze([
      "abi",
      "contract",
      "document",
      "effective",
      "eligibility",
      "lock",
      "lockfile",
      "manifest",
      "materializer",
      "payload",
      "plan",
      "policy",
      "proof",
      "protocol",
      "receipt",
      "result",
      "schema",
      "selection",
      "semantic",
      "session",
      "summary",
      "terminal",
      "ticket",
      "transcript",
      "transient",
      "validation",
      "wire",
    ]),
    ownedFormatGenerationSeverity: "error",
    ownedNamespaces: Object.freeze([
      "bleverse",
      "dcs",
      "declar",
      "dler",
      "relda",
      "reliverse",
      "relpack",
      "rempts",
      "rewse",
      "rq",
      "rse",
      "rvs",
      "typescript",
    ]),
    roots: Object.freeze([
      ".config",
      "apps",
      "data",
      "extensions",
      "packages",
      "scripts",
      "tests/fixtures",
    ]),
    versionedFilenameSeverity: "warning",
  }),
  specs: Object.freeze({
    adoptionMode: "observe",
    canonicalMetadataSeverity: "error",
    duplicateGenerationSeverity: "warning",
    historicalArtifactSeverity: "warning",
    ignore: Object.freeze([]),
    manifestSeverity: "error",
    maxLines: 1200,
    oversizedSeverity: "warning",
    requiredManifests: Object.freeze([]),
    roots: Object.freeze(["docs/specs"]),
    versionedLivingSeverity: "warning",
  }),
  tsconfig: Object.freeze({
    allowedExtends: Object.freeze([]),
    requiredDevDependencies: Object.freeze({}),
  }),
});

export const REPO_RQ_CONFIG_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    complexity: {
      additionalProperties: false,
      properties: {
        maxRootScripts: { minimum: 1, type: "integer" },
        profile: { enum: ["indie-first"], type: "string" },
        rootScriptBudgetSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
      },
      required: ["maxRootScripts", "profile", "rootScriptBudgetSeverity"],
      type: "object",
    },
    dependencies: {
      additionalProperties: false,
      properties: {
        moduleCycleExceptions: {
          items: {
            additionalProperties: false,
            properties: {
              createdAt: { minLength: 10, type: "string" },
              files: {
                items: { minLength: 1, type: "string" },
                minItems: 2,
                type: "array",
                uniqueItems: true,
              },
              owner: { minLength: 1, type: "string" },
              packageName: { minLength: 1, type: "string" },
              reason: { minLength: 1, type: "string" },
              reviewCondition: { minLength: 1, type: "string" },
              risk: { minLength: 1, type: "string" },
            },
            required: [
              "createdAt",
              "files",
              "owner",
              "packageName",
              "reason",
              "reviewCondition",
              "risk",
            ],
            type: "object",
          },
          type: "array",
        },
        tools: {
          items: {
            additionalProperties: false,
            properties: {
              declaredName: { minLength: 1, type: "string" },
              logicalRole: { minLength: 1, type: "string" },
              minimumVersion: { minLength: 1, type: "string" },
              ownerManifests: {
                items: { minLength: 1, type: "string" },
                minItems: 1,
                type: "array",
                uniqueItems: true,
              },
              registryName: { minLength: 1, type: "string" },
              stableRequired: { type: "boolean" },
            },
            required: [
              "declaredName",
              "logicalRole",
              "minimumVersion",
              "ownerManifests",
              "registryName",
              "stableRequired",
            ],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["tools"],
      type: "object",
    },
    naming: {
      additionalProperties: false,
      properties: {
        atomicFamilies: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        legacyAllowedNames: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        legacySeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        scopeOverrides: {
          additionalProperties: { minLength: 1, type: "string" },
          type: "object",
        },
      },
      required: ["atomicFamilies", "legacyAllowedNames", "legacySeverity", "scopeOverrides"],
      type: "object",
    },
    packages: {
      additionalProperties: false,
      properties: {
        familyRoots: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
      },
      required: ["familyRoots"],
      type: "object",
    },
    publicSurfaceHygiene: {
      additionalProperties: false,
      properties: {
        allowedHomePrincipals: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        ignore: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        misleadingReleaseLabelSeverity: { enum: ["error", "warning", "info"], type: "string" },
        ownerLocalPathSeverity: { enum: ["error", "warning", "info"], type: "string" },
        privateTransitionLabelSeverity: { enum: ["error", "warning", "info"], type: "string" },
        roots: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
      },
      required: [
        "allowedHomePrincipals",
        "ignore",
        "misleadingReleaseLabelSeverity",
        "ownerLocalPathSeverity",
        "privateTransitionLabelSeverity",
        "roots",
      ],
      type: "object",
    },
    schemas: {
      additionalProperties: false,
      properties: {
        adoptionMode: {
          enum: ["off", "observe", "guided", "enforced"],
          type: "string",
        },
        constantNameTokens: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        ignore: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        numericFieldNames: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        numericGenerationSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        ownedFormatNameTokens: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        ownedFormatGenerationSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        ownedNamespaces: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        roots: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        versionedFilenameSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
      },
      required: [
        "adoptionMode",
        "constantNameTokens",
        "ignore",
        "numericFieldNames",
        "numericGenerationSeverity",
        "ownedFormatNameTokens",
        "ownedFormatGenerationSeverity",
        "ownedNamespaces",
        "roots",
        "versionedFilenameSeverity",
      ],
      type: "object",
    },
    specs: {
      additionalProperties: false,
      properties: {
        adoptionMode: {
          enum: ["off", "observe", "guided", "enforced"],
          type: "string",
        },
        canonicalMetadataSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        duplicateGenerationSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        historicalArtifactSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        ignore: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        manifestSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        maxLines: { minimum: 1, type: "integer" },
        oversizedSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
        requiredManifests: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        roots: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
        versionedLivingSeverity: {
          enum: ["error", "warning", "info"],
          type: "string",
        },
      },
      required: [
        "adoptionMode",
        "canonicalMetadataSeverity",
        "duplicateGenerationSeverity",
        "historicalArtifactSeverity",
        "ignore",
        "manifestSeverity",
        "maxLines",
        "oversizedSeverity",
        "requiredManifests",
        "roots",
        "versionedLivingSeverity",
      ],
      type: "object",
    },
    tsconfig: {
      additionalProperties: false,
      properties: {
        allowedExtends: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
        requiredDevDependencies: {
          additionalProperties: { minLength: 1, type: "string" },
          type: "object",
        },
      },
      required: ["allowedExtends", "requiredDevDependencies"],
      type: "object",
    },
  },
  required: ["complexity", "dependencies", "naming", "packages", "schemas", "specs", "tsconfig"],
  type: "object",
});
