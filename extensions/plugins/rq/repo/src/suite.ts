import { defineQualitySuite, type QualityEffectDeclaration } from "@reliverse/quality";

import { checkRepositoryAgentHarness } from "./agent-harness/check";
import { REPO_AGENT_HARNESS_RULES } from "./agent-harness/rules";
import { checkRepositoryBoundaries } from "./boundaries/check";
import { REPO_BOUNDARY_RULES } from "./boundaries/rules";
import { checkRepositoryCli } from "./cli/check";
import { REPO_CLI_RULES } from "./cli/rules";
import { checkRepositoryComplexity } from "./complexity/check";
import { REPO_COMPLEXITY_RULES } from "./complexity/rules";
import { checkRepositoryConcepts } from "./concepts/check";
import { REPO_CONCEPT_RULES } from "./concepts/rules";
import { checkRepositoryDcs } from "./dcs/check";
import { REPO_DCS_RULES } from "./dcs/rules";
import { checkRepositoryDependencies } from "./dependencies/check";
import { REPO_DEPENDENCY_RULES } from "./dependencies/rules";
import { checkRepositoryDocs } from "./docs/check";
import { REPO_DOCS_RULES } from "./docs/rules";
import { checkRepositoryFixtures } from "./fixtures/check";
import { REPO_FIXTURE_RULES } from "./fixtures/rules";
import { checkRepositoryLockfile } from "./lockfile/check";
import { REPO_LOCKFILE_RULES } from "./lockfile/rules";
import { checkRepositoryNaming } from "./naming/check";
import { planRepositoryNaming } from "./naming/plan";
import { REPO_NAMING_RULES } from "./naming/rules";
import { checkRepositoryPackages } from "./packages/check";
import { REPO_PACKAGES_RULES } from "./packages/rules";
import { checkRepositoryPaths } from "./paths/check";
import { REPO_PATHS_RULES } from "./paths/rules";
import { checkRepositoryPublicSurfaceHygiene } from "./public-surface-hygiene/check";
import { REPO_PUBLIC_SURFACE_HYGIENE_RULES } from "./public-surface-hygiene/rules";
import { checkRepositoryRempts } from "./rempts/check";
import { REPO_REMPTS_RULES } from "./rempts/rules";
import { checkRepositoryRseThinHost } from "./rse-thin-host/check";
import { REPO_RSE_THIN_HOST_RULES } from "./rse-thin-host/rules";
import { checkRepositoryRuntime } from "./runtime/check";
import { REPO_RUNTIME_RULES } from "./runtime/rules";
import { checkRepositoryRvsDomains } from "./rvs-domains/check";
import { REPO_RVS_DOMAIN_RULES } from "./rvs-domains/rules";
import { checkRepositorySchemas } from "./schemas/check";
import { REPO_SCHEMAS_RULES } from "./schemas/rules";
import { withRepositoryPublicationScope } from "./shared/diagnostics";
import { checkRepositorySpecs } from "./specs/check";
import { REPO_SPECS_RULES } from "./specs/rules";
import { checkRepositoryToolBridges } from "./tool-bridges/check";
import { REPO_TOOL_BRIDGE_RULES } from "./tool-bridges/rules";
import { checkRepositoryTopology } from "./topology/check";
import { REPO_TOPOLOGY_RULES } from "./topology/rules";
import { checkRepositoryTsconfig } from "./tsconfig/check";
import { REPO_TSCONFIG_RULES } from "./tsconfig/rules";
import { checkRepositoryTypeSupply } from "./type-supply/check";
import { REPO_TYPE_SUPPLY_RULES } from "./type-supply/rules";

const REPOSITORY_READ_EFFECT: QualityEffectDeclaration = Object.freeze({
  kind: "filesystem.read",
  reason: "Read repository manifests, configuration, source imports, and policy evidence.",
  operations: ["check"] as const,
  scope: "repository files",
});

