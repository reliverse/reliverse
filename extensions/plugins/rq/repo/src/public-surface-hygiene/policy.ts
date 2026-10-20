import type { JsonValue, QualitySeverity } from "@reliverse/quality";
import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import type { RepoRqPublicSurfaceHygieneConfig } from "../config";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS } from "./rules";

const HOME_PATH_PATTERNS = Object.freeze([
  /(?<![A-Za-z0-9._/-])\/home\/([A-Za-z0-9._-]+)/gu,
  /\b[A-Z]:[\\/]Users[\\/]([A-Za-z0-9._-]+)/giu,
]);
const PRIVATE_TRANSITION_PATTERN = /\bgrt_[0-9]{6,}\b/giu;
const MISLEADING_RELEASE_PATTERN =
  /\b(?:release|released|version)\s+(?:grt_[a-z0-9_-]+|stage[-_ ]?[0-9]{2,})\b/giu;

function inRoot(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => file === root || file.startsWith(`${root.replace(/\/$/u, "")}/`));
}

function isIgnored(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(file));
}

function finding(
  ruleId: string,
  file: string,
  line: number,
  message: string,
  severity: QualitySeverity,
  data: Readonly<Record<string, JsonValue>>,
): RepositoryPolicyFinding {
  return Object.freeze({
    ruleId,
    path: file,
    message: `${file}:${line}: ${message}`,
    severity,
    data,
  });
}

export async function inspectPublicSurfaceHygienePolicy(
  repositoryRoot: string,
  config: RepoRqPublicSurfaceHygieneConfig,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const files = index.inventory
    .filter((file) => inRoot(file, config.roots))
    .filter((file) => !isIgnored(file, config.ignore))
    .sort((left, right) => left.localeCompare(right));
  const allowedPrincipals = new Set(
    config.allowedHomePrincipals.map((value) => value.toLowerCase()),
  );
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
    for (const [offset, line] of source.split(/\r?\n/u).entries()) {
      for (const pattern of HOME_PATH_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) {
          const principal = match[1]?.toLowerCase() ?? "";
          if (allowedPrincipals.has(principal)) continue;
          findings.push(
            finding(
              REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS.ownerLocalPath,
              file,
              offset + 1,
              `contains owner-local home path ${JSON.stringify(match[0])}`,
              config.ownerLocalPathSeverity,
              { principal },
            ),
          );
        }
      }

      PRIVATE_TRANSITION_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(PRIVATE_TRANSITION_PATTERN)) {
        findings.push(
          finding(
            REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS.privateTransitionLabel,
            file,
            offset + 1,
            `exposes private transition label ${JSON.stringify(match[0])}`,
            config.privateTransitionLabelSeverity,
            { label: match[0] },
          ),
        );
      }

      MISLEADING_RELEASE_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(MISLEADING_RELEASE_PATTERN)) {
        findings.push(
          finding(
            REPO_PUBLIC_SURFACE_HYGIENE_RULE_IDS.misleadingReleaseLabel,
            file,
            offset + 1,
            `describes internal sequencing as ${JSON.stringify(match[0])}`,
            config.misleadingReleaseLabelSeverity,
            { claim: match[0] },
          ),
        );
      }
    }
  }

  return Object.freeze({
    findings: sortRepositoryPolicyFindings(findings),
    metadata: Object.freeze({
      findings: findings.length,
      readableFiles,
      scannedFiles: files.length,
    }),
  });
}
