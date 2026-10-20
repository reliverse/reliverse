import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_TOPOLOGY_RULE_IDS } from "./rules";

export type TypecheckTopologyIssue = {
  readonly config: string;
  readonly manifest: string;
  readonly reason: "missing-config" | "outside-root" | "unregistered-project";
};

export type TypecheckTopologyReport = RepositoryPolicyReport & {
  readonly checkedPackages: number;
  readonly issues: readonly TypecheckTopologyIssue[];
};

export type InspectTypecheckTopologyOptions = {
  readonly registeredProjects?: readonly string[] | undefined;
};

const projectFlagPattern = /(?:^|\s)(?:-p|--project)(?:\s+|=)(?:(["'])(.*?)\1|([^\s;&|]+))/u;

function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function configPathFromScript(script: string): string {
  const match = script.match(projectFlagPattern);
  return match?.[2] ?? match?.[3] ?? "tsconfig.json";
}

function relativeToRoot(root: string, candidate: string): string | undefined {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return normalize(relative || ".");
}

function isRegisteredTsconfig(file: string): boolean {
  if (!/^tsconfig(?:\.[^/]+)?\.json$/u.test(path.posix.basename(file))) return false;
  return !file
    .split("/")
    .some((part) => ["build", "dist", "node_modules", ".cache", ".git", ".next"].includes(part));
}

export async function inspectTypecheckTopologyPolicy(
  repositoryRoot: string,
  options: InspectTypecheckTopologyOptions = {},
): Promise<TypecheckTopologyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const registeredProjects = new Set(
    (options.registeredProjects ?? index.inventory.filter(isRegisteredTsconfig)).map(normalize),
  );
  const findings: RepositoryPolicyFinding[] = [];
  const issues: TypecheckTopologyIssue[] = [];
  let checkedPackages = 0;

  for (const workspace of index.workspacePackages) {
    const script = workspace.manifest.scripts?.typecheck;
    if (typeof script !== "string" || script.length === 0) continue;
    checkedPackages += 1;
    const absoluteConfig = path.resolve(
      index.repoRoot,
      workspace.directory,
      configPathFromScript(script),
    );
    const config = relativeToRoot(index.repoRoot, absoluteConfig);
    let issue: TypecheckTopologyIssue | undefined;
    let ruleId: string | undefined;
    if (!config) {
      issue = {
        config: normalize(absoluteConfig),
        manifest: workspace.manifestPath,
        reason: "outside-root",
      };
      ruleId = REPO_TOPOLOGY_RULE_IDS.configInsideRoot;
    } else if (!inventory.has(config)) {
      issue = { config, manifest: workspace.manifestPath, reason: "missing-config" };
      ruleId = REPO_TOPOLOGY_RULE_IDS.configExists;
    } else if (!registeredProjects.has(config)) {
      issue = { config, manifest: workspace.manifestPath, reason: "unregistered-project" };
      ruleId = REPO_TOPOLOGY_RULE_IDS.projectRegistered;
    }
    if (!issue || !ruleId) continue;
    issues.push(issue);
    findings.push({
      ruleId,
      path: workspace.manifestPath,
      message: `${workspace.manifestPath}: ${issue.reason} (${issue.config})`,
      data: issue,
    });
  }

  issues.sort(
    (left, right) =>
      left.manifest.localeCompare(right.manifest) || left.reason.localeCompare(right.reason),
  );
  return {
    checkedPackages,
    findings: sortRepositoryPolicyFindings(findings),
    issues: Object.freeze(issues),
    metadata: {
      checkedPackages,
      registeredProjects: registeredProjects.size,
      repositoryRoot: index.repoRoot,
    },
  };
}