const REPOSITORY_PROCESS_READ_EFFECT: QualityEffectDeclaration = Object.freeze({
  kind: "process.spawn",
  reason: "Run bounded read-only repository evidence commands.",
  operations: ["check"] as const,
  scope: "repository evidence commands",
});

const REPOSITORY_GIT_READ_EFFECT: QualityEffectDeclaration = Object.freeze({
  kind: "git.read",
  reason: "Inspect tracked repository paths without mutating the index, refs, or worktree.",
  operations: ["check"] as const,
  scope: "selected repository Git index",
});

const REPOSITORY_PLAN_READ_EFFECT: QualityEffectDeclaration = Object.freeze({
  kind: "filesystem.read",
  reason: "Read target content and previous-state evidence for a deterministic plan.",
  operations: ["plan"] as const,
  scope: "repository files",
});

const REPOSITORY_APPLY_EFFECTS: readonly QualityEffectDeclaration[] = Object.freeze([
  {
    kind: "filesystem.read",
    reason: "Validate the exact reviewed plan and all previous-state preconditions.",
    operations: ["apply"] as const,
    scope: "repository files",
  },
  {
    kind: "filesystem.write",
    reason: "Execute reviewed write-json, replace-text, and create-file operations.",
    operations: ["apply"] as const,
    scope: "reviewed plan paths",
  },
  {
    kind: "filesystem.rename",
    reason: "Execute reviewed move-path and rename-path operations.",
    operations: ["apply"] as const,
    scope: "reviewed plan paths",
  },
  {
    kind: "filesystem.delete",
    reason: "Execute reviewed delete-path operations.",
    operations: ["apply"] as const,
    scope: "reviewed plan paths",
  },
]);

const REPOSITORY_VERIFY_READ_EFFECT: QualityEffectDeclaration = Object.freeze({
  kind: "filesystem.read",
  reason: "Evaluate declared post-apply repository quality checks.",
  operations: ["verify"] as const,
  scope: "repository files",
});

