import path from "node:path";

import {
  DEFAULT_NAMING_VOCABULARY,
  adapterDirection,
  createNamingVocabulary,
  evaluatePackageName,
  extensionCoordinates,
  findPackageNameCollisions,
  formatPackageName,
  isLegacyExtensionPackageName,
  parseLegacyExtensionPackageName,
  proposeCanonicalExtensionName,
  type NamingVocabulary,
  type PackageNameParts,
} from "@reliverse/naming";
import type {
  QualityCheckContext,
  QualityCheckHandlerResult,
  QualityDiagnosticInput,
} from "@reliverse/quality";
import {
  discoverWorkspacePackageManifests,
  type DiscoveredPackageManifest,
} from "@reliverse/repo-index";

import { REPO_RQ_CONFIG_DEFAULTS, type RepoRqNamingConfig } from "../config";
import { REPO_NAMING_RULE_IDS } from "./rules";

const INTERNAL_SCOPES = ["@reliverse/", "@repo/", "@ui/", "@uim/"] as const;

function resolveRepoNamingConfig(value: unknown): RepoRqNamingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return REPO_RQ_CONFIG_DEFAULTS.naming;
  }
  const naming = (value as { naming?: unknown }).naming;
  if (!naming || typeof naming !== "object" || Array.isArray(naming)) {
    return REPO_RQ_CONFIG_DEFAULTS.naming;
  }
  const record = naming as Record<string, unknown>;
  const atomicFamilies = Array.isArray(record.atomicFamilies)
    ? record.atomicFamilies.filter((entry): entry is string => typeof entry === "string")
    : REPO_RQ_CONFIG_DEFAULTS.naming.atomicFamilies;
  const legacyAllowedNames = Array.isArray(record.legacyAllowedNames)
    ? record.legacyAllowedNames.filter((entry): entry is string => typeof entry === "string")
    : REPO_RQ_CONFIG_DEFAULTS.naming.legacyAllowedNames;
  const legacySeverity =
    record.legacySeverity === "error" ||
    record.legacySeverity === "warning" ||
    record.legacySeverity === "info"
      ? record.legacySeverity
      : REPO_RQ_CONFIG_DEFAULTS.naming.legacySeverity;
  const scopeOverrides =
    record.scopeOverrides &&
    typeof record.scopeOverrides === "object" &&
    !Array.isArray(record.scopeOverrides)
      ? Object.fromEntries(
          Object.entries(record.scopeOverrides as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : REPO_RQ_CONFIG_DEFAULTS.naming.scopeOverrides;
  return Object.freeze({
    atomicFamilies: Object.freeze(atomicFamilies),
    legacyAllowedNames: Object.freeze(legacyAllowedNames),
    legacySeverity,
    scopeOverrides: Object.freeze(scopeOverrides),
  });
}

function createRepositoryNamingVocabulary(config: RepoRqNamingConfig): NamingVocabulary {
  return createNamingVocabulary({
    ...DEFAULT_NAMING_VOCABULARY,
    atomicFamilies: [...DEFAULT_NAMING_VOCABULARY.atomicFamilies, ...config.atomicFamilies],
  });
}

function allDependencies(manifest: DiscoveredPackageManifest): readonly string[] {
  return Object.freeze(
    [
      ...new Set([
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      ]),
    ].sort(),
  );
}

function unscopedPackageSegment(packageName: string): string {
  return packageName.includes("/") ? (packageName.split("/")[1] ?? packageName) : packageName;
}

function repeatedTokens(packageName: string): readonly string[] {
  const tokens = unscopedPackageSegment(packageName).split("-");
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return Object.freeze(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([token]) => token)
      .sort(),
  );
}

function expectedScope(packageRoot: string, config: RepoRqNamingConfig): string {
  const override = config.scopeOverrides[packageRoot];
  if (override) return override;
  if (packageRoot === "ui/blocks" || packageRoot === "ui/primitives") return "@ui";
  if (packageRoot.startsWith("ui/mobile/")) return "@uim";
  if (
    packageRoot === "apps/desktop" ||
    packageRoot === "apps/mobile" ||
    packageRoot.startsWith("apps/web/") ||
    packageRoot.startsWith("extensions/browser/") ||
    packageRoot === "packages/tailwind" ||
    packageRoot === "packages/tsconfig" ||
    packageRoot === "scripts" ||
    packageRoot === "tests" ||
    packageRoot.startsWith("docs/specs/rse/examples/skills/")
  ) {
    return "@repo";
  }
  return "@reliverse";
}

function packageScope(packageName: string): string | undefined {
  return packageName.startsWith("@") ? packageName.split("/")[0] : undefined;
}

