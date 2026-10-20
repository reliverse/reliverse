import { readdir } from "node:fs/promises";
import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import { sortRepositoryPolicyFindings, type RepositoryPolicyReport } from "../shared/model";
import { REPO_PACKAGES_RULE_IDS } from "./rules";

export const DEFAULT_PACKAGE_FAMILY_ROOTS = Object.freeze([
  "packages/dler",
  "packages/relda",
  "packages/rse",
  "packages/rvs",
]);

const MINIMUM_BUN_VERSION = [1, 4, 2] as const;

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(?:>=)?\s*(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function versionAtLeast(value: string, minimum: readonly [number, number, number]): boolean {
  const parsed = parseVersion(value);
  if (!parsed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index]! > minimum[index]!) return true;
    if (parsed[index]! < minimum[index]!) return false;
  }
  return true;
}

export type InspectPackagePolicyOptions = {
  readonly familyRoots?: readonly string[] | undefined;
};

function exportTargets(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value).flatMap(exportTargets);
}

export async function inspectPackagePolicy(
  repositoryRoot: string,
  options: InspectPackagePolicyOptions = {},
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const findings = [];
  const familyRoots = options.familyRoots ?? DEFAULT_PACKAGE_FAMILY_ROOTS;
  const packageByManifest = new Map(index.packages.map((entry) => [entry.manifestPath, entry]));
  const issueByPath = new Map(index.issues.map((entry) => [entry.path, entry]));
  let checkedPackages = 0;

  const rootManifest = index.rootPackage.manifest;
  const rootBunEngine = rootManifest?.engines?.bun;
  const rootPackageManager = rootManifest?.packageManager;
  if (typeof rootBunEngine !== "string" || !versionAtLeast(rootBunEngine, MINIMUM_BUN_VERSION)) {
    findings.push({
      ruleId: REPO_PACKAGES_RULE_IDS.bunRuntimeFloor,
      path: "package.json",
      message: `package.json: engines.bun must require >=1.4.2; received ${String(rootBunEngine)}`,
    });
  }
  if (
    typeof rootPackageManager !== "string" ||
    !rootPackageManager.startsWith("bun@") ||
    !versionAtLeast(rootPackageManager.slice(4), MINIMUM_BUN_VERSION)
  ) {
    findings.push({
      ruleId: REPO_PACKAGES_RULE_IDS.bunRuntimeFloor,
      path: "package.json",
      message: `package.json: packageManager must pin Bun 1.4.2 or newer; received ${String(rootPackageManager)}`,
    });
  }
  for (const packageEntry of index.packages) {
    const bunEngine = packageEntry.manifest.engines?.bun;
    if (typeof bunEngine === "string" && !versionAtLeast(bunEngine, MINIMUM_BUN_VERSION)) {
      findings.push({
        ruleId: REPO_PACKAGES_RULE_IDS.bunRuntimeFloor,
        path: packageEntry.manifestPath,
        message: `${packageEntry.manifestPath}: engines.bun weakens the repository Bun floor (${bunEngine} < >=1.4.2)`,
      });
    }
  }

  for (const familyRoot of [...familyRoots].sort()) {
    let entries;
    try {
      entries = await readdir(path.join(index.repoRoot, familyRoot), { withFileTypes: true });
    } catch {
      findings.push({
        ruleId: REPO_PACKAGES_RULE_IDS.familyManifest,
        path: familyRoot,
        message: `${familyRoot}: package-family root does not exist`,
      });
      continue;
    }

    for (const entry of entries
      .filter((candidate) => candidate.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const packageRoot = `${familyRoot}/${entry.name}`;
      const manifestPath = `${packageRoot}/package.json`;
      const manifestEntry = packageByManifest.get(manifestPath);
      const issue = issueByPath.get(manifestPath);
      if (issue) {
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.manifestJson,
          path: manifestPath,
          message: `${manifestPath}: invalid JSON (${issue.message})`,
        });
        continue;
      }
      if (!manifestEntry) {
        const hasRepositoryContent = [...inventory].some((candidate) =>
          candidate.startsWith(`${packageRoot}/`),
        );
        if (!hasRepositoryContent) continue;
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.familyManifest,
          path: packageRoot,
          message: `${packageRoot}: package-family directory has no package.json`,
        });
        continue;
      }

      checkedPackages += 1;
      const manifest = manifestEntry.manifest;
      const family = path.posix.basename(familyRoot);
      const expectedName =
        entry.name === `${family}-core` ? `@reliverse/${family}` : `@reliverse/${entry.name}`;
      if (manifest.name !== expectedName) {
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.familyName,
          path: manifestPath,
          message: `${packageRoot}: expected package name ${expectedName}, received ${String(manifest.name)}`,
          data: { actualName: manifest.name ?? null, expectedName },
        });
      }
      if (!Object.hasOwn(manifest, "private") || typeof manifest.private !== "boolean") {
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.privateExplicit,
          path: manifestPath,
          message: `${packageRoot}: private must be explicit`,
        });
      }
      if (manifest.private === false && manifest.publishConfig?.access !== "public") {
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.publicAccess,
          path: manifestPath,
          message: `${packageRoot}: public package must set publishConfig.access to public`,
        });
      }
      if (!manifest.exports) {
        findings.push({
          ruleId: REPO_PACKAGES_RULE_IDS.exportsDeclared,
          path: manifestPath,
          message: `${packageRoot}: exports must be declared`,
        });
      }
      for (const target of [...new Set(exportTargets(manifest.exports))].sort()) {
        if (!target.startsWith("./")) continue;
        const targetPath = path.posix.normalize(`${packageRoot}/${target.slice(2)}`);
        if (!inventory.has(targetPath)) {
          findings.push({
            ruleId: REPO_PACKAGES_RULE_IDS.exportTarget,
            path: manifestPath,
            message: `${packageRoot}: export target does not exist: ${target}`,
            data: { target, targetPath },
          });
        }
      }
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      checkedPackages,
      familyRoots: [...familyRoots],
      repositoryRoot: index.repoRoot,
    },
  };
}
