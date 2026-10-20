import { access } from "node:fs/promises";
import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_RUNTIME_RULE_IDS } from "./rules";

const RETIRED_RUNTIME_PATHS = Object.freeze([
  "extensions/plugins/rvs/os",
  ".deploy",
  ".github/workflows/deploy.yml",
  "scripts/sh/install-prod-systemd.sh",
]);

export async function inspectRuntimePolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const findings: RepositoryPolicyFinding[] = [];

  async function source(file: string): Promise<string> {
    return inventory.has(file) ? index.readText(file) : "";
  }

  const boundariesPath = "docs/specs/arch/runtime-boundaries.md";
  const boundaries = await source(boundariesPath);
  for (const required of [
    "Bleverse / BDI authorized intent",
    "RDG intake and deployment decision",
    "RVS target-readiness request or bounded host work order",
    "FSG may provide bounded source evidence or a candidate artifact to RDG",
  ]) {
    if (!boundaries.includes(required)) {
      findings.push({
        ruleId: REPO_RUNTIME_RULE_IDS.sot,
        path: boundariesPath,
        message: `${boundariesPath}: runtime boundary SOT is missing ${JSON.stringify(required)}`,
      });
    }
  }

  const readinessPath = "docs/specs/arch/legacy-surface-removal-readiness.md";
  const readiness = await source(readinessPath);
  for (const required of ["Declared repository scope: `removable`", "## Agent System invariant"]) {
    if (!readiness.includes(required)) {
      findings.push({
        ruleId: REPO_RUNTIME_RULE_IDS.sot,
        path: readinessPath,
        message: `${readinessPath}: removal-readiness SOT is missing ${JSON.stringify(required)}`,
      });
    }
  }

  const ownershipPath = "docs/specs/arch/path-ownership.md";
  if (
    !(await source(ownershipPath)).includes(
      "caller-selected roots are fixture, import/export, or compatibility inputs",
    )
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.sot,
      path: ownershipPath,
      message: `${ownershipPath}: explicit legacy roots are not classified as caller-selected inputs`,
    });
  }

  const fsgPath = "docs/specs/arch/rse-fsg.md";
  if (
    !(await source(fsgPath)).includes(
      "never selects a release, target, provider, rollout, or host operation",
    )
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.sot,
      path: fsgPath,
      message: `${fsgPath}: FSG deployment-authority boundary is missing`,
    });
  }

  const architectureIndexPath = "docs/specs/arch/index.md";
  const architectureIndex = await source(architectureIndexPath);
  if (
    !architectureIndex.includes("runtime-boundaries.md") ||
    !architectureIndex.includes("legacy-surface-removal-readiness.md")
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.architectureIndex,
      path: architectureIndexPath,
      message: `${architectureIndexPath}: runtime boundary and removal-readiness SOT must both be linked`,
    });
  }

  const rseRvsPath = "apps/cli/rse/src/cmds/rvs/cmd.ts";
  const rseRvs = await source(rseRvsPath);
  if (
    !/commands:\s*\[\s*['"]mint-local['"]\s*,?\s*\]/u.test(rseRvs) ||
    /['"](?:release|deploy)['"]/u.test(rseRvs)
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.rseRvsSurface,
      path: rseRvsPath,
      message: `${rseRvsPath}: Rse to RVS bridge must remain limited to mint-local`,
    });
  }

  const rdgCliPath = "apps/cli/rdg/src/cli.ts";
  const rdgCli = await source(rdgCliPath);
  const retiredRdgPaths = [
    "extensions/plugins/rvs/rdg",
    "packages/rvs/rvs-rdg-core",
    "packages/rvs/rvs-rdg-protocol",
    "packages/rvs/rvs-rdg-private-static-preview",
  ] as const;
  const hasRetiredRdgPath = retiredRdgPaths.some((retiredPath) =>
    [...inventory].some(
      (candidate) => candidate === retiredPath || candidate.startsWith(`${retiredPath}/`),
    ),
  );
  if (
    !rdgCli.includes("defineCLI") ||
    !rdgCli.includes('name: "rdg"') ||
    rdgCli.includes("definePlugin") ||
    hasRetiredRdgPath
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.rdgLifecycle,
      path: rdgCliPath,
      message: `${rdgCliPath}: RDG must remain a standalone Rempts CLI and the historical RVS RDG plugin must stay retired`,
    });
  }

  const rvsCliPath = "apps/cli/rvs/src/cli.ts";
  if ((await source(rvsCliPath)).includes("--root .rvs/")) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.rvsRoot,
      path: rvsCliPath,
      message: `${rvsCliPath}: CLI help must not present .rvs as a canonical root`,
    });
  }

  const rvsReadmePath = "apps/cli/rvs/README.md";
  const rvsReadme = await source(rvsReadmePath);
  if (
    !rvsReadme.includes("caller-selected fixture or export roots") ||
    rvsReadme.includes("docs/specs/v0/rvs/") ||
    /\]\(docs\//u.test(rvsReadme)
  ) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.rvsRoot,
      path: rvsReadmePath,
      message: `${rvsReadmePath}: fixture roots and RVS Home ownership are not documented coherently`,
    });
  }

  const linkPattern = /\]\(([^)#]+)(?:#[^)]*)?\)/gu;
  for (const match of rvsReadme.matchAll(linkPattern)) {
    const target = match[1];
    if (!target || ["http://", "https://", "/"].some((prefix) => target.startsWith(prefix)))
      continue;
    try {
      await access(path.resolve(index.repoRoot, path.dirname(rvsReadmePath), target));
    } catch {
      findings.push({
        ruleId: REPO_RUNTIME_RULE_IDS.localDocLink,
        path: rvsReadmePath,
        message: `${rvsReadmePath}: broken local Markdown link ${target}`,
      });
    }
  }

  const rvsConfigPath = "apps/cli/rvs/src/config.ts";
  const rvsConfig = await source(rvsConfigPath);
  if (rvsConfig.includes("plugin-rvs-os") || rvsConfig.includes("/plugins/os")) {
    findings.push({
      ruleId: REPO_RUNTIME_RULE_IDS.retiredSurface,
      path: rvsConfigPath,
      message: `${rvsConfigPath}: retired OS plugin namespace was reintroduced`,
    });
  }

  for (const retiredPath of RETIRED_RUNTIME_PATHS) {
    if (
      inventory.has(retiredPath) ||
      index.inventory.some((file) => file.startsWith(`${retiredPath}/`))
    ) {
      findings.push({
        ruleId: REPO_RUNTIME_RULE_IDS.retiredSurface,
        path: retiredPath,
        message: `${retiredPath}: retired runtime surface was reintroduced`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { repositoryRoot: index.repoRoot, retiredPaths: RETIRED_RUNTIME_PATHS.length },
  };
}
