import path from "node:path";

import { proposeCanonicalExtensionName, type NamingProposal } from "@reliverse/naming";
import {
  fingerprintJson,
  type QualityDiagnostic,
  type QualityPlanContext,
  type QualityPlanHandlerResult,
  type QualityReplaceTextOperation,
} from "@reliverse/quality";
import {
  createRepositoryPolicyIndex,
  discoverWorkspacePackageManifests,
  type DiscoveredPackageManifest,
} from "@reliverse/repo-index";

import { REPO_NAMING_RULE_IDS } from "./rules";

type NamingMigrationCandidate = {
  readonly diagnostic?: QualityDiagnostic | undefined;
  readonly manifest: DiscoveredPackageManifest & { readonly name: string };
  readonly proposal: NamingProposal;
};

type PlannedReferenceReplacement = {
  readonly after: string;
  readonly before: string;
  readonly category: "discovery-policy" | "legacy-ratchet" | "package-reference";
  readonly expectedOccurrences: number;
  readonly fileFingerprint: string;
  readonly path: string;
};

type ExcludedReferenceCategory =
  | "generated"
  | "historical"
  | "intentional-legacy-fixture"
  | "migration-policy";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kdl",
  ".lock",
  ".md",
  ".mdx",
  ".mjs",
  ".cjs",
  ".ps1",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const INTENTIONAL_LEGACY_FIXTURES = new Set([
  "apps/cli/rq/src/cli.test.ts",
  "extensions/plugins/rq/repo/src/suite.test.ts",
  "packages/naming/src/index.test.ts",
  "packages/quality/src/index.test.ts",
  "packages/rempts/src/runtime/plugin-discovery.test.ts",
]);

const LEGACY_RATCHET_PATH = "extensions/plugins/rq/repo/src/config.ts";
const MIGRATION_POLICY_PATHS = new Set([
  "extensions/plugins/rq/repo/src/naming/plan.ts",
  "packages/naming/src/extensions.ts",
]);
const INVENTORY_TEST_PATH = "scripts/ts/rq/inventory-package-naming.test.ts";
const SPECIAL_REWRITE_PATHS = new Set([LEGACY_RATCHET_PATH, INVENTORY_TEST_PATH]);

