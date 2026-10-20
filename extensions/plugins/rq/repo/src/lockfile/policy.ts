import { createRepositoryPolicyIndex, type RepositoryPolicyManifest } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asRecord, asStringRecord } from "../shared/static-policy";
import { REPO_LOCKFILE_RULE_IDS } from "./rules";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function normalizedRecord(value: unknown): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(asStringRecord(value)).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export async function inspectLockfilePolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const lockfilePath = "bun.lock";

  if (!index.inventory.includes(lockfilePath)) {
    return {
      findings: [
        {
          ruleId: REPO_LOCKFILE_RULE_IDS.present,
          path: lockfilePath,
          message: "bun.lock: lockfile is missing",
        },
      ],
      metadata: { repositoryRoot: index.repoRoot, workspaces: index.workspacePackages.length },
    };
  }

  let lockfile: Readonly<Record<string, unknown>>;
  try {
    lockfile = asRecord(Bun.JSONC.parse(await index.readText(lockfilePath)));
  } catch (error) {
    return {
      findings: [
        {
          ruleId: REPO_LOCKFILE_RULE_IDS.present,
          path: lockfilePath,
          message: `bun.lock: lockfile is malformed (${error instanceof Error ? error.message : String(error)})`,
        },
      ],
      metadata: { repositoryRoot: index.repoRoot, workspaces: index.workspacePackages.length },
    };
  }

  const lockWorkspaces = asRecord(lockfile.workspaces);
  const lockPackages = asRecord(lockfile.packages);
  const root = index.rootPackage.manifest;
  if (lockWorkspaces[""] === undefined) {
    findings.push({
      ruleId: REPO_LOCKFILE_RULE_IDS.workspaceEntry,
      path: lockfilePath,
      message: "bun.lock: missing root workspace metadata",
    });
  } else {
    const lockedRoot = asRecord(lockWorkspaces[""]);
    if (
      root.name !== lockedRoot.name ||
      DEPENDENCY_FIELDS.some(
        (field) => normalizedRecord(root[field]) !== normalizedRecord(lockedRoot[field]),
      )
    ) {
      findings.push({
        ruleId: REPO_LOCKFILE_RULE_IDS.workspaceMetadata,
        path: "package.json",
        message: "package.json: bun.lock root name/dependency metadata does not match the manifest",
      });
    }
  }
  const expectedWorkspacePaths = new Set(index.workspacePackages.map((entry) => entry.directory));

  for (const workspace of index.workspacePackages) {
    const lockedValue = lockWorkspaces[workspace.directory];
    if (lockedValue === undefined) {
      findings.push({
        ruleId: REPO_LOCKFILE_RULE_IDS.workspaceEntry,
        path: lockfilePath,
        message: `bun.lock: missing workspace metadata for ${workspace.directory}`,
      });
      continue;
    }
    const locked = asRecord(lockedValue) as RepositoryPolicyManifest;
    if (workspace.manifest.name !== locked.name || workspace.manifest.version !== locked.version) {
      findings.push({
        ruleId: REPO_LOCKFILE_RULE_IDS.workspaceMetadata,
        path: workspace.manifestPath,
        message: `${workspace.manifestPath}: lockfile name/version metadata does not match the manifest`,
      });
    }
    for (const field of DEPENDENCY_FIELDS) {
      if (normalizedRecord(workspace.manifest[field]) !== normalizedRecord(locked[field])) {
        findings.push({
          ruleId: REPO_LOCKFILE_RULE_IDS.workspaceMetadata,
          path: workspace.manifestPath,
          message: `${workspace.manifestPath}: bun.lock ${field} metadata does not match the manifest`,
        });
      }
    }

    const packageName = workspace.manifest.name;
    if (packageName) {
      const packageReference = lockPackages[packageName];
      const expectedReference = `${packageName}@workspace:${workspace.directory}`;
      if (!Array.isArray(packageReference) || packageReference[0] !== expectedReference) {
        findings.push({
          ruleId: REPO_LOCKFILE_RULE_IDS.packageAlias,
          path: lockfilePath,
          message: `bun.lock: package alias for ${packageName} must target ${expectedReference}`,
        });
      }
    }
  }

  for (const lockedPath of Object.keys(lockWorkspaces).filter(Boolean)) {
    if (!expectedWorkspacePaths.has(lockedPath)) {
      findings.push({
        ruleId: REPO_LOCKFILE_RULE_IDS.staleWorkspace,
        path: lockfilePath,
        message: `bun.lock: stale workspace metadata for ${lockedPath}`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { repositoryRoot: index.repoRoot, workspaces: index.workspacePackages.length },
  };
}
