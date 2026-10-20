import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import { REPOSITORY_CLI_HOSTS } from "../cli/policy";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import {
  findCalls,
  hasDefaultExport,
  hasOwn,
  hasPropertyInCall,
  relativeImportResolves,
} from "../shared/static-policy";
import { REPO_REMPTS_RULE_IDS } from "./rules";

const RELATIVE_IMPORT_PATTERN = /(?:from\s*|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/gu;

function commandModules(inventory: readonly string[], root: string): readonly string[] {
  return inventory.filter(
    (file) => file.startsWith(`${root}/`) && /(?:^|\/)cmd\.(?:js|ts)$/u.test(file),
  );
}

const DIRECT_TERMINAL_INPUT_PATTERN =
  /(?:process\.stdin|readline\.(?:createInterface|emitKeypressEvents)|createInterface\s*\(|\.setRawMode\s*\()/u;

function inspectInteractiveSurfaceOwnership(
  findings: RepositoryPolicyFinding[],
  modulePath: string,
  source: string,
): void {
  if (!DIRECT_TERMINAL_INPUT_PATTERN.test(source)) return;
  findings.push({
    ruleId: REPO_REMPTS_RULE_IDS.interactiveSurfaceOwnership,
    path: modulePath,
    message: `${modulePath}: Rempts command modules must use ctx.prompt primitives instead of direct terminal input mechanics`,
  });
}

function hasCommandMount(calls: readonly string[]): boolean {
  return calls.some((call) => /(?:^|[,{]\s*)commands\s*:\s*\{\s*mount\s*:/u.test(call));
}

export async function inspectRemptsPolicy(repositoryRoot: string): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const inventory = new Set(index.inventory);
  const pluginPackages = index.packages.filter((entry) =>
    /^extensions\/plugins\/rse\/[^/]+$/u.test(entry.directory),
  );
  let inspectedPlugins = 0;
  let inspectedCommands = 0;

  for (const plugin of pluginPackages) {
    const entryPath = `${plugin.directory}/src/index.ts`;
    if (!inventory.has(entryPath)) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.pluginEntrypoint,
        path: entryPath,
        message: `${entryPath}: Rse plugin entrypoint is missing`,
      });
      continue;
    }
    const source = await index.readText(entryPath);
    if (!source.includes("definePlugin(")) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.pluginEntrypoint,
        path: entryPath,
        message: `${entryPath}: Rse plugin entrypoint must declare definePlugin`,
      });
      continue;
    }
    inspectedPlugins += 1;
    const calls = findCalls(source, "definePlugin(");
    const commandRoot = `${plugin.directory}/src/cmds`;
    const commands = commandModules(index.inventory, commandRoot);

    if (calls.length !== 1) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.pluginEntrypoint,
        path: entryPath,
        message: `${entryPath}: expected exactly one definePlugin declaration; received ${calls.length}`,
      });
    }
    if (plugin.manifest.bin !== undefined || hasOwn(plugin.manifest.exports, "./cli")) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.pluginSurface,
        path: plugin.manifestPath,
        message: `${plugin.manifestPath}: Rse plugin must not expose bin or ./cli surfaces`,
      });
    }
    const commandMount = hasCommandMount(calls);
    if ((commands.length > 0 || hasPropertyInCall(calls, "root")) && !commandMount) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.pluginMount,
        path: entryPath,
        message: `${entryPath}: definePlugin must declare commands.mount`,
      });
    }
    if (hasPropertyInCall(calls, "commands") && !commandMount) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.fileDiscovery,
        path: entryPath,
        message: `${entryPath}: legacy manual commands registration is retired`,
      });
    }

    for (const rootCommand of [`${commandRoot}/cmd.ts`, `${commandRoot}/cmd.js`]) {
      if (inventory.has(rootCommand)) {
        findings.push({
          ruleId: REPO_REMPTS_RULE_IDS.fileDiscovery,
          path: rootCommand,
          message: `${rootCommand}: plugin root commands belong in definePlugin({ root })`,
        });
      }
    }

    inspectedCommands += commands.length;
    for (const modulePath of commands) {
      const commandSource = await index.readText(modulePath);
      if (!hasDefaultExport(commandSource)) {
        findings.push({
          ruleId: REPO_REMPTS_RULE_IDS.commandExport,
          path: modulePath,
          message: `${modulePath}: file-discovered command must provide a default export`,
        });
      }
      inspectInteractiveSurfaceOwnership(findings, modulePath, commandSource);
    }

    for (const modulePath of index.sourceFiles.filter(
      (file) => file.startsWith(`${plugin.directory}/src/`) && !file.includes(".test."),
    )) {
      const moduleSource = await index.readText(modulePath);
      RELATIVE_IMPORT_PATTERN.lastIndex = 0;
      for (const match of moduleSource.matchAll(RELATIVE_IMPORT_PATTERN)) {
        const specifier = match[2];
        if (specifier && !relativeImportResolves(index, modulePath, specifier)) {
          findings.push({
            ruleId: REPO_REMPTS_RULE_IDS.relativeImport,
            path: modulePath,
            message: `${modulePath}: unresolved relative import ${JSON.stringify(specifier)}`,
          });
        }
      }
    }
  }

  for (const host of REPOSITORY_CLI_HOSTS) {
    const root = `apps/cli/${host.directory}/src`;
    const entryPath = `${root}/cli.ts`;
    const hostPath =
      host.directory === "dler" || host.directory === "rq" ? `${root}/host.ts` : entryPath;
    if (!inventory.has(entryPath) || !inventory.has(hostPath)) continue;
    const [entrySource, hostSource] = await Promise.all([
      index.readText(entryPath),
      index.readText(hostPath),
    ]);
    const calls = findCalls(hostSource, "defineCLI(");
    if (calls.length !== 1 || entrySource.includes("definePlugin(")) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.cliHost,
        path: hostPath,
        message: `${hostPath}: expected one defineCLI declaration and no CLI-local definePlugin declaration`,
      });
    }
    if (hasPropertyInCall(calls, "commands")) {
      findings.push({
        ruleId: REPO_REMPTS_RULE_IDS.fileDiscovery,
        path: hostPath,
        message: `${hostPath}: manual commands registration is retired`,
      });
    }
    const commands = commandModules(index.inventory, `${root}/cmds`);
    inspectedCommands += commands.length;
    for (const modulePath of commands) {
      const commandSource = await index.readText(modulePath);
      if (!hasDefaultExport(commandSource)) {
        findings.push({
          ruleId: REPO_REMPTS_RULE_IDS.commandExport,
          path: modulePath,
          message: `${modulePath}: file-discovered command must provide a default export`,
        });
      }
      inspectInteractiveSurfaceOwnership(findings, modulePath, commandSource);
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { inspectedCommands, inspectedPlugins, repositoryRoot: index.repoRoot },
  };
}