const capabilities = [
  {
    id: "repo.agent-harness",
    title: "Agent harness efficiency",
    description:
      "Checks bounded context output, deterministic catalogs, durable overflow, runtime policy isolation, and Context Epoch integration.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.agent-harness.builtin",
    providers: ["repo.agent-harness.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.complexity",
    title: "Repository complexity signals",
    description:
      "Checks indie-first complexity signals without pretending that every abstraction is automatically wrong.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.complexity.builtin",
    providers: ["repo.complexity.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.naming",
    title: "Repository package naming",
    description:
      "Checks workspace package identities, extension alignment, ownership, and internal references.",
    operations: ["check", "explain", "plan", "apply", "verify"] as const,
    defaultProvider: "repo.naming.builtin",
    providers: ["repo.naming.builtin"],
    effects: [
      REPOSITORY_READ_EFFECT,
      REPOSITORY_PLAN_READ_EFFECT,
      ...REPOSITORY_APPLY_EFFECTS,
      REPOSITORY_VERIFY_READ_EFFECT,
    ],
  },
  {
    id: "repo.packages",
    title: "Repository package contracts",
    description:
      "Checks governed package families, manifest visibility, exports, and export targets.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.packages.builtin",
    providers: ["repo.packages.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.dependencies",
    title: "Repository dependency contracts",
    description:
      "Checks internal source usage, manifest declarations, workspace protocols, and runtime cycles.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.dependencies.builtin",
    providers: ["repo.dependencies.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.rvs-domains",
    title: "RVS domain ownership",
    description:
      "Checks canonical RVS owners, environment-agnostic core direction, and retired package consumers against the Stage 030 disposition.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.rvs-domains.builtin",
    providers: ["repo.rvs-domains.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.boundaries",
    title: "Repository package boundaries",
    description: "Checks cross-workspace source imports and portable module specifiers.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.boundaries.builtin",
    providers: ["repo.boundaries.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.topology",
    title: "Repository typecheck topology",
    description:
      "Checks that package typecheck scripts reference existing registered repository projects.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.topology.builtin",
    providers: ["repo.topology.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.tsconfig",
    title: "Repository TypeScript configuration",
    description:
      "Checks shared presets, toolchain dependencies, project options, and package-family config entrypoints.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.tsconfig.builtin",
    providers: ["repo.tsconfig.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.fixtures",
    title: "Repository fixture topology",
    description:
      "Checks shared fixture placement, generated metadata exclusions, and retired fixture references.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.fixtures.builtin",
    providers: ["repo.fixtures.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.cli",
    title: "Repository CLI contracts",
    description:
      "Checks canonical CLI package, executable, root-script, shebang, and command-root contracts.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.cli.builtin",
    providers: ["repo.cli.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.rempts",
    title: "Repository Rempts contracts",
    description:
      "Checks plugin and CLI lifecycle declarations, file discovery, command exports, and plugin imports.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.rempts.builtin",
    providers: ["repo.rempts.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.dcs",
    title: "Repository DCS ownership",
    description:
      "Checks product config ownership, generalized providers, host mounts, and trusted TypeScript policy.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.dcs.builtin",
    providers: ["repo.dcs.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.tool-bridges",
    title: "Repository Tool Bridge contracts",
    description:
      "Checks typed transport safety, transitional proxy isolation, product config, and artifact entries.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.tool-bridges.builtin",
    providers: ["repo.tool-bridges.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.rse-thin-host",
    title: "Rse thin-host ownership",
    description:
      "Checks explicit Rse command, source-area, dependency, and entrypoint ownership against the thin-host migration inventory.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.rse-thin-host.builtin",
    providers: ["repo.rse-thin-host.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.runtime",
    title: "Repository runtime ownership",
    description:
      "Checks runtime authority SOT, bounded bridges, RVS path ownership, and retired deployment surfaces.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.runtime.builtin",
    providers: ["repo.runtime.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.docs",
    title: "Repository documentation contracts",
    description:
      "Checks docs dependencies, projection coordinates, spec entrypoints, and internal wiki routes.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.docs.builtin",
    providers: ["repo.docs.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.schemas",
    title: "Repository schema lifecycle",
    description:
      "Checks pre-1 numeric schema generations, owned format identifiers, and active versioned contract filenames.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.schemas.builtin",
    providers: ["repo.schemas.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.public-surface-hygiene",
    title: "Repository public-surface hygiene",
    description:
      "Checks public source and documentation for owner-local paths, private transition labels, and release-like internal sequencing.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.public-surface-hygiene.builtin",
    providers: ["repo.public-surface-hygiene.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.specs",
    title: "Repository specification adoption",
    description:
      "Checks living spec identity, duplicate generations, size budgets, and historical artifact leakage.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.specs.builtin",
    providers: ["repo.specs.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.lockfile",
    title: "Repository lockfile coherence",
    description:
      "Checks Bun lockfile presence and workspace metadata against current package manifests.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.lockfile.builtin",
    providers: ["repo.lockfile.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.type-supply",
    title: "Repository runtime type supply",
    description:
      "Checks official Bun and Node type pins, root consumption, and retired handwritten runtime shims.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.type-supply.builtin",
    providers: ["repo.type-supply.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
  {
    id: "repo.paths",
    title: "Repository path ownership",
    description:
      "Checks workspace coverage, canonical and tracked paths, retired prefixes, and family path conventions.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.paths.builtin",
    providers: ["repo.paths.builtin"],
    effects: [REPOSITORY_READ_EFFECT, REPOSITORY_PROCESS_READ_EFFECT, REPOSITORY_GIT_READ_EFFECT],
  },
  {
    id: "repo.concepts",
    title: "Repository concept ownership",
    description: "Checks repository references for retired concept and command ownership.",
    operations: ["check", "explain"] as const,
    defaultProvider: "repo.concepts.builtin",
    providers: ["repo.concepts.builtin"],
    effects: [REPOSITORY_READ_EFFECT],
  },
];

const providers = capabilities.map((capability) => ({
  id: capability.defaultProvider,
  capabilityId: capability.id,
  title: "Reliverse repository policy",
  version: "0.0.1",
  operations:
    capability.id === "repo.naming"
      ? (["check", "plan", "apply", "verify"] as const)
      : (["check"] as const),
  determinism: "environment-bound" as const,
  effects:
    capability.id === "repo.naming"
      ? [
          REPOSITORY_READ_EFFECT,
          REPOSITORY_PLAN_READ_EFFECT,
          ...REPOSITORY_APPLY_EFFECTS,
          REPOSITORY_VERIFY_READ_EFFECT,
        ]
      : capability.id === "repo.paths"
        ? [REPOSITORY_READ_EFFECT, REPOSITORY_PROCESS_READ_EFFECT, REPOSITORY_GIT_READ_EFFECT]
        : [REPOSITORY_READ_EFFECT],
}));

export const repoQualitySuite = defineQualitySuite({
  id: "repo",
  title: "Repository Quality",
  description: "Repository-wide quality capabilities for Reliverse workspaces.",
  capabilities,
  rules: [
    ...REPO_AGENT_HARNESS_RULES,
    ...REPO_NAMING_RULES,
    ...REPO_PACKAGES_RULES,
    ...REPO_DEPENDENCY_RULES,
    ...REPO_RVS_DOMAIN_RULES,
    ...REPO_BOUNDARY_RULES,
    ...REPO_TOPOLOGY_RULES,
    ...REPO_TSCONFIG_RULES,
    ...REPO_FIXTURE_RULES,
    ...REPO_CLI_RULES,
    ...REPO_REMPTS_RULES,
    ...REPO_DCS_RULES,
    ...REPO_TOOL_BRIDGE_RULES,
    ...REPO_RUNTIME_RULES,
    ...REPO_RSE_THIN_HOST_RULES,
    ...REPO_DOCS_RULES,
    ...REPO_SCHEMAS_RULES,
    ...REPO_PUBLIC_SURFACE_HYGIENE_RULES,
    ...REPO_SPECS_RULES,
    ...REPO_LOCKFILE_RULES,
    ...REPO_TYPE_SUPPLY_RULES,
    ...REPO_PATHS_RULES,
    ...REPO_CONCEPT_RULES,
    ...REPO_COMPLEXITY_RULES,
  ],
  providers,
  checks: Object.fromEntries(
    Object.entries({
      "repo.agent-harness": checkRepositoryAgentHarness,
      "repo.complexity": checkRepositoryComplexity,
      "repo.naming": checkRepositoryNaming,
      "repo.packages": checkRepositoryPackages,
      "repo.dependencies": checkRepositoryDependencies,
      "repo.rvs-domains": checkRepositoryRvsDomains,
      "repo.boundaries": checkRepositoryBoundaries,
      "repo.topology": checkRepositoryTopology,
      "repo.tsconfig": checkRepositoryTsconfig,
      "repo.fixtures": checkRepositoryFixtures,
      "repo.cli": checkRepositoryCli,
      "repo.rempts": checkRepositoryRempts,
      "repo.dcs": checkRepositoryDcs,
      "repo.tool-bridges": checkRepositoryToolBridges,
      "repo.runtime": checkRepositoryRuntime,
      "repo.rse-thin-host": checkRepositoryRseThinHost,
      "repo.docs": checkRepositoryDocs,
      "repo.schemas": checkRepositorySchemas,
      "repo.public-surface-hygiene": checkRepositoryPublicSurfaceHygiene,
      "repo.specs": checkRepositorySpecs,
      "repo.lockfile": checkRepositoryLockfile,
      "repo.type-supply": checkRepositoryTypeSupply,
      "repo.paths": checkRepositoryPaths,
      "repo.concepts": checkRepositoryConcepts,
    }).map(([capability, check]) => [capability, withRepositoryPublicationScope(check)]),
  ),
  plans: {
    "repo.naming": planRepositoryNaming,
  },
});
