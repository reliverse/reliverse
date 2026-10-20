import path from "node:path";

import type { JsonValue, QualitySeverity } from "@reliverse/quality";
import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import type { RepoRqSchemasConfig } from "../config";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_SCHEMAS_RULE_IDS } from "./rules";

const VERSIONED_CONTRACT_FILE_PATTERN = /(?:^|[-_.])v[1-9]\d*(?:[-_.]|$)/iu;
const SYNTHETIC_PATH_PATTERN = /(?:^|\/)(?:tests?|fixtures)(?:\/|$)|\.test\.[cm]?[jt]sx?$/iu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function numericVersionPatterns(config: RepoRqSchemasConfig): readonly RegExp[] {
  const fieldNames = config.numericFieldNames.map((value) => value.trim()).filter(Boolean);
  const constantTokens = config.constantNameTokens.map((value) => value.trim()).filter(Boolean);
  const patterns: RegExp[] = [];
  if (fieldNames.length > 0) {
    patterns.push(
      new RegExp(
        `(?:\\b|["'])(?:${fieldNames.map(escapeRegExp).join("|")})(?:\\b|["'])\\s*(?::|=)\\s*([1-9]\\d*)\\b`,
        "gu",
      ),
    );
    patterns.push(
      new RegExp(`\\b(?:${fieldNames.map(escapeRegExp).join("|")})\\s+([1-9]\\d*)\\b`, "gu"),
    );
  }
  if (constantTokens.length > 0) {
    patterns.push(
      new RegExp(
        `\\b[A-Z0-9_]*(?:${constantTokens.map(escapeRegExp).join("|")})[A-Z0-9_]*_VERSION\\s*=\\s*([1-9]\\d*)\\b`,
        "gu",
      ),
    );
  }
  return Object.freeze(patterns);
}

function inRoot(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => file === root || file.startsWith(`${root.replace(/\/$/u, "")}/`));
}

function isIgnored(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

function effectiveSeverity(
  configured: QualitySeverity,
  mode: RepoRqSchemasConfig["adoptionMode"],
): QualitySeverity {
  if (mode === "observe") return "info";
  if (mode === "guided" && configured === "error") return "warning";
  return configured;
}

function finding(
  ruleId: string,
  file: string,
  message: string,
  severity: QualitySeverity,
  data: Readonly<Record<string, JsonValue>>,
): RepositoryPolicyFinding {
  return Object.freeze({ ruleId, path: file, message, severity, data });
}

function ownedFormatPattern(
  namespaces: readonly string[],
  nameTokens: readonly string[],
): RegExp | null {
  const values = namespaces.map((value) => value.trim()).filter(Boolean);
  const tokens = nameTokens.map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || tokens.length === 0) return null;
  const namespaceAlternatives = values
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  const tokenAlternatives = tokens
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  return new RegExp(
    `\\b(?:${namespaceAlternatives})[A-Za-z0-9_.:/-]*?(?:${tokenAlternatives})[A-Za-z0-9_.:/-]*?(?:\\.v|/v|[-:]v)([1-9]\\d*)\\b`,
    "giu",
  );
}

function matchingVersions(source: string, pattern: RegExp): readonly number[] {
  pattern.lastIndex = 0;
  return Object.freeze(
    [...source.matchAll(pattern)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
}

export async function inspectSchemasPolicy(
  repositoryRoot: string,
  config: RepoRqSchemasConfig,
): Promise<RepositoryPolicyReport> {
  if (config.adoptionMode === "off") {
    return Object.freeze({
      findings: Object.freeze([]),
      metadata: Object.freeze({ adoptionMode: config.adoptionMode, scannedFiles: 0 }),
    });
  }

  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const files = index.inventory
    .filter((file) => inRoot(file, config.roots))
    .filter((file) => !isIgnored(file, config.ignore))
    .sort((left, right) => left.localeCompare(right));
  const formatPattern = ownedFormatPattern(config.ownedNamespaces, config.ownedFormatNameTokens);
  const numericPatterns = numericVersionPatterns(config);
  const findings: RepositoryPolicyFinding[] = [];
  let readableFiles = 0;

  for (const file of files) {
    let source: string;
    try {
      source = await index.readText(file);
    } catch {
      continue;
    }
    readableFiles += 1;
    if (SYNTHETIC_PATH_PATTERN.test(file)) continue;

    const numericVersions = Object.freeze(
      numericPatterns.flatMap((pattern) => matchingVersions(source, pattern)),
    );
    if (numericVersions.length > 0) {
      findings.push(
        finding(
          REPO_SCHEMAS_RULE_IDS.numericGeneration,
          file,
          `${file}: contains active schemaVersion values above 0`,
          effectiveSeverity(config.numericGenerationSeverity, config.adoptionMode),
          {
            adoptionMode: config.adoptionMode,
            versions: Object.freeze([...new Set(numericVersions)].sort((a, b) => a - b)),
          },
        ),
      );
    }

    if (formatPattern) {
      const formatVersions = matchingVersions(source, formatPattern);
      if (formatVersions.length > 0) {
        findings.push(
          finding(
            REPO_SCHEMAS_RULE_IDS.ownedFormatGeneration,
            file,
            `${file}: contains Reliverse-owned v1+ format identifiers`,
            effectiveSeverity(config.ownedFormatGenerationSeverity, config.adoptionMode),
            {
              adoptionMode: config.adoptionMode,
              versions: Object.freeze([...new Set(formatVersions)].sort((a, b) => a - b)),
            },
          ),
        );
      }
    }

    if (VERSIONED_CONTRACT_FILE_PATTERN.test(path.posix.basename(file))) {
      findings.push(
        finding(
          REPO_SCHEMAS_RULE_IDS.versionedContractFilename,
          file,
          `${file}: active source filename looks generation-versioned`,
          effectiveSeverity(config.versionedFilenameSeverity, config.adoptionMode),
          { adoptionMode: config.adoptionMode },
        ),
      );
    }
  }

  return Object.freeze({
    findings: sortRepositoryPolicyFindings(findings),
    metadata: Object.freeze({
      adoptionMode: config.adoptionMode,
      findings: findings.length,
      readableFiles,
      scannedFiles: files.length,
    }),
  });
}
