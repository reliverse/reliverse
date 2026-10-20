import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_FIXTURE_RULE_IDS } from "./rules";

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".yml",
  ".yaml",
]);
export const DEFAULT_FIXTURE_OPERATIONAL_ROOTS = Object.freeze([
  "apps",
  "extensions",
  "packages",
  "scripts",
  "tests",
  ".github",
]);

export type InspectFixturePolicyOptions = {
  readonly operationalRoots?: readonly string[] | undefined;
};

export function normalizeFixturePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function fixtureTopologyFindings(
  paths: readonly string[],
): readonly RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  for (const raw of paths) {
    const candidate = normalizeFixturePath(raw);
    if (candidate === "fixtures" || candidate.startsWith("fixtures/")) {
      findings.push({
        ruleId: REPO_FIXTURE_RULE_IDS.sharedLocation,
        path: candidate,
        message: `${candidate}: shared fixtures must live under tests/fixtures`,
      });
    }
    if (candidate.endsWith(".tsbuildinfo")) {
      findings.push({
        ruleId: REPO_FIXTURE_RULE_IDS.buildMetadata,
        path: candidate,
        message: `${candidate}: generated TypeScript build metadata must not be committed`,
      });
    }
  }
  return sortRepositoryPolicyFindings(findings);
}

export async function inspectFixturePolicy(
  repositoryRoot: string,
  options: InspectFixturePolicyOptions = {},
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const operationalRoots = options.operationalRoots ?? DEFAULT_FIXTURE_OPERATIONAL_ROOTS;
  const findings: RepositoryPolicyFinding[] = [...fixtureTopologyFindings(index.inventory)];
  const staleReference = /(?<!tests\/)\bfixtures\/(?:relda|rewse|rvs)\b/gu;

  for (const file of index.inventory) {
    if (
      !TEXT_EXTENSIONS.has(path.posix.extname(file)) ||
      !operationalRoots.some((root) => file === root || file.startsWith(`${root}/`)) ||
      file === "extensions/plugins/rq/repo/src/paths/policy.ts"
    ) {
      continue;
    }
    const source = await index.readText(file);
    if (staleReference.test(source)) {
      findings.push({
        ruleId: REPO_FIXTURE_RULE_IDS.staleReference,
        path: file,
        message: `${file}: references a retired root shared-fixture path`,
      });
    }
    staleReference.lastIndex = 0;
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      inspectedFiles: index.inventory.length,
      repositoryRoot: index.repoRoot,
    },
  };
}