function diagnostic(
  ruleId: string,
  manifest: DiscoveredPackageManifest,
  message: string,
  data: Record<string, string | number | boolean | readonly string[] | null> = {},
  severity?: "error" | "warning" | "info",
): QualityDiagnosticInput {
  return {
    ruleId,
    message,
    path: manifest.manifestPath,
    evidence: [
      {
        kind: "package-manifest",
        label: "Workspace package manifest",
        path: manifest.manifestPath,
        value: {
          name: manifest.name ?? null,
          packageRoot: manifest.packageRoot,
        },
      },
    ],
    data,
    ...(severity ? { severity } : {}),
  };
}

function classifyEvaluationDiagnostic(message: string): string {
  if (message.includes("binding") && message.includes("already encoded")) {
    return REPO_NAMING_RULE_IDS.selfBinding;
  }
  if (message.includes("multiple binding chain")) {
    return REPO_NAMING_RULE_IDS.duplicateToken;
  }
  if (message.includes("unknown binding")) {
    return REPO_NAMING_RULE_IDS.bindingKnown;
  }
  if (message.includes("already encoded by atomic family")) {
    return REPO_NAMING_RULE_IDS.semanticElision;
  }
  if (message.includes("version variants")) {
    return REPO_NAMING_RULE_IDS.semanticElision;
  }
  return REPO_NAMING_RULE_IDS.packageShape;
}

function extensionParts(
  manifest: DiscoveredPackageManifest,
  vocabulary: NamingVocabulary,
): PackageNameParts | undefined {
  if (!manifest.name) return undefined;
  const legacy = parseLegacyExtensionPackageName(manifest.name);
  if (legacy) {
    return {
      scope: legacy.scope,
      family: legacy.family,
      binding: legacy.binding,
      role: legacy.role,
    };
  }
  return evaluatePackageName(manifest.name, {}, vocabulary).parts;
}

function bindingHasEvidence(manifest: DiscoveredPackageManifest, binding: string): boolean {
  const rootTokens = manifest.packageRoot.split(/[/-]/u);
  if (rootTokens.includes(binding)) return true;

  return allDependencies(manifest).some((dependency) => {
    const candidate = unscopedPackageSegment(dependency);
    const tokens = candidate.split("-");
    return tokens.includes(binding);
  });
}

function canonicalExtensionCoordinatesAgree(
  manifest: DiscoveredPackageManifest,
  parts: PackageNameParts,
): boolean {
  const coordinates = extensionCoordinates(manifest.manifestPath);
  if (!coordinates || !parts.role) return true;
  if (parts.role !== coordinates.role) return false;

  if (parts.binding === coordinates.binding && parts.family === coordinates.pathFamily) {
    return true;
  }

  return (
    parts.binding === undefined &&
    parts.family === `${coordinates.binding}-${coordinates.pathFamily}`
  );
}