function diagnosticPackageName(diagnostic: QualityDiagnostic): string | undefined {
  const data = diagnostic.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const name = (data as Readonly<Record<string, unknown>>).name;
  return typeof name === "string" ? name : undefined;
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

function isTextInventoryPath(file: string): boolean {
  return file === "bun.lock" || TEXT_EXTENSIONS.has(path.posix.extname(file));
}

function excludedReferenceCategory(file: string): ExcludedReferenceCategory | undefined {
  if (
    file.startsWith("!handoff/") ||
    file.startsWith("data/compare/agents/src/imports/") ||
    file.startsWith("docs/specs/retired/") ||
    file === "docs/evidence/package-naming-simulation-v0.md"
  ) {
    return "historical";
  }
  if (
    file.startsWith("apps/web/wiki/content/") ||
    file === "docs/evidence/package-naming-inventory-v0.json" ||
    file === "docs/evidence/package-naming-inventory-v0.md"
  ) {
    return "generated";
  }
  if (INTENTIONAL_LEGACY_FIXTURES.has(file)) return "intentional-legacy-fixture";
  if (MIGRATION_POLICY_PATHS.has(file)) return "migration-policy";
  return undefined;
}

function legacyRatchetSource(candidates: readonly NamingMigrationCandidate[]): string {
  return [
    "    legacyAllowedNames: Object.freeze([",
    ...candidates.map((candidate) => `      "${candidate.manifest.name}",`),
    "    ]),",
  ].join("\n");
}

function specialReferenceRewrites(candidates: readonly NamingMigrationCandidate[]): readonly {
  readonly after: string;
  readonly before: string;
  readonly category: PlannedReferenceReplacement["category"];
  readonly path: string;
}[] {
  if (candidates.length === 0) return [];
  return [
    {
      path: LEGACY_RATCHET_PATH,
      before: legacyRatchetSource(candidates),
      after: "    legacyAllowedNames: Object.freeze([]),",
      category: "legacy-ratchet",
    },
    {
      path: INVENTORY_TEST_PATH,
      before: [
        'test("repository naming inventory finds live legacy extension packages deterministically", async () => {',
        "  const first = await buildRepositoryNamingInventory(repositoryRoot);",
        "  const second = await buildRepositoryNamingInventory(repositoryRoot);",
        "",
        "  expect(first).toEqual(second);",
        "  expect(first.summary.packageManifestCount).toBeGreaterThan(150);",
        "  expect(first.summary.legacyExtensionCount).toBe(21);",
        '  expect(first.legacyExtensions.some((entry) => entry.name === "@reliverse/plugin-rse-dler")).toBe(true);',
        '  expect(first.legacyExtensions.some((entry) => entry.proposal.packageName === "@reliverse/dler-rse-plugin")).toBe(true);',
        '  expect(first.legacyExtensions.some((entry) => entry.proposal.packageName === "@reliverse/rse-skills-plugin")).toBe(true);',
        "});",
      ].join("\n"),
      after: [
        'test("repository naming inventory confirms the completed family-first migration deterministically", async () => {',
        "  const first = await buildRepositoryNamingInventory(repositoryRoot);",
        "  const second = await buildRepositoryNamingInventory(repositoryRoot);",
        "",
        "  expect(first).toEqual(second);",
        "  expect(first.summary.packageManifestCount).toBeGreaterThan(150);",
        "  expect(first.summary.legacyExtensionCount).toBe(0);",
        "  expect(first.summary.semanticReviewCount).toBe(0);",
        '  expect(first.packages.some((entry) => entry.name === "@reliverse/dler-rse-plugin")).toBe(true);',
        '  expect(first.packages.some((entry) => entry.name === "@reliverse/rse-skills-plugin")).toBe(true);',
        "});",
      ].join("\n"),
      category: "legacy-ratchet",
    },
    {
      path: INVENTORY_TEST_PATH,
      before: [
        'test("inventory report records reviewed proposals without semantic-review items", async () => {',
        "  const inventory = await buildRepositoryNamingInventory(repositoryRoot);",
        "  const markdown = renderInventoryMarkdown(inventory);",
        "",
        "  expect(inventory.summary.semanticReviewCount).toBe(0);",
        '  expect(markdown).toContain("@reliverse/addon-rse-migrate");',
        '  expect(markdown).toContain("@reliverse/rse-docs-plugin");',
        '  expect(markdown).toContain("No candidate currently requires semantic review.");',
        '  expect(markdown).not.toContain("rename packages automatically");',
        "});",
      ].join("\n"),
      after: [
        'test("inventory report has no semantic-review queue after migration", async () => {',
        "  const inventory = await buildRepositoryNamingInventory(repositoryRoot);",
        "  const markdown = renderInventoryMarkdown(inventory);",
        "",
        '  expect(markdown).toContain("Legacy extension candidates: 0");',
        '  expect(markdown).toContain("No candidate currently requires semantic review.");',
        '  expect(markdown).not.toContain("@reliverse/addon-rse-migrate");',
        '  expect(markdown).not.toContain("rename packages automatically");',
        "});",
      ].join("\n"),
      category: "legacy-ratchet",
    },
    {
      path: "apps/cli/rse/src/cli.ts",
      before: '"@reliverse/plugin-rse-*"',
      after: '"@reliverse/*-rse-plugin", "@reliverse/rse-*-plugin"',
      category: "discovery-policy",
    },
    {
      path: "apps/cli/rvs/src/cli-config.ts",
      before: "@reliverse/plugin-rvs-*",
      after: "@reliverse/*-rvs-plugin",
      category: "discovery-policy",
    },
    {
      path: "apps/cli/rvs/src/cli-config.test.ts",
      before: "@reliverse/plugin-rvs-*",
      after: "@reliverse/*-rvs-plugin",
      category: "discovery-policy",
    },
  ];
}

export async function planRepositoryNaming(
  context: QualityPlanContext,
): Promise<QualityPlanHandlerResult> {
  const repositoryRoot = context.target.root ?? context.target.id;
  const [discovery, index] = await Promise.all([
    discoverWorkspacePackageManifests(repositoryRoot),
    createRepositoryPolicyIndex(repositoryRoot),
  ]);
  const legacyDiagnostics = context.checkResult.diagnostics.filter(
    (entry) => entry.ruleId === REPO_NAMING_RULE_IDS.legacyPattern,
  );
  const diagnosticByName = new Map(
    legacyDiagnostics
      .map((entry) => [diagnosticPackageName(entry), entry] as const)
      .filter(
        (entry): entry is readonly [string, QualityDiagnostic] => typeof entry[0] === "string",
      ),
  );
  const candidates: NamingMigrationCandidate[] = [];

  for (const manifest of discovery.workspaces) {
    if (!manifest.name) continue;
    const proposal = proposeCanonicalExtensionName(manifest);
    if (!proposal) continue;
    candidates.push({
      manifest: manifest as DiscoveredPackageManifest & { readonly name: string },
      proposal,
      diagnostic: diagnosticByName.get(manifest.name),
    });
  }
  candidates.sort((left, right) =>
    left.manifest.manifestPath.localeCompare(right.manifest.manifestPath),
  );

  const semanticReview = candidates.filter(
    (candidate) => candidate.proposal.requiresSemanticReview,
  );
  const manifestEvidence: { readonly path: string; readonly fingerprint: string }[] = [];
  for (const manifest of discovery.workspaces) {
    const source = await index.readText(manifest.manifestPath);
    manifestEvidence.push({
      path: manifest.manifestPath,
      fingerprint: fingerprintJson(source, "rq.file-content.v0"),
    });
  }

  const replacements: PlannedReferenceReplacement[] = [];
  const excludedCounts: Record<ExcludedReferenceCategory, number> = {
    generated: 0,
    historical: 0,
    "intentional-legacy-fixture": 0,
    "migration-policy": 0,
  };
  const fileFingerprintByPath = new Map<string, string>();

  for (const file of index.inventory.filter(isTextInventoryPath)) {
    const source = await index.readText(file);
    const excluded = excludedReferenceCategory(file);
    if (SPECIAL_REWRITE_PATHS.has(file)) continue;
    for (const candidate of candidates) {
      const expectedOccurrences = countOccurrences(source, candidate.manifest.name);
      if (expectedOccurrences === 0) continue;
      if (excluded) {
        excludedCounts[excluded] += expectedOccurrences;
        continue;
      }
      const fileFingerprint =
        fileFingerprintByPath.get(file) ?? fingerprintJson(source, "rq.file-content.v0");
      fileFingerprintByPath.set(file, fileFingerprint);
      replacements.push({
        path: file,
        before: candidate.manifest.name,
        after: candidate.proposal.packageName,
        expectedOccurrences,
        fileFingerprint,
        category: "package-reference",
      });
    }
  }

  const inventoryPaths = new Set(index.inventory);
  for (const rewrite of specialReferenceRewrites(candidates)) {
    if (!inventoryPaths.has(rewrite.path)) continue;
    const source = await index.readText(rewrite.path);
    const expectedOccurrences = countOccurrences(source, rewrite.before);
    if (expectedOccurrences === 0) {
      throw new Error(
        `Naming migration rewrite no longer matches ${rewrite.path}: ${rewrite.before}`,
      );
    }
    const fileFingerprint =
      fileFingerprintByPath.get(rewrite.path) ?? fingerprintJson(source, "rq.file-content.v0");
    fileFingerprintByPath.set(rewrite.path, fileFingerprint);
    replacements.push({ ...rewrite, expectedOccurrences, fileFingerprint });
  }

  replacements.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.before.localeCompare(right.before) ||
      left.after.localeCompare(right.after),
  );
  const operations: readonly QualityReplaceTextOperation[] = Object.freeze(
    replacements.map((replacement, index) => ({
      id: `replace-package-reference-${String(index + 1).padStart(4, "0")}`,
      kind: "replace-text" as const,
      path: replacement.path,
      before: replacement.before,
      after: replacement.after,
      expectedOccurrences: replacement.expectedOccurrences,
      fileFingerprint: replacement.fileFingerprint,
    })),
  );
  const preconditions = [...fileFingerprintByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fingerprint], index) => ({
      id: `reference-file-${String(index + 1).padStart(4, "0")}`,
      kind: "file-fingerprint" as const,
      path: file,
      expected: fingerprint,
    }));
  const manualItems = semanticReview.map((candidate, index) => ({
    id: `semantic-review-${String(index + 1).padStart(3, "0")}`,
    title: `Review ${candidate.manifest.name}`,
    description: `${candidate.manifest.name} has candidate ${candidate.proposal.packageName} with ${candidate.proposal.confidence} confidence; resolve its family semantics before planning mutation.`,
    ...(candidate.diagnostic ? { diagnosticFingerprints: [candidate.diagnostic.fingerprint] } : {}),
  }));
  const operationIds = operations.map((operation) => operation.id);
  const referenceEvidence = [...fileFingerprintByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, fingerprint]) => ({ path: file, fingerprint }));

  return {
    targetContent: {
      kind: "content",
      fingerprint: fingerprintJson(
        { manifests: manifestEvidence, migrationReferences: referenceEvidence },
        "rq.repo-naming-target-content.v0",
      ),
      description:
        "Deterministic content fingerprint over declared workspace manifests and classified migration references; this is not a Git or GR snapshot.",
    },
    operations,
    preconditions,
    risks:
      operations.length > 0
        ? [
            {
              id: "atomic-package-reference-migration",
              level: "high",
              title: "Atomic package identity and reference migration",
              description:
                "The plan updates package identities, dependency/import/configuration references, discovery admission patterns, active documentation, lockfile state, and the legacy warning ratchet as one preflighted operation set.",
              operationIds,
            },
          ]
        : [],
    verification: [
      {
        id: "verify-naming",
        kind: "quality-check",
        capabilityId: "repo.naming",
        description: "Re-run repository naming policy.",
      },
      {
        id: "verify-dependencies",
        kind: "quality-check",
        capabilityId: "repo.dependencies",
        description: "Verify internal dependency identities and declarations.",
      },
      {
        id: "verify-boundaries",
        kind: "quality-check",
        capabilityId: "repo.boundaries",
        description: "Verify package boundary imports after migration.",
      },
      {
        id: "verify-cli",
        kind: "quality-check",
        capabilityId: "repo.cli",
        description: "Verify CLI package and discovery references.",
      },
      {
        id: "verify-rempts",
        kind: "quality-check",
        capabilityId: "repo.rempts",
        description: "Verify Rempts plugin contracts after migration.",
      },
      {
        id: "verify-lockfile",
        kind: "quality-check",
        capabilityId: "repo.lockfile",
        description: "Verify workspace identities and lockfile metadata agree.",
      },
      {
        id: "verify-paths",
        kind: "quality-check",
        capabilityId: "repo.paths",
        description: "Verify canonical path and retired-reference policy.",
      },
      {
        id: "verify-docs",
        kind: "quality-check",
        capabilityId: "repo.docs",
        description: "Verify documentation dependency and route contracts.",
      },
    ],
    manualItems,
    applicable: operations.length > 0 && semanticReview.length === 0,
    metadata: {
      candidates: candidates.length,
      excludedReferences: excludedCounts,
      generatedEvidencePolicy: "regenerate-after-source-migration",
      operationFiles: fileFingerprintByPath.size,
      packageReferenceOperations: replacements.filter(
        (entry) => entry.category === "package-reference",
      ).length,
      specialPolicyOperations: replacements.filter(
        (entry) => entry.category !== "package-reference",
      ).length,
      workspaceManifests: discovery.workspaces.length,
    },
  };
}
