import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asRecord, asStringRecord } from "../shared/static-policy";
import { REPO_TOOL_BRIDGE_RULE_IDS } from "./rules";

const TRANSITIONAL_PROXIES = Object.freeze([
  { id: "dler", heavy: ["@reliverse/dler-cli"] },
  {
    id: "relda",
    heavy: ["@reliverse/relda-runtime", "@reliverse/relda-adapters", "@reliverse/relda"],
  },
  { id: "rewse", heavy: ["@reliverse/rewse", "@reliverse/artifacts"] },
] as const);

function importsPackage(source: string, packageName: string): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escaped}(?:/|[\"'])`, "u").test(source);
}

async function readJson(
  readText: (path: string) => Promise<string>,
  file: string,
): Promise<Readonly<Record<string, unknown>>> {
  try {
    return asRecord(JSON.parse(await readText(file)));
  } catch {
    return {};
  }
}

export async function inspectToolBridgePolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const findings: RepositoryPolicyFinding[] = [];

  const bridgePath = "packages/rempts/src/runtime/tool-bridge-process.ts";
  const bridgeSource = inventory.has(bridgePath) ? await index.readText(bridgePath) : "";
  if (!bridgeSource.includes("shell: false") || !bridgeSource.includes("JSON.stringify(request)")) {
    findings.push({
      ruleId: REPO_TOOL_BRIDGE_RULE_IDS.structuredTransport,
      path: bridgePath,
      message: `${bridgePath}: process bridge must disable shell execution and send a structured JSON request`,
    });
  }

  for (const proxy of TRANSITIONAL_PROXIES) {
    const directory = `extensions/plugins/rse/${proxy.id}`;
    const manifestPath = `${directory}/package.json`;
    if (!inventory.has(manifestPath)) continue;
    const manifest = index.packages.find((entry) => entry.manifestPath === manifestPath)?.manifest;
    const dependencies = asStringRecord(manifest?.dependencies);
    const expectedProtocol = `@reliverse/${proxy.id}-protocol`;
    for (const dependency of proxy.heavy) {
      if (dependencies[dependency] !== undefined) {
        findings.push({
          ruleId: REPO_TOOL_BRIDGE_RULE_IDS.runtimeIsolation,
          path: manifestPath,
          message: `${manifestPath}: transitional proxy must not depend on heavy runtime ${dependency}`,
        });
      }
    }
    if (
      dependencies[expectedProtocol] !== "workspace:*" ||
      dependencies["@reliverse/rempts"] !== "workspace:*"
    ) {
      findings.push({
        ruleId: REPO_TOOL_BRIDGE_RULE_IDS.runtimeIsolation,
        path: manifestPath,
        message: `${manifestPath}: transitional proxy must depend on ${expectedProtocol} and @reliverse/rempts through workspace:*`,
      });
    }

    for (const sourcePath of index.sourceFiles.filter(
      (file) => file.startsWith(`${directory}/src/`) && !file.includes(".test."),
    )) {
      const source = await index.readText(sourcePath);
      for (const dependency of proxy.heavy) {
        if (importsPackage(source, dependency)) {
          findings.push({
            ruleId: REPO_TOOL_BRIDGE_RULE_IDS.runtimeIsolation,
            path: sourcePath,
            message: `${sourcePath}: transitional proxy imports heavy runtime ${dependency}`,
          });
        }
      }
      if (/Bun\.spawn|node:child_process|execFile\s*\(|\bexec\s*\(/u.test(source)) {
        findings.push({
          ruleId: REPO_TOOL_BRIDGE_RULE_IDS.runtimeIsolation,
          path: sourcePath,
          message: `${sourcePath}: transitional proxy bypasses structured Rempts transport`,
        });
      }
    }

    const descriptorPath = `apps/cli/${proxy.id}/${proxy.id}-tool.json`;
    if (inventory.has(descriptorPath)) {
      const descriptor = await readJson(index.readText, descriptorPath);
      if (descriptor.entry !== "dist/bridge.js") {
        findings.push({
          ruleId: REPO_TOOL_BRIDGE_RULE_IDS.artifactEntry,
          path: descriptorPath,
          message: `${descriptorPath}: entry must be dist/bridge.js`,
        });
      }
    }
  }

  if (inventory.has(".config/rse.json")) {
    const rse = await readJson(index.readText, ".config/rse.json");
    const plugins = asRecord(rse.plugins);
    for (const product of ["dler", "relda", "rewse"] as const) {
      if (plugins[product] !== undefined) {
        findings.push({
          ruleId: REPO_TOOL_BRIDGE_RULE_IDS.productConfig,
          path: ".config/rse.json",
          message: `.config/rse.json: standalone product config must not remain under plugins.${product}`,
        });
      }
    }
    if (rse.ome !== undefined) {
      findings.push({
        ruleId: REPO_TOOL_BRIDGE_RULE_IDS.productConfig,
        path: ".config/rse.json",
        message: ".config/rse.json: legacy OME product config must not remain in Rse",
      });
    }
  }

  for (const schemaPath of [".config/schema/rse.json", ".config/rse.schema.json"] as const) {
    if (!inventory.has(schemaPath)) continue;
    const schema = await readJson(index.readText, schemaPath);
    const properties = asRecord(schema.properties);
    const pluginProperties = asRecord(asRecord(properties.plugins).properties);
    for (const product of ["dler", "relda", "rewse"] as const) {
      if (pluginProperties[product] !== undefined) {
        findings.push({
          ruleId: REPO_TOOL_BRIDGE_RULE_IDS.productConfig,
          path: schemaPath,
          message: `${schemaPath}: must not define plugins.${product}`,
        });
      }
    }
    if (properties.ome !== undefined) {
      findings.push({
        ruleId: REPO_TOOL_BRIDGE_RULE_IDS.productConfig,
        path: schemaPath,
        message: `${schemaPath}: must not define legacy OME product config`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { repositoryRoot: index.repoRoot, transitionalProxies: TRANSITIONAL_PROXIES.length },
  };
}
