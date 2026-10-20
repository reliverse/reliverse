import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { REPO_RSE_THIN_HOST_RULE_IDS } from "./rules";

const SPEC_PATH = "docs/specs/arch/rse-thin-host-capability-composition.md";
const RSE_MANIFEST = "apps/cli/rse/package.json";
const RSE_GATEWAY_MANIFEST = "packages/rse/rse-gateway/package.json";
const RSE_GATEWAY_APP_MANIFEST = "apps/gateway/rse/package.json";
const RSE_GATEWAY_APP_ENTRYPOINT = "apps/gateway/rse/src/main.ts";
const RSE_GATEWAY_CATALOG = "packages/rse/rse-gateway/src/capability-catalog.ts";
const RSE_GATEWAY_RUNTIME = "packages/rse/rse-gateway/src/runtime-boundary.ts";
const RSE_GATEWAY_SUPERVISOR = "packages/rse/rse-gateway/src/supervisor.ts";
const RSE_GATEWAY_PROVIDER_PROBE = "packages/rse/rse-gateway/src/providers/openai-direct-probe.ts";
const RSE_GATEWAY_RECOVERY_HEALTH = "packages/rse/rse-gateway/src/recovery-health.ts";
const RSE_APP_BOOTSTRAP = "apps/cli/rse/src/runtime/bootstrap.ts";
const RSE_APP_CONFIG_RUNTIME = "apps/cli/rse/src/config/runtime.ts";
const RSE_APP_DOCTOR_CHECKS = "apps/cli/rse/src/doctor/checks.ts";
const RSE_APP_GATEWAY_CLIENT = "apps/cli/rse/src/runtime/gateway-client.ts";
const RSE_APP_PROVIDER_PROBE = "apps/cli/rse/src/runtime/openai-direct-probe.ts";
function parseImports(source: string): {
  readonly staticImports: string[];
  readonly deferredImports: string[];
} {
  const staticImports = [
    ...source.matchAll(/^import(?:\s+[^"']+\s+from\s+|\s*)["']([^"']+)["'];?/gmu),
  ]
    .map((match) => match[1]!)
    .sort();
  const deferredImports = [...source.matchAll(/\bimport\(["']([^"']+)["']\)/gu)]
    .map((match) => match[1]!)
    .sort();
  return { staticImports, deferredImports };
}

function isForbiddenInferenceCoreDependency(id: string): boolean {
  const forbiddenReliversePackages = [
    "@reliverse/rse-ai-sdk-bridge",
    "@reliverse/rse-ai-sdk-process-cap",
    "@reliverse/codex-rse-plugin",
    "@reliverse/rse-codex-runtime",
  ];
  return (
    id === "ai" ||
    id === "openai" ||
    id === "@google/generative-ai" ||
    id === "@google/genai" ||
    forbiddenReliversePackages.some(
      (packageName) => id === packageName || id.startsWith(`${packageName}/`),
    ) ||
    id.startsWith("@ai-sdk/") ||
    id.startsWith("@anthropic-ai/")
  );
}

type WorkspaceRuntimePackage = {
  readonly manifestPath: string;
  readonly runtimeDependencies: readonly string[];
};

async function inspectWorkspaceRuntimeClosure(
  index: Awaited<ReturnType<typeof createRepositoryPolicyIndex>>,
  roots: readonly string[],
): Promise<{
  readonly packages: readonly string[];
  readonly forbiddenPaths: readonly (readonly string[])[];
}> {
  const workspacePackages = new Map<string, WorkspaceRuntimePackage>();
  for (const workspacePackage of index.workspacePackages) {
    const manifestPath = workspacePackage.manifestPath;
    const manifest = workspacePackage.manifest;
    if (!manifest?.name) continue;
    workspacePackages.set(manifest.name, {
      manifestPath,
      runtimeDependencies: [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ],
    });
  }

  const parent = new Map<string, string | undefined>();
  const queue = [...roots];
  for (const root of roots) parent.set(root, undefined);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const packageName = queue[cursor]!;
    for (const dependency of workspacePackages.get(packageName)?.runtimeDependencies ?? []) {
      if (parent.has(dependency)) continue;
      parent.set(dependency, packageName);
      if (workspacePackages.has(dependency)) queue.push(dependency);
    }
  }

  const forbiddenPaths = [...parent.keys()]
    .filter(isForbiddenInferenceCoreDependency)
    .sort()
    .map((packageName) => {
      const path = [packageName];
      let current = parent.get(packageName);
      while (current) {
        path.unshift(current);
        current = parent.get(current);
      }
      return Object.freeze(path);
    });
  return Object.freeze({
    packages: Object.freeze([...parent.keys()].sort()),
    forbiddenPaths: Object.freeze(forbiddenPaths),
  });
}

export async function inspectRseThinHostPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot, { parseImports: true });
  const inventorySet = new Set(index.inventory);
  const findings: RepositoryPolicyFinding[] = [];

  const spec = inventorySet.has(SPEC_PATH) ? await index.readText(SPEC_PATH) : "";
  for (const required of [
    "`@reliverse/rse-cli` is a Rempts-based product host",
    "A package name or\nnaming glob MUST NOT be the machine authority",
    "deletion-first",
    "`llm=false` / `inference=forbidden` is a normal Rse operating mode",
    "available != installed != compatible != admitted != enabled != loaded != authorized",
  ]) {
    if (!spec.includes(required)) {
      findings.push({
        ruleId: REPO_RSE_THIN_HOST_RULE_IDS.sot,
        path: SPEC_PATH,
        message: `${SPEC_PATH}: thin-host SOT is missing ${JSON.stringify(required)}`,
      });
    }
  }

  const gatewayCatalog = inventorySet.has(RSE_GATEWAY_CATALOG)
    ? await index.readText(RSE_GATEWAY_CATALOG)
    : "";
  const gatewayRuntime = inventorySet.has(RSE_GATEWAY_RUNTIME)
    ? await index.readText(RSE_GATEWAY_RUNTIME)
    : "";
  if (
    !gatewayCatalog.includes("getGatewayOperationContractMetadata") ||
    !gatewayCatalog.includes('availability: input.binding ? "admitted" : "discovered"') ||
    !gatewayRuntime.includes("RSE_CAPABILITY_NOT_ADMITTED") ||
    gatewayRuntime.includes("createRuntimeCapabilityCards")
  ) {
    findings.push({
      ruleId: REPO_RSE_THIN_HOST_RULE_IDS.sot,
      path: RSE_GATEWAY_CATALOG,
      message:
        "Rse Gateway capability discovery must compose canonical contract metadata and admitted bindings without restoring a hardcoded runtime-operation catalog.",
    });
  }

  const appBootstrap = inventorySet.has(RSE_APP_BOOTSTRAP)
    ? await index.readText(RSE_APP_BOOTSTRAP)
    : "";
  const gatewaySupervisor = inventorySet.has(RSE_GATEWAY_SUPERVISOR)
    ? await index.readText(RSE_GATEWAY_SUPERVISOR)
    : "";
  const providerProbe = inventorySet.has(RSE_GATEWAY_PROVIDER_PROBE)
    ? await index.readText(RSE_GATEWAY_PROVIDER_PROBE)
    : "";
  if (
    inventorySet.has(RSE_APP_GATEWAY_CLIENT) ||
    inventorySet.has(RSE_APP_PROVIDER_PROBE) ||
    !appBootstrap.includes("@reliverse/gateway-http-client") ||
    !appBootstrap.includes("ensureRseGatewaySupervisor") ||
    appBootstrap.includes("node:child_process") ||
    !gatewaySupervisor.includes("ensureRseGatewaySupervisor") ||
    providerProbe.includes("/tui/") ||
    providerProbe.includes('from "../../../../apps/cli/rse')
  ) {
    findings.push({
      ruleId: REPO_RSE_THIN_HOST_RULE_IDS.sot,
      path: RSE_APP_BOOTSTRAP,
      message:
        "Rse runtime composition must reuse the canonical Gateway HTTP client and supervisor, while provider acceptance remains outside the CLI and legacy TUI.",
    });
  }

  const doctorChecks = inventorySet.has(RSE_APP_DOCTOR_CHECKS)
    ? await index.readText(RSE_APP_DOCTOR_CHECKS)
    : "";
  const recoveryHealth = inventorySet.has(RSE_GATEWAY_RECOVERY_HEALTH)
    ? await index.readText(RSE_GATEWAY_RECOVERY_HEALTH)
    : "";
  if (
    inventorySet.has(RSE_APP_CONFIG_RUNTIME) ||
    !recoveryHealth.includes("inspectRseGatewayRecoveryHealth") ||
    !doctorChecks.includes("inspectRseGatewayRecoveryHealth") ||
    doctorChecks.includes('from "node:fs') ||
    doctorChecks.includes('"snapshot.json"') ||
    doctorChecks.includes('"lease.json"') ||
    doctorChecks.includes("rse/tui/legacy-provider-probe")
  ) {
    findings.push({
      ruleId: REPO_RSE_THIN_HOST_RULE_IDS.sot,
      path: RSE_APP_DOCTOR_CHECKS,
      message:
        "Rse config projection must remain in @reliverse/rse-config, while runtime Doctor consumes owner-side Gateway recovery inspection and excludes source-layout migration assertions.",
    });
  }

  for (const manifestPath of [RSE_MANIFEST, RSE_GATEWAY_MANIFEST, RSE_GATEWAY_APP_MANIFEST]) {
    if (!inventorySet.has(manifestPath)) continue;
    const coreManifest = JSON.parse(await index.readText(manifestPath)) as {
      readonly dependencies?: Readonly<Record<string, string>>;
    };
    for (const dependency of Object.keys(coreManifest.dependencies ?? {})) {
      if (!isForbiddenInferenceCoreDependency(dependency)) continue;
      findings.push({
        ruleId: REPO_RSE_THIN_HOST_RULE_IDS.zeroIntelligenceCore,
        path: manifestPath,
        message: `${manifestPath}: direct inference/provider dependency ${dependency} violates the zero-intelligence core boundary`,
        data: { dependency },
      });
    }
  }

  if (inventorySet.has(RSE_GATEWAY_APP_ENTRYPOINT)) {
    const gatewayAppSource = await index.readText(RSE_GATEWAY_APP_ENTRYPOINT);
    const gatewayImports = parseImports(gatewayAppSource);
    for (const specifier of [...gatewayImports.staticImports, ...gatewayImports.deferredImports]) {
      if (!isForbiddenInferenceCoreDependency(specifier)) continue;
      findings.push({
        ruleId: REPO_RSE_THIN_HOST_RULE_IDS.zeroIntelligenceCore,
        path: RSE_GATEWAY_APP_ENTRYPOINT,
        message: `${RSE_GATEWAY_APP_ENTRYPOINT}: direct inference/provider import ${specifier} violates the zero-intelligence core boundary`,
        data: { specifier },
      });
    }
  }

  const roots = [RSE_MANIFEST, RSE_GATEWAY_MANIFEST, RSE_GATEWAY_APP_MANIFEST]
    .map(
      (manifestPath) =>
        index.workspacePackages.find((entry) => entry.manifestPath === manifestPath)?.manifest.name,
    )
    .filter((name): name is string => Boolean(name));
  const zeroIntelligence = await inspectWorkspaceRuntimeClosure(index, roots);
  const zeroIntelligencePackages = new Set(zeroIntelligence.packages);
  const packageNameByManifest = new Map(
    index.workspacePackages.map((entry) => [entry.manifestPath, entry.manifest.name]),
  );
  for (const imported of index.imports) {
    const ownerPackage = imported.ownerManifestPath
      ? packageNameByManifest.get(imported.ownerManifestPath)
      : undefined;
    if (
      imported.kind !== "runtime" ||
      imported.mode !== "runtime" ||
      !ownerPackage ||
      !zeroIntelligencePackages.has(ownerPackage) ||
      !isForbiddenInferenceCoreDependency(imported.specifier)
    ) {
      continue;
    }
    findings.push({
      ruleId: REPO_RSE_THIN_HOST_RULE_IDS.zeroIntelligenceCore,
      path: imported.importer,
      message: `${imported.importer}: ${ownerPackage} runtime source imports optional intelligence package ${imported.specifier}`,
      data: { dependency: imported.specifier, ownerPackage },
    });
  }
  for (const dependencyPath of zeroIntelligence.forbiddenPaths) {
    const dependency = dependencyPath.at(-1)!;
    findings.push({
      ruleId: REPO_RSE_THIN_HOST_RULE_IDS.zeroIntelligenceCore,
      path: RSE_MANIFEST,
      message: `zero-intelligence runtime closure contains ${dependency} through ${dependencyPath.join(" -> ")}`,
      data: { dependency, dependencyPath },
    });
  }
  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      zeroIntelligenceRuntimePackages: zeroIntelligence.packages.length,
      repositoryRoot: index.repoRoot,
    },
  };
}
