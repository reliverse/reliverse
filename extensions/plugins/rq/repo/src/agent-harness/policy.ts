import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_AGENT_HARNESS_RULE_IDS } from "./rules";

export async function inspectAgentHarnessPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot);
  const findings: RepositoryPolicyFinding[] = [];
  const read = async (file: string) => (index.inventory.includes(file) ? index.readText(file) : "");

  const protocolPath = "packages/rse/rse-protocol/src/context-assembly.ts";
  const protocol = await read(protocolPath);
  if (!protocol.includes("RSE_CONTEXT_ITEM_DEFAULT_TOKEN_LIMIT = 10_000")) {
    findings.push({
      ruleId: REPO_AGENT_HARNESS_RULE_IDS.boundedOutput,
      path: protocolPath,
      message: `${protocolPath}: the canonical 10,000-token model-visible default is missing`,
    });
  }

  const assemblyPath = "packages/rse/rse-gateway/src/context-assembly.ts";
  const assembly = await read(assemblyPath);
  if (
    !assembly.includes("sortRseGatewayCapabilityCards") ||
    !assembly.includes("toolCatalogDigest")
  ) {
    findings.push({
      ruleId: REPO_AGENT_HARNESS_RULE_IDS.deterministicCatalog,
      path: assemblyPath,
      message: `${assemblyPath}: deterministic capability ordering or catalog digesting is missing`,
    });
  }
  if (!assembly.includes("runtimePolicyDigest") || !assembly.includes("prefixDigest")) {
    findings.push({
      ruleId: REPO_AGENT_HARNESS_RULE_IDS.runtimePolicyIsolation,
      path: assemblyPath,
      message: `${assemblyPath}: static prefix and runtime policy digests are not independently retained`,
    });
  }
  if (
    !assembly.includes("without an artifact writer") ||
    !assembly.includes("artifactWriter.write")
  ) {
    findings.push({
      ruleId: REPO_AGENT_HARNESS_RULE_IDS.durableOverflow,
      path: assemblyPath,
      message: `${assemblyPath}: oversized context does not fail closed into durable overflow`,
    });
  }

  const runtimePath = "packages/rse/rse-gateway/src/context-runtime.ts";
  const runtime = await read(runtimePath);
  if (
    !runtime.includes("createRseGatewayFilesystemContextArtifactWriter") ||
    !runtime.includes("writeRseGatewayContextAssemblyReceipt")
  ) {
    findings.push({
      ruleId: REPO_AGENT_HARNESS_RULE_IDS.durableOverflow,
      path: runtimePath,
      message: `${runtimePath}: filesystem-backed context artifacts or epoch receipts are missing`,
    });
  }

  const boundaryPath = "packages/rse/rse-gateway/src/runtime-boundary.ts";
  const boundary = await read(boundaryPath);
  for (const required of [
    "rse.context.inspect",
    "rse.context.diff",
    "rse.context.cache.explain",
    "assembleRseGatewayContext",
    "writeRseGatewayContextAssemblyReceipt",
  ]) {
    if (!boundary.includes(required)) {
      findings.push({
        ruleId: REPO_AGENT_HARNESS_RULE_IDS.runtimeIntegration,
        path: boundaryPath,
        message: `${boundaryPath}: runtime integration is missing ${JSON.stringify(required)}`,
      });
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      checkedFiles: [protocolPath, assemblyPath, runtimePath, boundaryPath],
      mode: "deterministic-source-ratchet",
    },
  };
}
