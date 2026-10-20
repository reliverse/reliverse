import { createRepositoryBoundaryIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_BOUNDARY_RULE_IDS } from "./rules";

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

export async function inspectBoundaryPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryBoundaryIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];

  for (const record of index.imports) {
    const repositoryToolingImporter = record.importer.startsWith("scripts/");
    if (/\.(?:ts|tsx|mts|cts)$/u.test(record.specifier)) {
      findings.push({
        ruleId: REPO_BOUNDARY_RULE_IDS.typescriptExtension,
        path: record.importer,
        range: record.range,
        message: `${record.importer} imports ${record.specifier}`,
        data: { specifier: record.specifier },
      });
    }
    // Repository tooling may import private workspace internals; runtime source packages may not.
    if (repositoryToolingImporter || !isRelativeSpecifier(record.specifier)) continue;
    const resolved = index.resolveRelativeImport(record.importer, record.specifier);
    if (!resolved) continue;
    const importerManifest = index.findNearestManifest(record.importer);
    const targetManifest = index.findNearestManifest(resolved);
    if (!importerManifest || !targetManifest) continue;
    if (importerManifest.manifestPath !== targetManifest.manifestPath) {
      findings.push({
        ruleId: REPO_BOUNDARY_RULE_IDS.relativeWorkspaceImport,
        path: record.importer,
        range: record.range,
        message: `${record.importer} imports ${record.specifier} (${resolved})`,
        data: {
          importerManifest: importerManifest.manifestPath,
          resolved,
          specifier: record.specifier,
          targetManifest: targetManifest.manifestPath,
        },
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { repositoryRoot: index.repoRoot, stats: { ...index.getStats() } },
  };
}