function checkManifest(
  manifest: DiscoveredPackageManifest,
  workspaceNames: ReadonlySet<string>,
  config: RepoRqNamingConfig,
  vocabulary: NamingVocabulary,
): QualityDiagnosticInput[] {
  const diagnostics: QualityDiagnosticInput[] = [];
  const name = manifest.name;

  if (!name) {
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.packageShape,
        manifest,
        `Workspace ${manifest.packageRoot} has no package name.`,
      ),
    );
    return diagnostics;
  }

  const evaluation = evaluatePackageName(name, {}, vocabulary);
  for (const message of evaluation.diagnostics) {
    diagnostics.push(
      diagnostic(classifyEvaluationDiagnostic(message), manifest, `${name}: ${message}.`, {
        name,
        decision: evaluation.decision,
      }),
    );
  }
  if (evaluation.decision === "reject" && evaluation.diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.packageShape,
        manifest,
        `${name} does not satisfy the package naming grammar.`,
        { name },
      ),
    );
  }

  const duplicateTokens = repeatedTokens(name);
  if (duplicateTokens.length > 0) {
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.duplicateToken,
        manifest,
        `${name} repeats naming token${duplicateTokens.length === 1 ? "" : "s"}: ${duplicateTokens.join(", ")}.`,
        { name, tokens: duplicateTokens },
      ),
    );
  }

  const actualScope = packageScope(name);
  const requiredScope = expectedScope(manifest.packageRoot, config);
  if (actualScope !== requiredScope) {
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.scopeOwnership,
        manifest,
        `${name} is owned by ${requiredScope}, not ${actualScope ?? "an unscoped namespace"}.`,
        { name, actualScope: actualScope ?? null, expectedScope: requiredScope },
      ),
    );
  }

  const coordinates = extensionCoordinates(manifest.manifestPath);
  const parts = extensionParts(manifest, vocabulary);
  if (coordinates) {
    if (!vocabulary.bindings.includes(coordinates.binding)) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.bindingKnown,
          manifest,
          `Extension path uses unknown binding ${coordinates.binding}.`,
          { binding: coordinates.binding, name },
        ),
      );
    }

    if (!parts?.role || !vocabulary.roles.includes(parts.role)) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.roleKnown,
          manifest,
          `${name} does not expose the ${coordinates.role} role required by ${manifest.packageRoot}.`,
          { expectedRole: coordinates.role, name },
        ),
      );
    } else if (!canonicalExtensionCoordinatesAgree(manifest, parts)) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.directoryAlignment,
          manifest,
          `${name} does not align with ${coordinates.role}/${coordinates.binding}/${coordinates.pathFamily}.`,
          {
            binding: coordinates.binding,
            expectedFamily: coordinates.pathFamily,
            expectedRole: coordinates.role,
            name,
          },
          config.legacyAllowedNames.includes(name) ? config.legacySeverity : undefined,
        ),
      );
    }

    const atomicFamily = `${coordinates.binding}-${coordinates.pathFamily}`;
    if (
      !isLegacyExtensionPackageName(name) &&
      vocabulary.atomicFamilies.includes(atomicFamily) &&
      parts?.family === coordinates.pathFamily &&
      parts.binding === coordinates.binding
    ) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.atomicFamily,
          manifest,
          `${name} splits registered atomic family ${atomicFamily}.`,
          {
            expected: formatPackageName({
              scope: parts.scope,
              family: atomicFamily,
              role: coordinates.role,
            }),
            family: atomicFamily,
            name,
          },
        ),
      );
    }

    if (coordinates.role === "plugin" && !allDependencies(manifest).includes("@reliverse/rempts")) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.pluginContract,
          manifest,
          `${name} is placed under extensions/plugins but does not declare @reliverse/rempts.`,
          { name },
        ),
      );
    }
  }

  if (parts?.binding && !bindingHasEvidence(manifest, parts.binding)) {
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.bindingEvidence,
        manifest,
        `${name} declares binding ${parts.binding} without path or dependency evidence.`,
        { binding: parts.binding, name },
      ),
    );
  }

  if (parts?.role === "adapter") {
    const direction = adapterDirection(parts);
    if (!direction) {
      diagnostics.push(
        diagnostic(
          REPO_NAMING_RULE_IDS.adapterDirection,
          manifest,
          `${name} uses the adapter role without an explicit target binding.`,
          { name },
        ),
      );
    }
  }

  if (isLegacyExtensionPackageName(name)) {
    const proposal = proposeCanonicalExtensionName(manifest);
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.legacyPattern,
        manifest,
        proposal
          ? `${name} uses the legacy surface-first convention; reviewed candidate: ${proposal.packageName}.`
          : `${name} uses the legacy surface-first convention.`,
        {
          name,
          proposedName: proposal?.packageName ?? null,
          confidence: proposal?.confidence ?? null,
          requiresSemanticReview: proposal?.requiresSemanticReview ?? false,
        },
        config.legacyAllowedNames.includes(name) ? config.legacySeverity : "error",
      ),
    );
  }

  for (const dependency of allDependencies(manifest)) {
    if (!INTERNAL_SCOPES.some((scope) => dependency.startsWith(scope))) continue;
    if (workspaceNames.has(dependency)) continue;
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.workspaceReferences,
        manifest,
        `${name} references missing internal workspace package ${dependency}.`,
        { dependency, name },
      ),
    );
  }

  return diagnostics;
}

export async function checkRepositoryNaming(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  const repositoryRoot = context.target.root
    ? path.resolve(context.target.root)
    : path.resolve(context.target.id);
  const config = resolveRepoNamingConfig(context.config);
  const vocabulary = createRepositoryNamingVocabulary(config);
  const discovery = await discoverWorkspacePackageManifests(repositoryRoot);
  const workspaceNames = new Set(
    discovery.workspaces
      .map((manifest) => manifest.name)
      .filter((name): name is string => typeof name === "string"),
  );
  if (discovery.rootManifest.name) workspaceNames.add(discovery.rootManifest.name);

  const diagnostics = discovery.workspaces.flatMap((manifest) =>
    checkManifest(manifest, workspaceNames, config, vocabulary),
  );
  for (const collision of findPackageNameCollisions(discovery.workspaces)) {
    const owner = discovery.workspaces.find(
      (manifest) => manifest.manifestPath === collision.manifestPaths[0],
    );
    if (!owner) continue;
    diagnostics.push(
      diagnostic(
        REPO_NAMING_RULE_IDS.packageCollision,
        owner,
        `${collision.packageName} is declared by ${collision.manifestPaths.length} workspaces.`,
        {
          name: collision.packageName,
          manifestPaths: collision.manifestPaths,
        },
      ),
    );
  }

  const legacyCount = diagnostics.filter(
    (entry) => entry.ruleId === REPO_NAMING_RULE_IDS.legacyPattern,
  ).length;

  return {
    diagnostics,
    metadata: {
      repositoryRoot,
      workspaceCount: discovery.workspaces.length,
      namedWorkspaceCount: workspaceNames.size,
      legacyExtensionCount: legacyCount,
      workspacePatterns: discovery.workspacePatterns,
    },
  };
}
