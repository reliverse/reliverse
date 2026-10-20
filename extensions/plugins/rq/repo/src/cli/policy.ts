import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asStringRecord } from "../shared/static-policy";
import { inspectCliHostInventory } from "./inventory";
import { REPO_CLI_RULE_IDS } from "./rules";

export const REPOSITORY_CLI_HOSTS = Object.freeze(
  [
    "cap",
    "dcs",
    "dler",
    "fsg",
    "gr",
    "ome",
    "rdg",
    "relda",
    "rev",
    "rewse",
    "rpr",
    "rq",
    "rse",
    "rvs",
    "switch",
  ].map((directory) => ({ directory, packageName: `@reliverse/${directory}-cli` })),
);

export async function inspectCliPolicy(repositoryRoot: string): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const inventory = new Set(index.inventory);
  const cliInventory = await inspectCliHostInventory(repositoryRoot);
  const rootScripts = asStringRecord(index.rootPackage.manifest.scripts);

  for (const host of cliInventory.entries) {
    const directory = `apps/cli/${host.directory}`;
    const manifestPath = `${directory}/package.json`;
    const entryPath = `${directory}/src/cli.ts`;
    const commandPrefix = `${directory}/src/cmds/`;
    const workspace = index.packages.find((entry) => entry.manifestPath === manifestPath);

    const expectedPackageName = `@reliverse/${host.directory}-cli`;
    if (workspace?.manifest.name !== expectedPackageName) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.packageIdentity,
        path: manifestPath,
        message: `${manifestPath}: expected package identity ${expectedPackageName}; received ${String(workspace?.manifest.name ?? "missing")}`,
      });
    }

    if (!host.hasRemptsDependency) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.remptsHost,
        path: manifestPath,
        message: `${manifestPath}: first-party CLI packages must depend on @reliverse/rempts`,
      });
    }

    const bin = asStringRecord(workspace?.manifest.bin);
    if (bin[host.directory] !== "./src/cli.ts") {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.binaryEntrypoint,
        path: manifestPath,
        message: `${manifestPath}: bin.${host.directory} must target ./src/cli.ts`,
      });
    }

    const rootScript = rootScripts[host.directory];
    if (!rootScript?.includes(entryPath)) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.rootScript,
        path: "package.json",
        message: `package.json: scripts.${host.directory} must target ${entryPath}`,
      });
    }

    if (!inventory.has(entryPath)) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.shebang,
        path: entryPath,
        message: `${entryPath}: CLI entrypoint is missing`,
      });
    } else if (!(await index.readText(entryPath)).startsWith("#!/usr/bin/env bun\n")) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.shebang,
        path: entryPath,
        message: `${entryPath}: must start with #!/usr/bin/env bun`,
      });
    }

    if (!index.inventory.some((file) => file.startsWith(commandPrefix))) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.commandRoot,
        path: `${directory}/src/cmds`,
        message: `${directory}/src/cmds: command discovery root is missing or empty`,
      });
    }

    const scripts = asStringRecord(workspace?.manifest.scripts);
    for (const [name, script] of Object.entries(scripts)) {
      if (
        /^(?:pre)?(?:dev|start|check|test|typecheck)$/.test(name) &&
        /(?:generate-rempts-profile|profile:generate|generate:rempts-profile)/.test(script)
      ) {
        findings.push({
          ruleId: REPO_CLI_RULE_IDS.remptsSourceNative,
          path: manifestPath,
          message: `${directory}: scripts.${name} must not regenerate Rempts profiles for normal source execution or validation`,
        });
      }
    }
    if (
      inventory.has(entryPath) &&
      /(?:import|export)[^\n]*["'][^"']*generated-(?:core-)?profile\./.test(
        await index.readText(entryPath),
      )
    ) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.remptsSourceNative,
        path: entryPath,
        message: `${directory}: source entrypoint imports generated Rempts authority`,
      });
    }
    for (const generatedProfilePath of index.inventory.filter(
      (file) =>
        file.startsWith(`${directory}/src/`) &&
        /\/generated-(?:core-)?profile\.(?:mjs|d\.mts)$/.test(file),
    )) {
      findings.push({
        ruleId: REPO_CLI_RULE_IDS.remptsSourceNative,
        path: generatedProfilePath,
        message: `${directory}: authored Rempts source must not require a generated runtime profile; materialize static closure only inside Dler artifact builds`,
      });
    }
  }

  const nonCliExecutablePackages = index.packages
    .filter((entry) => !entry.manifestPath.startsWith("apps/cli/"))
    .filter((entry) => Object.keys(asStringRecord(entry.manifest.bin)).length > 0)
    .map((entry) => entry.manifestPath)
    .sort();

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      cliHosts: cliInventory.entries.length,
      nonCliExecutablePackages,
      repositoryRoot: index.repoRoot,
    },
  };
}
