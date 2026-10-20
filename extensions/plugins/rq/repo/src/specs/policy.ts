import path from "node:path";

import type { QualitySeverity } from "@reliverse/quality";
import { createRepositoryPolicyIndex } from "@reliverse/repo-index";
import { verifySpecManifestAtPath } from "@reliverse/spec";

import type { RepoRqSpecsConfig } from "../config";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_SPECS_RULE_IDS } from "./rules";

const VERSIONED_FILE_PATTERN = /(?:^|[-_.])v\d+(?:[-_.]|$)/iu;
const DUPLICATE_FILE_PATTERN = /(?:-(?:[2-9]\d*)|[-_.](?:copy|final|fixed|retry))\.md$/iu;
const VERSIONED_TITLE_PATTERN = /^#\s+.*\bv\d+\b/imu;

const HISTORICAL_PATTERNS = Object.freeze([
  Object.freeze({
    id: "stage-narration",
    pattern: /\bStages?\s+\d+(?:\s*[–—-]\s*\d+)?\b/iu,
  }),
  Object.freeze({
    id: "patch-narration",
    pattern: /\bPatches?\s+\d+(?:\s*[–—-]\s*\d+)?\b/iu,
  }),
  Object.freeze({
    id: "repository-artifact",
    pattern:
      /\b(?:reliverse|bleverse)-\d+\.\d+\.\d+(?:[-.][a-z0-9]+)*\.(?:patch|zip|tar(?:\.(?:zst|gz|xz|bz2))?)\b/iu,
  }),
  Object.freeze({
    id: "handoff-closure",
    pattern: /\brq-\d+(?:-plus)?-handoff-closure\.md\b/iu,
  }),
]);

function inRoot(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => file === root || file.startsWith(`${root.replace(/\/$/u, "")}/`));
}

function isIgnored(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

function effectiveSeverity(
  configured: QualitySeverity,
  mode: RepoRqSpecsConfig["adoptionMode"],
): QualitySeverity {
  if (mode === "observe") return "info";
  if (mode === "guided" && configured === "error") return "warning";
  return configured;
}

function lineCount(source: string): number {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/u).length;
}

function finding(
  ruleId: string,
  file: string,
  message: string,
  severity: QualitySeverity,
  data: Record<string, string | number | readonly string[]>,
): RepositoryPolicyFinding {
  return Object.freeze({ ruleId, path: file, message, severity, data });
}

export async function inspectSpecsPolicy(
  repositoryRoot: string,
  config: RepoRqSpecsConfig,
): Promise<RepositoryPolicyReport> {
  if (config.adoptionMode === "off") {
    return Object.freeze({
      findings: Object.freeze([]),
      metadata: Object.freeze({ adoptionMode: config.adoptionMode, scannedFiles: 0 }),
    });
  }

  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const files = index.inventory
    .filter((file) => file.endsWith(".md"))
    .filter((file) => inRoot(file, config.roots))
    .filter((file) => !isIgnored(file, config.ignore))
    .sort((left, right) => left.localeCompare(right));
  const findings: RepositoryPolicyFinding[] = [];

  for (const manifestPath of config.requiredManifests) {
    const verification = await verifySpecManifestAtPath(repositoryRoot, manifestPath);
    if (!verification.ok) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.manifestDrift,
          manifestPath,
          verification.message,
          config.manifestSeverity,
          {
            adoptionMode: config.adoptionMode,
            expectedDocuments: verification.expected.summary.documents,
          },
        ),
      );
      continue;
    }
    const invalidCanonical = verification.expected.entries.filter(
      (entry) => entry.authorityClass === "canonical" && entry.diagnostics.length > 0,
    );
    if (invalidCanonical.length > 0) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.canonicalMetadata,
          manifestPath,
          `${manifestPath}: ${invalidCanonical.length} canonical Spec document(s) have incomplete metadata`,
          config.canonicalMetadataSeverity,
          {
            adoptionMode: config.adoptionMode,
            paths: Object.freeze(invalidCanonical.map((entry) => entry.path)),
          },
        ),
      );
    }
  }

  for (const file of files) {
    const basename = path.posix.basename(file);
    let source: string;
    try {
      source = await index.readText(file);
    } catch {
      continue;
    }

    if (VERSIONED_FILE_PATTERN.test(basename) || VERSIONED_TITLE_PATTERN.test(source)) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.versionedLivingSpec,
          file,
          `${file}: living specification identity contains a v0/v1-style generation`,
          effectiveSeverity(config.versionedLivingSeverity, config.adoptionMode),
          { adoptionMode: config.adoptionMode },
        ),
      );
    }

    if (DUPLICATE_FILE_PATTERN.test(basename)) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.duplicateGeneration,
          file,
          `${file}: filename looks like a parallel specification generation`,
          effectiveSeverity(config.duplicateGenerationSeverity, config.adoptionMode),
          { adoptionMode: config.adoptionMode },
        ),
      );
    }

    const lines = lineCount(source);
    if (lines > config.maxLines) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.oversizedFile,
          file,
          `${file}: ${lines} lines exceeds the configured ${config.maxLines}-line adoption budget`,
          effectiveSeverity(config.oversizedSeverity, config.adoptionMode),
          { adoptionMode: config.adoptionMode, lines, maxLines: config.maxLines },
        ),
      );
    }

    const historicalMatches = HISTORICAL_PATTERNS.filter((entry) => entry.pattern.test(source)).map(
      (entry) => entry.id,
    );
    if (historicalMatches.length > 0) {
      findings.push(
        finding(
          REPO_SPECS_RULE_IDS.historicalArtifact,
          file,
          `${file}: contains changelog-like stage, patch, archive, or handoff history`,
          effectiveSeverity(config.historicalArtifactSeverity, config.adoptionMode),
          {
            adoptionMode: config.adoptionMode,
            matchedPatterns: Object.freeze(historicalMatches),
          },
        ),
      );
    }
  }

  return Object.freeze({
    findings: sortRepositoryPolicyFindings(findings),
    metadata: Object.freeze({
      adoptionMode: config.adoptionMode,
      findings: findings.length,
      maxLines: config.maxLines,
      scannedFiles: files.length,
    }),
  });
}
