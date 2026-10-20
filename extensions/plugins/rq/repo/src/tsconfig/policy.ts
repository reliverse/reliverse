import {
  createRepositoryBoundaryIndex,
  createRepositoryPolicyIndex,
  parseRepositoryJsonc,
} from "@reliverse/repo-index";

import { DEFAULT_PACKAGE_FAMILY_ROOTS } from "../packages/policy";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_TSCONFIG_RULE_IDS } from "./rules";

export const DEFAULT_TSCONFIG_EXTENDS = Object.freeze([
  "@repo/tsconfig/ts-only.json",
  "@repo/tsconfig/ts-tsx.json",
]);

export const DEFAULT_TYPESCRIPT_DEV_DEPENDENCIES = Object.freeze({
  "@repo/tsconfig": "workspace:*",
  "@types/bun": "catalog:",
  "typescript-7": "catalog:",
});

export type InspectTsconfigPolicyOptions = {
  readonly allowedExtends?: readonly string[] | undefined;
  readonly familyRoots?: readonly string[] | undefined;
  readonly requiredDevDependencies?: Readonly<Record<string, string>> | undefined;
};

function belongsToFamily(directory: string, familyRoots: readonly string[]): boolean {
  return familyRoots.some((root) => {
    if (!directory.startsWith(`${root}/`)) return false;
    return !directory.slice(root.length + 1).includes("/");
  });
}

export async function inspectTsconfigPolicy(
  repositoryRoot: string,
  options: InspectTsconfigPolicyOptions = {},
): Promise<RepositoryPolicyReport> {
  const [boundary, policy] = await Promise.all([
    createRepositoryBoundaryIndex(repositoryRoot),
    createRepositoryPolicyIndex(repositoryRoot),
  ]);
  const allowedExtends = new Set(options.allowedExtends ?? DEFAULT_TSCONFIG_EXTENDS);
  const requiredDependencies =
    options.requiredDevDependencies ?? DEFAULT_TYPESCRIPT_DEV_DEPENDENCIES;
  const familyRoots = options.familyRoots ?? DEFAULT_PACKAGE_FAMILY_ROOTS;
  const inventory = new Set(policy.inventory);
  const findings: RepositoryPolicyFinding[] = [];
  const boundaryWorkspaceByManifest = new Map(
    boundary.workspacePackages.map((entry) => [entry.manifestPath, entry]),
  );

  for (const workspace of policy.workspacePackages) {
    const configPath = `${workspace.directory}/tsconfig.json`;
    const hasConfig = inventory.has(configPath);
    const hasTypeScriptSource = policy.sourceFiles.some(
      (file) =>
        file.startsWith(`${workspace.directory}/src/`) && /\.(?:cts|mts|ts|tsx)$/u.test(file),
    );
    if (hasTypeScriptSource || belongsToFamily(workspace.directory, familyRoots)) {
      if (!hasConfig) {
        findings.push({
          ruleId: REPO_TSCONFIG_RULE_IDS.familyConfig,
          path: workspace.manifestPath,
          message: `${workspace.directory}: tsconfig.json is missing`,
        });
      }
      if (typeof workspace.manifest.scripts?.typecheck !== "string") {
        findings.push({
          ruleId: REPO_TSCONFIG_RULE_IDS.typecheckScript,
          path: workspace.manifestPath,
          message: `${workspace.directory}: scripts.typecheck must be declared`,
        });
      }
    }
    if (!hasConfig) continue;
    const parsed = parseRepositoryJsonc(await policy.readText(configPath), configPath);
    if (!parsed.value) {
      findings.push({
        ruleId: REPO_TSCONFIG_RULE_IDS.validJsonc,
        path: configPath,
        message: `${configPath} is not valid JSONC`,
        data: { error: parsed.error ?? "invalid JSONC" },
      });
      continue;
    }
    const extendedConfig = parsed.value.extends;
    if (typeof extendedConfig !== "string" || !allowedExtends.has(extendedConfig)) {
      findings.push({
        ruleId: REPO_TSCONFIG_RULE_IDS.sharedPreset,
        path: configPath,
        message: `${configPath} extends ${JSON.stringify(extendedConfig)}`,
        data: {
          actual: typeof extendedConfig === "string" ? extendedConfig : null,
          allowed: [...allowedExtends].sort(),
        },
      });
    }
    const compilerOptions = parsed.value.compilerOptions;
    if (
      compilerOptions &&
      typeof compilerOptions === "object" &&
      !Array.isArray(compilerOptions) &&
      (compilerOptions as Record<string, unknown>).allowImportingTsExtensions === true
    ) {
      findings.push({
        ruleId: REPO_TSCONFIG_RULE_IDS.importExtensions,
        path: configPath,
        message: `${configPath} enables allowImportingTsExtensions`,
      });
    }

    const boundaryWorkspace = boundaryWorkspaceByManifest.get(workspace.manifestPath);
    const devDependencies =
      boundaryWorkspace?.manifest.devDependencies ?? workspace.manifest.devDependencies ?? {};
    for (const [dependency, expectedVersion] of Object.entries(requiredDependencies).sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const actualVersion = devDependencies[dependency];
      if (actualVersion !== expectedVersion) {
        findings.push({
          ruleId: REPO_TSCONFIG_RULE_IDS.sharedToolchain,
          path: workspace.manifestPath,
          message: `${workspace.manifestPath} devDependencies.${dependency} is ${JSON.stringify(actualVersion)}; expected ${expectedVersion}`,
          data: {
            actual: typeof actualVersion === "string" ? actualVersion : null,
            dependency,
            expected: expectedVersion,
          },
        });
      }
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      checkedWorkspaces: policy.workspacePackages.length,
      repositoryRoot: policy.repoRoot,
    },
  };
}
