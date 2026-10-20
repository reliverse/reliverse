import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { asRecord } from "../shared/static-policy";
import { REPO_DCS_RULE_IDS } from "./rules";

const DCS_HOSTS = Object.freeze([
  { id: "dler", entry: "apps/cli/dler/src/host.ts", provider: "dlerConfigDefinition" },
  { id: "ome", entry: "apps/cli/ome/src/cli.ts", provider: "omeConfigDefinition" },
  { id: "relda", entry: "apps/cli/relda/src/cli.ts", provider: "reldaConfigDefinition" },
  { id: "rewse", entry: "apps/cli/rewse/src/cli.ts", provider: "rewseConfigDefinition" },
  { id: "rq", entry: "apps/cli/rq/src/host.ts", provider: "rqConfigDefinition" },
  { id: "rvs", entry: "apps/cli/rvs/src/cli.ts", provider: "rvsConfigDefinition" },
] as const);

export async function inspectDcsPolicy(repositoryRoot: string): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const inventory = new Set(index.inventory);
  const findings: RepositoryPolicyFinding[] = [];

  for (const host of DCS_HOSTS) {
    const configPath = `apps/cli/${host.id}/src/config.ts`;
    const configSource = inventory.has(configPath) ? await index.readText(configPath) : "";
    const entrySource = inventory.has(host.entry) ? await index.readText(host.entry) : "";
    if (!configSource.includes("defineDcsOwner({")) {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.ownerRegistration,
        path: configPath,
        message: `${configPath}: DCS owner registration is missing`,
      });
    }
    if (!configSource.includes("createDcsHostConfigProvider({")) {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.hostProvider,
        path: configPath,
        message: `${configPath}: generalized DCS host provider is missing`,
      });
    }
    if (!entrySource.includes(`config: ${host.provider}`)) {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.providerMount,
        path: host.entry,
        message: `${host.entry}: CLI host does not mount ${host.provider}`,
      });
    }
  }

  const rseProviderPath = "packages/rse/rse-config/src/provider.ts";
  const rseProvider = inventory.has(rseProviderPath) ? await index.readText(rseProviderPath) : "";
  if (!rseProvider.includes("discoverDcsOwnerConfig({")) {
    findings.push({
      ruleId: REPO_DCS_RULE_IDS.hostProvider,
      path: rseProviderPath,
      message: `${rseProviderPath}: generalized owner discovery is missing`,
    });
  }

  for (const configPath of [
    ".config/rse.json",
    ".config/relda.json",
    ".config/rvs.json",
  ] as const) {
    if (!inventory.has(configPath)) {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.productOwnership,
        path: configPath,
        message: `${configPath}: required DCS document is missing`,
      });
    }
  }

  if (inventory.has(".config/rse.json")) {
    try {
      const rse = asRecord(JSON.parse(await index.readText(".config/rse.json")));
      const plugins = asRecord(rse.plugins);
      for (const product of ["dler", "relda", "rewse"] as const) {
        if (plugins[product] !== undefined) {
          findings.push({
            ruleId: REPO_DCS_RULE_IDS.productOwnership,
            path: ".config/rse.json",
            message: `.config/rse.json: standalone product config must not remain under plugins.${product}`,
          });
        }
      }
      if (rse.ome !== undefined) {
        findings.push({
          ruleId: REPO_DCS_RULE_IDS.productOwnership,
          path: ".config/rse.json",
          message: ".config/rse.json: OME config belongs to the standalone OME DCS document",
        });
      }
    } catch {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.productOwnership,
        path: ".config/rse.json",
        message: ".config/rse.json: DCS document is not valid JSON",
      });
    }
  }

  if (inventory.has(".config/relda.json")) {
    try {
      const relda = asRecord(JSON.parse(await index.readText(".config/relda.json")));
      if (relda.plugins !== undefined) {
        findings.push({
          ruleId: REPO_DCS_RULE_IDS.productOwnership,
          path: ".config/relda.json",
          message: ".config/relda.json: product config must not contain Rse integration namespaces",
        });
      }
    } catch {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.productOwnership,
        path: ".config/relda.json",
        message: ".config/relda.json: DCS document is not valid JSON",
      });
    }
  }

  if (inventory.has(".config/rvs.json")) {
    try {
      const rvs = asRecord(JSON.parse(await index.readText(".config/rvs.json")));
      if (rvs.plugins === undefined) {
        findings.push({
          ruleId: REPO_DCS_RULE_IDS.productOwnership,
          path: ".config/rvs.json",
          message: ".config/rvs.json: RVS plugin config namespaces are missing",
        });
      }
    } catch {
      findings.push({
        ruleId: REPO_DCS_RULE_IDS.productOwnership,
        path: ".config/rvs.json",
        message: ".config/rvs.json: DCS document is not valid JSON",
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: { dcsHosts: DCS_HOSTS.length, repositoryRoot: index.repoRoot },
  };
}
