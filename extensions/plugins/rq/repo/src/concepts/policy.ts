import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { isOperationalTextFile } from "../shared/static-policy";
import { REPO_CONCEPT_RULE_IDS } from "./rules";

const OPERATIONAL_ROOTS = [
  "apps",
  "extensions",
  "packages",
  "scripts",
  "tests",
  ".github",
] as const;
const RETIRED_NC_PATTERN =
  /(?:\bNode Capsule\b|@reliverse\/node-capsule|\bnode-capsule\b|\brse nc\b|\bbun nc\b)/u;

export function retiredConceptOwnershipFindings(
  file: string,
  source: string,
): readonly RepositoryPolicyFinding[] {
  return RETIRED_NC_PATTERN.test(source)
    ? [
        {
          ruleId: REPO_CONCEPT_RULE_IDS.retiredRseNc,
          path: file,
          message: `${file}: references retired Node Capsule ownership; migrate the current path to RPR, GR, Dler/RDG, RQ, or RVS`,
        },
      ]
    : [];
}

export async function inspectConceptPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const excludedPrefixes = ["extensions/plugins/rq/repo/src/concepts/"];
  let inspectedFiles = 0;

  for (const file of index.inventory) {
    if (
      excludedPrefixes.some((prefix) => file.startsWith(prefix)) ||
      !isOperationalTextFile(file) ||
      !OPERATIONAL_ROOTS.some((root) => file === root || file.startsWith(`${root}/`)) ||
      file.includes("/fixtures/") ||
      file.startsWith("tests/fixtures/")
    )
      continue;
    inspectedFiles += 1;
    findings.push(...retiredConceptOwnershipFindings(file, await index.readText(file)));
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { inspectedFiles, repositoryRoot: index.repoRoot },
  };
}
