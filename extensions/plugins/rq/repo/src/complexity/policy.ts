import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type { RepoRqComplexityConfig } from "../config";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_COMPLEXITY_RULE_IDS } from "./rules";

const COMMAND_CONTEXT_FIELD_BUDGET = 28;

function boundaryData(input: {
  authority: string;
  userCost: string;
  simplerBoundary: string;
  confidence?: "high" | "medium";
}): Readonly<Record<string, string>> {
  return Object.freeze({ confidence: input.confidence ?? "high", ...input });
}

async function integrationAdapterPaths(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && /^(?:adapter|bridge)\.ts$/u.test(entry.name))
        result.push(entryPath);
    }
  }
  await visit(path.join(root, "extensions", "plugins"));
  return Object.freeze(result.sort());
}

type PackageJson = Readonly<{
  name?: unknown;
  scripts?: unknown;
}>;

async function readJson(filePath: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function scriptEntries(value: unknown): readonly Readonly<{ name: string; command: string }>[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, command]) => Object.freeze({ name, command }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

function isAutomationScript(name: string): boolean {
  return /(?:^|:)(?:ci|deploy|deployment|locked|prod|production|release|verify)(?::|$)/u.test(name);
}

export async function inspectComplexityPolicy(
  repositoryRoot: string,
  config: RepoRqComplexityConfig,
): Promise<RepositoryPolicyReport> {
  const findings: RepositoryPolicyFinding[] = [];
  const rootManifestPath = path.join(repositoryRoot, "package.json");
  const rootManifest = await readJson(rootManifestPath);
  const scripts = scriptEntries(rootManifest?.scripts);

  if (scripts.length > config.maxRootScripts) {
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.rootScriptBudget,
      path: "package.json",
      severity: config.rootScriptBudgetSeverity,
      message: `package.json exposes ${scripts.length} root scripts; indie-first budget is ${config.maxRootScripts}`,
      data: {
        ...boundaryData({
          authority: "typed product CLIs",
          userCost:
            "A large root menu hides the canonical workflow and increases documentation drift.",
          simplerBoundary:
            "Keep common root commands only; route specialist work through its owning CLI.",
        }),
        profile: config.profile,
        scripts: scripts.length,
        maxRootScripts: config.maxRootScripts,
      },
    });
  }

  const scriptsByCommand = new Map<string, string[]>();
  for (const script of scripts) {
    const normalizedCommand = script.command.trim().replace(/\s+/gu, " ");
    const aliases = scriptsByCommand.get(normalizedCommand) ?? [];
    aliases.push(script.name);
    scriptsByCommand.set(normalizedCommand, aliases);

    if (/(?:^|\s)(?:bash|sh)\s+-c(?:\s|$)|(?:^|[;&|]\s*)eval(?:\s|$)/u.test(script.command)) {
      findings.push({
        ruleId: REPO_COMPLEXITY_RULE_IDS.hiddenExecution,
        path: "package.json",
        severity: "warning",
        message: `root script ${script.name} hides execution behind a shell evaluator`,
        data: boundaryData({
          authority: script.name,
          userCost:
            "The real executable and argv boundary are obscured, so preview and audit output are less trustworthy.",
          simplerBoundary:
            "Invoke one typed CLI directly and pass structured argv without sh -c, bash -c, or eval.",
        }),
      });
    }
    if (
      /--frozen-lockfile\b/u.test(script.command) &&
      !isAutomationScript(script.name) &&
      /(?:^|:)(?:bootstrap|dev|fresh|install|latest)(?::|$)/u.test(script.name)
    ) {
      findings.push({
        ruleId: REPO_COMPLEXITY_RULE_IDS.frozenDevelopmentInstall,
        path: "package.json",
        severity: "warning",
        message: `developer-facing script ${script.name} uses --frozen-lockfile`,
        data: {
          ...boundaryData({
            authority: script.name,
            userCost:
              "Everyday local setup becomes brittle without adding automation-grade confidence.",
            simplerBoundary:
              "Reserve frozen installs for named CI, release, deploy, or verify workflows.",
          }),
          script: script.name,
        },
      });
    }
  }

  for (const [command, names] of scriptsByCommand) {
    if (names.length < 2) continue;
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.duplicateEntrypoint,
      path: "package.json",
      severity: "warning",
      message: `root scripts ${names.join(", ")} expose the same command`,
      data: {
        ...boundaryData({
          authority: names[0] ?? "root script",
          userCost:
            "Multiple names for one workflow split documentation and make the canonical entrypoint unclear.",
          simplerBoundary:
            "Keep one memorable root name and route variants through the owning typed CLI.",
        }),
        command,
        scripts: names,
      },
    });
  }

  const fsgRuntimePath = path.join(repositoryRoot, "apps", "cli", "rse", "src", "action", "fsg.ts");
  const fsgRuntime = await readFile(fsgRuntimePath, "utf8").catch(() => undefined);
  if (
    fsgRuntime !== undefined &&
    (/dler-build|static-artifact\.build|deployment/iu.test(fsgRuntime) ||
      fsgRuntime.split(/\r?\n/u).length > 500)
  ) {
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.fsgOwnershipBlur,
      path: "apps/cli/rse/src/action/fsg.ts",
      severity: "error",
      message: "FSG module contains Action Plane build, Git, or deployment orchestration",
      data: boundaryData({
        authority: "Rse Action Plane",
        userCost:
          "Filesystem routing becomes a second workflow orchestrator and obscures which layer grants product authority.",
        simplerBoundary:
          "Keep mixed workflow execution in Action Plane modules and reserve FSG for scoped path policy, routing, and evidence.",
      }),
    });
  }

  const remptsToolStorePath = path.join(
    repositoryRoot,
    "packages",
    "rempts",
    "src",
    "runtime",
    "tool-store.ts",
  );
  const remptsToolStore = await readFile(remptsToolStorePath, "utf8").catch(() => undefined);
  if (remptsToolStore !== undefined) {
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.ownershipBlur,
      path: "packages/rempts/src/runtime/tool-store.ts",
      severity: "error",
      message: "Rempts contains generic tool installation and activation logic",
      data: boundaryData({
        authority: "@reliverse/toolchain",
        userCost:
          "Two lifecycle owners can disagree about integrity, activation, rollback, and receipts.",
        simplerBoundary:
          "Keep Rempts on command runtime contracts and move generic tool storage to @reliverse/toolchain.",
      }),
    });
  }

  const commandContextPath = path.join(
    repositoryRoot,
    "packages",
    "rempts",
    "src",
    "api",
    "define-command.ts",
  );
  const commandContextSource = await readFile(commandContextPath, "utf8").catch(() => "");
  const commandContextBody =
    /export interface CommandContext[^\{]*\{(?<body>[\s\S]*?)\n\}/u.exec(commandContextSource)
      ?.groups?.body ?? "";
  const commandContextFields = [...commandContextBody.matchAll(/^\s*readonly\s+\w+/gmu)].length;
  if (commandContextFields > COMMAND_CONTEXT_FIELD_BUDGET) {
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.commandContextBudget,
      path: "packages/rempts/src/api/define-command.ts",
      severity: "warning",
      message: `CommandContext exposes ${commandContextFields} fields; boundary budget is ${COMMAND_CONTEXT_FIELD_BUDGET}`,
      data: {
        ...boundaryData({
          authority: "Rempts command capability context",
          userCost:
            "Every added field couples all commands and hosts to a larger framework surface.",
          simplerBoundary:
            "Group admitted effects behind narrow clients and leave product services in their owner.",
          confidence: "medium",
        }),
        fields: commandContextFields,
        budget: COMMAND_CONTEXT_FIELD_BUDGET,
      },
    });
  }

  for (const adapterPath of await integrationAdapterPaths(repositoryRoot)) {
    const source = await readFile(adapterPath, "utf8");
    const lines = source.split(/\r?\n/u).length;
    const exports = [
      ...source.matchAll(/^export\s+(?:async\s+)?(?:class|const|function|interface|type)\s+/gmu),
    ].length;
    if (lines < 250 || exports < 8) continue;
    const relativePath = path.relative(repositoryRoot, adapterPath).replaceAll("\\", "/");
    findings.push({
      ruleId: REPO_COMPLEXITY_RULE_IDS.frameworkLikeAdapter,
      path: relativePath,
      severity: "warning",
      message: `integration adapter has ${lines} lines and ${exports} exported surfaces`,
      data: {
        ...boundaryData({
          authority: relativePath,
          userCost:
            "Reusable policy hidden in an adapter creates a second implementation to learn and debug.",
          simplerBoundary:
            "Extract reusable policy to its package owner and retain typed translation only.",
          confidence: "medium",
        }),
        lines,
        exports,
      },
    });
  }

  return Object.freeze({
    findings: sortRepositoryPolicyFindings(findings),
    metadata: Object.freeze({
      maxRootScripts: config.maxRootScripts,
      profile: config.profile,
      rootScripts: scripts.length,
    }),
  });
}
