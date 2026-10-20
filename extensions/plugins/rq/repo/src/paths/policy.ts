import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { isOperationalTextFile } from "../shared/static-policy";
import { REPO_PATHS_RULE_IDS } from "./rules";

export const CANONICAL_REPOSITORY_PATHS = Object.freeze([
  "apps/cli/dcs",
  "apps/cli/dler",
  "apps/cli/ome",
  "apps/cli/relda",
  "apps/cli/rdg",
  "apps/cli/rewse",
  "apps/cli/rq",
  "apps/cli/rse",
  "apps/cli/rvs",
  "extensions/addons/rse/migrate",
  "extensions/addons/rse/space",
  "extensions/browser/rewse",
  "extensions/plugins/rq/repo",
  "extensions/plugins/rse/config",
  "extensions/plugins/rvs/nc",
  "packages/rse/rse-gateway",
  "packages/rse/rse-protocol",
  "packages/rdg/rdg-protocol",
  "packages/rdg/rdg-rvs-private-static-preview",
  "tests/fixtures/relda",
  "tests/fixtures/rewse",
  "tests/fixtures/rvs",
] as const);

export const FORBIDDEN_TRACKED_PATH_PREFIXES = Object.freeze(["!handoff", ".agents/rse"] as const);

export const RETIRED_REPOSITORY_PREFIXES = Object.freeze([
  "apps/ome/companion",
  "packages/dcs/dcs-cli",
  "gateways/rse",
  "gateways/rdg",
  "gateways/protocols/rse",
  "gateways/protocols/rdg",
  "fixtures/relda",
  "fixtures/rewse",
  "fixtures/rvs",
  "plugins/compact",
  "plugins/compare",
  "plugins/concept",
  "plugins/config",
  "plugins/dler",
  "plugins/docs",
  "plugins/grab",
  "plugins/migrate",
  "plugins/nc",
  "plugins/os",
  "plugins/pm",
  "plugins/rdg",
  "plugins/relda",
  "plugins/relpack",
  "plugins/rewse",
  "plugins/rspace",
  "plugins/rx",
  "plugins/signals",
  "plugins/skills",
  "plugins/tools",
] as const);

export type GitTrackedPathInspection = {
  readonly failure?:
    | {
        readonly exitCode: number | null;
        readonly reason: "git-failed" | "spawn-failed";
      }
    | undefined;
  readonly paths: readonly string[];
};

async function gitTrackedPaths(repositoryRoot: string): Promise<GitTrackedPathInspection> {
  try {
    const child = Bun.spawn(
      [
        "git",
        "-c",
        "color.ui=false",
        "-c",
        "core.pager=cat",
        "-c",
        "core.quotepath=false",
        "ls-files",
        "--cached",
        "--full-name",
        "-z",
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...globalThis.process.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          PAGER: "cat",
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      Bun.readableStreamToText(child.stdout),
      Bun.readableStreamToText(child.stderr),
    ]);
    if (exitCode !== 0) {
      return Object.freeze({
        failure: Object.freeze({ exitCode, reason: "git-failed" as const }),
        paths: Object.freeze([]),
      });
    }
    const paths = stdout
      .split("\0")
      .filter(Boolean)
      .map(normalizeTrackedPath)
      .sort((left, right) => left.localeCompare(right));
    return Object.freeze({ paths: Object.freeze(paths) });
  } catch {
    return Object.freeze({
      failure: Object.freeze({ exitCode: null, reason: "spawn-failed" as const }),
      paths: Object.freeze([]),
    });
  }
}

function normalizeTrackedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function forbiddenTrackedPathFindings(
  trackedPaths: readonly string[],
  forbiddenPrefixes: readonly string[] = FORBIDDEN_TRACKED_PATH_PREFIXES,
): readonly RepositoryPolicyFinding[] {
  const prefixes = forbiddenPrefixes.map(normalizeTrackedPath);
  return Object.freeze(
    trackedPaths
      .map(normalizeTrackedPath)
      .filter((candidate) =>
        prefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`)),
      )
      .sort((left, right) => left.localeCompare(right))
      .map((candidate) => ({
        ruleId: REPO_PATHS_RULE_IDS.forbiddenTrackedPath,
        path: candidate,
        message: `${candidate}: private-first agent or handoff state is tracked by Git`,
      })),
  );
}

export async function inspectTrackedPathPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const inspection = await gitTrackedPaths(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  if (inspection.failure) {
    findings.push({
      ruleId: REPO_PATHS_RULE_IDS.trackedPathInspection,
      path: ".git",
      message: `.git: unable to inspect tracked repository paths (${inspection.failure.reason})`,
      data: inspection.failure,
    });
  } else {
    findings.push(...forbiddenTrackedPathFindings(inspection.paths));
  }
  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      forbiddenTrackedPaths: findings.filter(
        (finding) => finding.ruleId === REPO_PATHS_RULE_IDS.forbiddenTrackedPath,
      ).length,
      trackedPathInspection: inspection.failure ? "failed" : "passed",
      trackedPaths: inspection.paths.length,
    },
  };
}

function isFixturePath(relativePath: string): boolean {
  return relativePath.startsWith("tests/fixtures/") || relativePath.includes("/fixtures/");
}

function isOperationalFile(file: string): boolean {
  if (isFixturePath(file) || file.startsWith("docs/") || file.startsWith(".agents/")) return false;
  if (file.endsWith(".tsbuildinfo") || path.posix.basename(file) === "bun.lock") return false;
  return isOperationalTextFile(file) || path.posix.basename(file) === "package.json";
}

export async function inspectPathPolicy(repositoryRoot: string): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const trackedPathReport = await inspectTrackedPathPolicy(index.repoRoot);
  const findings: RepositoryPolicyFinding[] = [...trackedPathReport.findings];
  const workspaceManifests = new Set(index.workspacePackages.map((entry) => entry.manifestPath));

  for (const repositoryPackage of index.packages) {
    if (
      repositoryPackage.manifestPath === "package.json" ||
      isFixturePath(repositoryPackage.manifestPath) ||
      workspaceManifests.has(repositoryPackage.manifestPath)
    )
      continue;
    findings.push({
      ruleId: REPO_PATHS_RULE_IDS.workspaceCoverage,
      path: repositoryPackage.manifestPath,
      message: `${repositoryPackage.manifestPath}: package is not selected by root workspace patterns`,
    });
  }

  for (const canonicalPath of CANONICAL_REPOSITORY_PATHS) {
    if (
      !index.inventory.some(
        (file) => file === canonicalPath || file.startsWith(`${canonicalPath}/`),
      )
    ) {
      findings.push({
        ruleId: REPO_PATHS_RULE_IDS.canonicalPath,
        path: canonicalPath,
        message: `${canonicalPath}: canonical repository path is missing`,
      });
    }
  }

  const excludedScanners = new Set(["extensions/plugins/rq/repo/src/paths/policy.ts"]);
  let operationalFiles = 0;
  for (const file of index.inventory) {
    if (!isOperationalFile(file) || excludedScanners.has(file)) continue;
    operationalFiles += 1;
    let source: string;
    try {
      source = await index.readText(file);
    } catch {
      continue;
    }
    for (const retiredPrefix of RETIRED_REPOSITORY_PREFIXES) {
      const escapedPrefix = retiredPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const stalePattern = new RegExp(`(?<![A-Za-z0-9_./-])(?:\\./)?${escapedPrefix}`, "u");
      if (stalePattern.test(source)) {
        findings.push({
          ruleId: REPO_PATHS_RULE_IDS.retiredPrefix,
          path: file,
          message: `${file}: references removed path prefix ${retiredPrefix}`,
        });
      }
    }
    for (const match of source.matchAll(/packages\/rvs\/(?!rvs-|\*)[a-z0-9][a-z0-9-]*/gu)) {
      findings.push({
        ruleId: REPO_PATHS_RULE_IDS.rvsFamilyPrefix,
        path: file,
        message: `${file}: references unprefixed RVS package path ${match[0]}`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      operationalFiles,
      repositoryRoot: index.repoRoot,
      trackedPathFindings: trackedPathReport.findings.length,
    },
  };
}
