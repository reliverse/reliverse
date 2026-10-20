import { readFile } from "node:fs/promises";
import path from "node:path";

import { createRepositoryPolicyIndex } from "@reliverse/repo-index";

import { sortRepositoryPolicyFindings, type RepositoryPolicyReport } from "../shared/model";
import { REPO_RVS_DOMAIN_RULE_IDS } from "./rules";

const canonicalOwners = Object.freeze([
  ["packages/rvs/rvs-core/package.json", "@reliverse/rvs"],
  ["packages/rvs/rvs-control/package.json", "@reliverse/rvs-control"],
  ["packages/rvs/rvs-deployment/package.json", "@reliverse/rvs-deployment"],
  ["packages/rvs/rvs-host/package.json", "@reliverse/rvs-host"],
  ["packages/rvs/rvs-network/package.json", "@reliverse/rvs-network"],
  ["packages/rvs/rvs-private/package.json", "@reliverse/rvs-private"],
  ["packages/rvs/rvs-reconcile/package.json", "@reliverse/rvs-reconcile"],
] as const);

const concreteDependencyToken =
  /(?:adapter-linux|apt-ubuntu|bdi-|caddy|cloudflare|dynadot|ferron|hcloud|mint|openclaw|relivator|stack-|systemd|tailscale|ubuntu|winget|windows)/u;
const fallbackRetiredPackages = Object.freeze([
  "@reliverse/rvs-sdk",
  "@reliverse/rvs-host-protocol",
  "@reliverse/rvs-host-trust",
  "@reliverse/rvs-host-software",
]);

function internalPackageName(specifier: string): string | undefined {
  if (!specifier.startsWith("@")) return undefined;
  const [scope, name] = specifier.split("/");
  return scope && name ? `${scope}/${name}` : undefined;
}

function allDependencyNames(manifest: {
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}): readonly string[] {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }).sort();
}

async function retiredPackageNames(repositoryRoot: string): Promise<readonly string[]> {
  try {
    const matrix = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "docs/specs/rvs/package-domain-disposition-v0.json"),
        "utf8",
      ),
    ) as {
      readonly schemaVersion?: unknown;
      readonly packages?: readonly {
        readonly currentPackage?: unknown;
        readonly disposition?: unknown;
      }[];
    };
    if (matrix.schemaVersion !== "rvs.package-disposition.v0" || !Array.isArray(matrix.packages)) {
      return fallbackRetiredPackages;
    }
    return matrix.packages
      .filter((entry) => ["delete", "merge", "move"].includes(String(entry.disposition)))
      .map((entry) => entry.currentPackage)
      .filter((entry): entry is string => typeof entry === "string")
      .sort();
  } catch {
    return fallbackRetiredPackages;
  }
}

export async function inspectRvsDomainPolicy(
  repositoryRoot: string,
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot, { parseImports: true });
  const findings = [];
  const packagesByManifest = new Map(
    index.workspacePackages.map((entry) => [entry.manifestPath, entry]),
  );

  for (const [manifestPath, expectedName] of canonicalOwners) {
    const entry = packagesByManifest.get(manifestPath);
    if (entry?.manifest.name !== expectedName) {
      findings.push({
        ruleId: REPO_RVS_DOMAIN_RULE_IDS.canonicalOwner,
        path: manifestPath,
        message: `${manifestPath}: expected canonical RVS domain owner ${expectedName}; received ${String(entry?.manifest.name ?? "missing")}`,
        data: { expectedName, actualName: entry?.manifest.name ?? null },
      });
    }
  }

  const coreManifestPath = "packages/rvs/rvs-core/package.json";
  const core = packagesByManifest.get(coreManifestPath);
  if (core) {
    const concrete = new Set(
      allDependencyNames(core.manifest).filter((name) => concreteDependencyToken.test(name)),
    );
    for (const record of index.imports) {
      if (record.ownerManifestPath !== coreManifestPath) continue;
      const name = internalPackageName(record.specifier);
      if (name && concreteDependencyToken.test(name)) concrete.add(name);
    }
    const byName = new Map(index.workspacePackages.map((entry) => [entry.manifest.name, entry]));
    const pending = [...allDependencyNames(core.manifest)];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      if (concreteDependencyToken.test(name)) concrete.add(name);
      const entry = byName.get(name);
      if (entry) pending.push(...allDependencyNames(entry.manifest));
    }
    if (concrete.size > 0) {
      findings.push({
        ruleId: REPO_RVS_DOMAIN_RULE_IDS.coreConcreteDependency,
        path: coreManifestPath,
        message: `@reliverse/rvs depends on concrete environment packages: ${[...concrete].sort().join(", ")}`,
        data: { dependencies: [...concrete].sort() },
      });
    }
  }

  const retired = new Set(await retiredPackageNames(index.repoRoot));
  const violations = new Map<
    string,
    { readonly packageName: string; readonly retired: Set<string> }
  >();
  const recordViolation = (
    manifestPath: string,
    packageName: string,
    retiredName: string,
  ): void => {
    const existing = violations.get(manifestPath);
    if (existing) existing.retired.add(retiredName);
    else violations.set(manifestPath, { packageName, retired: new Set([retiredName]) });
  };
  for (const entry of index.workspacePackages) {
    const packageName = entry.manifest.name ?? "<unnamed-workspace>";
    for (const dependency of allDependencyNames(entry.manifest)) {
      if (retired.has(dependency)) recordViolation(entry.manifestPath, packageName, dependency);
    }
  }
  for (const record of index.imports) {
    const dependency = internalPackageName(record.specifier);
    if (!dependency || !retired.has(dependency) || !record.ownerManifestPath) continue;
    const owner = packagesByManifest.get(record.ownerManifestPath);
    recordViolation(
      record.ownerManifestPath,
      owner?.manifest.name ?? "<unnamed-workspace>",
      dependency,
    );
  }
  for (const [manifestPath, violation] of [...violations].sort(([a], [b]) => a.localeCompare(b))) {
    const retiredNames = [...violation.retired].sort();
    findings.push({
      ruleId: REPO_RVS_DOMAIN_RULE_IDS.retiredPackageConsumer,
      path: manifestPath,
      message: `${violation.packageName} consumes retired RVS package identities: ${retiredNames.join(", ")}`,
      data: { packageName: violation.packageName, retiredPackages: retiredNames },
    });
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      canonicalOwnerCount: canonicalOwners.length,
      repositoryRoot: index.repoRoot,
      retiredPackageCount: retired.size,
    },
  };
}
