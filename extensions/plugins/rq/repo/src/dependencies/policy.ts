import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  evaluateMinimumVersionPolicy,
  parseBunLockDependencyEntries,
  resolveDependencyReference,
  type DependencySection,
  type PackageManifest,
} from "@reliverse/dependency-update";
import {
  createRepositoryPolicyIndex,
  type RepositoryPolicyIndex,
  type RepositoryPolicyManifest,
  type RepositoryPolicyPackage,
} from "@reliverse/repo-index";

import type { RepoRqDependencyToolPolicy, RepoRqModuleCycleException } from "../config";
import {
  sortRepositoryPolicyFindings,
  type RepositoryPolicyFinding,
  type RepositoryPolicyReport,
} from "../shared/model";
import { isGeneratedRemptsProfilePath } from "../shared/static-policy";
import { REPO_DEPENDENCY_RULE_IDS } from "./rules";

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as import("@reliverse/quality").JsonValue;
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function runtimeDependencies(
  manifest: RepositoryPolicyManifest,
): Readonly<Record<string, unknown>> {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
}

function packageName(entry: RepositoryPolicyPackage): string | undefined {
  return typeof entry.manifest.name === "string" ? entry.manifest.name : undefined;
}

function stronglyConnectedComponents(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): readonly (readonly string[])[] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowlinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const dependency of [...(graph.get(node) ?? [])].sort()) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowlinks.set(node, Math.min(lowlinks.get(node)!, lowlinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowlinks.set(node, Math.min(lowlinks.get(node)!, indices.get(dependency)!));
      }
    }
    if (lowlinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (true) {
      const member = stack.pop();
      if (!member) throw new Error("workspace dependency cycle stack underflow");
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    if (component.length > 1 || (graph.get(node)?.has(node) ?? false))
      cycles.push(component.sort());
  };

  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node);
  return cycles.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function canonicalCyclePath(
  component: readonly string[],
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const members = new Set(component);
  const start = [...component].sort()[0];
  if (!start) return [];
  if (graph.get(start)?.has(start)) return [start, start];

  const visit = (node: string, path: readonly string[]): readonly string[] | undefined => {
    for (const dependency of [...(graph.get(node) ?? [])]
      .filter((candidate) => members.has(candidate))
      .sort()) {
      if (dependency === start) return [...path, start];
      if (path.includes(dependency)) continue;
      const result = visit(dependency, [...path, dependency]);
      if (result) return result;
    }
    return undefined;
  };
  return visit(start, [start]) ?? [...component, start];
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

function graphWithNodes(nodes: readonly string[]): Map<string, Set<string>> {
  return new Map([...nodes].sort().map((node) => [node, new Set<string>()]));
}

function addGraphEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  graph.get(from)?.add(to);
}

function moduleCycleExceptionMatches(
  exception: RepoRqModuleCycleException,
  packageNameValue: string,
  files: readonly string[],
): boolean {
  return (
    exception.packageName === packageNameValue &&
    [...exception.files].sort().join("\0") === [...files].sort().join("\0")
  );
}

/** Only explicit, literal publication boundaries can prove scripts are development-only. */
function developmentScriptFiles(index: RepositoryPolicyIndex): ReadonlySet<string> {
  const candidates = new Set<string>();
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  };
  for (const owner of index.workspacePackages) {
    const manifest = owner.manifest as RepositoryPolicyManifest & {
      files?: unknown;
      main?: unknown;
      module?: unknown;
    };
    const files = manifest.files;
    if (
      !Array.isArray(files) ||
      files.length === 0 ||
      files.some(
        (file) =>
          typeof file !== "string" ||
          /[!*?\[\]{}]/u.test(file) ||
          [".", "./", ""].includes(file) ||
          file.startsWith("/") ||
          file.split("/").includes("..") ||
          file.replace(/^\.\//u, "").startsWith("scripts"),
      )
    )
      continue;
    const entries = strings([manifest.exports, manifest.bin, manifest.main, manifest.module]);
    if (entries.some((entry) => path.posix.normalize(entry).startsWith("scripts/"))) continue;
    for (const file of index.sourceFiles) {
      if (file.startsWith(`${owner.directory}/scripts/`)) candidates.add(file);
    }
  }
  // A source import (including a type import) promotes scripts back to production.
  const graph = new Map<string, string[]>();
  const pending = new Set<string>();
  for (const record of index.imports) {
    if (record.kind !== "runtime") continue;
    if (!candidates.has(record.importer)) pending.add(record.importer);
    let specifier = record.specifier;
    if (!isRelativeSpecifier(specifier)) {
      const name = packageNameFromSpecifier(specifier);
      const owner = index.workspacePackages.find((entry) => entry.manifest.name === name);
      const subpath = specifier.slice(name.length + 1);
      if (!owner || !specifier.startsWith(`${name}/`) || !subpath.startsWith("scripts/")) continue;
      specifier = `./${path.posix.relative(path.posix.dirname(record.importer), path.posix.join(owner.directory, subpath))}`;
    }
    const target = index.resolveRelativeImport(record.importer, specifier);
    if (target) graph.set(record.importer, [...(graph.get(record.importer) ?? []), target]);
  }
  const seen = new Set<string>();
  const queue = [...pending];
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    if (seen.has(file)) continue;
    seen.add(file);
    candidates.delete(file);
    queue.push(...(graph.get(file) ?? []));
  }
  return candidates;
}

export async function inspectDependencyPolicy(
  repositoryRoot: string,
  options: {
    readonly moduleCycleExceptions?: readonly RepoRqModuleCycleException[] | undefined;
    readonly tools?: readonly RepoRqDependencyToolPolicy[] | undefined;
  } = {},
): Promise<RepositoryPolicyReport> {
  const index = await createRepositoryPolicyIndex(repositoryRoot, { parseImports: true });
  const owners = [index.rootPackage, ...index.workspacePackages];
  const ownerByManifest = new Map(owners.map((entry) => [entry.manifestPath, entry]));
  const workspaceByName = new Map(
    index.workspacePackages
      .map((entry) => [packageName(entry), entry] as const)
      .filter(
        (entry): entry is readonly [string, RepositoryPolicyPackage] => entry[0] !== undefined,
      ),
  );
  const usages = new Map<
    string,
    Map<
      string,
      { execution: Set<string>; runtime: Set<string>; test: Set<string>; development: Set<string> }
    >
  >();
  const findings: RepositoryPolicyFinding[] = [];
  const reportedSelfRuntimeImports = new Set<string>();
  const unknownImports = new Map<string, Set<string>>();

  const developmentFiles = developmentScriptFiles(index);
  for (const record of index.imports) {
    if (isGeneratedRemptsProfilePath(record.importer)) continue;
    const kind = developmentFiles.has(record.importer) ? "development" : record.kind;
    const owner = record.ownerManifestPath
      ? ownerByManifest.get(record.ownerManifestPath)
      : undefined;
    if (!owner) continue;
    const dependencyName = packageNameFromSpecifier(record.specifier);
    const ownerName = packageName(owner);
    if (!workspaceByName.has(dependencyName)) {
      if (dependencyName.startsWith("@reliverse/")) {
        const names = unknownImports.get(record.importer) ?? new Set<string>();
        names.add(dependencyName);
        unknownImports.set(record.importer, names);
      }
      continue;
    }
    if (dependencyName === ownerName) {
      if (
        record.specifier === ownerName &&
        kind === "runtime" &&
        record.mode === "runtime" &&
        !reportedSelfRuntimeImports.has(record.importer)
      ) {
        reportedSelfRuntimeImports.add(record.importer);
        findings.push({
          ruleId: REPO_DEPENDENCY_RULE_IDS.selfRuntimeImport,
          path: record.importer,
          message: `workspace package ${ownerName} imports its own package entrypoint from production source (${record.importer})`,
          data: { packageName: ownerName },
        });
      }
      continue;
    }
    let ownerUsages = usages.get(owner.manifestPath);
    if (!ownerUsages) {
      ownerUsages = new Map();
      usages.set(owner.manifestPath, ownerUsages);
    }
    const usage = ownerUsages.get(dependencyName) ?? {
      execution: new Set<string>(),
      runtime: new Set<string>(),
      test: new Set<string>(),
      development: new Set<string>(),
    };
    usage[kind].add(record.importer);
    if (kind === "runtime" && record.mode === "runtime") {
      usage.execution.add(record.importer);
    }
    ownerUsages.set(dependencyName, usage);
  }

  for (const [importer, dependencies] of [...unknownImports].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const names = [...dependencies].sort();
    findings.push({
      ruleId: REPO_DEPENDENCY_RULE_IDS.unknownInternalImport,
      path: importer,
      message: `unknown internal packages imported by ${importer}: ${names.join(", ")}`,
      data: { dependencies: names },
    });
  }

  const runtimeGraph = graphWithNodes([...workspaceByName.keys()]);
  const edgeEvidence = new Map<
    string,
    { manifestSections: Set<string>; sourceFiles: Set<string> }
  >();
  const recordEdge = (
    from: string,
    to: string,
    evidence: { readonly manifestSection?: string; readonly sourceFile?: string },
  ): void => {
    addGraphEdge(runtimeGraph, from, to);
    const key = `${from}\0${to}`;
    const current = edgeEvidence.get(key) ?? {
      manifestSections: new Set<string>(),
      sourceFiles: new Set<string>(),
    };
    if (evidence.manifestSection) current.manifestSections.add(evidence.manifestSection);
    if (evidence.sourceFile) current.sourceFiles.add(evidence.sourceFile);
    edgeEvidence.set(key, current);
  };
  let manifestEdges = 0;
  for (const owner of index.workspacePackages) {
    const ownerName = packageName(owner);
    if (!ownerName) continue;
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      for (const dependencyName of Object.keys(owner.manifest[section] ?? {}).sort()) {
        if (!workspaceByName.has(dependencyName)) continue;
        recordEdge(ownerName, dependencyName, { manifestSection: section });
        manifestEdges += 1;
      }
    }
  }

  let sourceEdges = 0;
  for (const owner of owners) {
    const ownerUsages = usages.get(owner.manifestPath) ?? new Map();
    const declaredRuntime = runtimeDependencies(owner.manifest);
    const declaredDevelopment = owner.manifest.devDependencies ?? {};
    for (const [dependencyName, usage] of [...ownerUsages.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const ownerName = packageName(owner);
      if (usage.execution.size > 0 && ownerName && workspaceByName.has(ownerName)) {
        for (const sourceFile of usage.execution) {
          recordEdge(ownerName, dependencyName, { sourceFile });
          sourceEdges += 1;
        }
      }
      if (usage.runtime.size > 0 && !declaredRuntime[dependencyName]) {
        const locations = [...usage.runtime].sort((left, right) => left.localeCompare(right));
        findings.push({
          ruleId: REPO_DEPENDENCY_RULE_IDS.runtimeDeclaration,
          path: owner.manifestPath,
          message: `${owner.manifestPath}: missing runtime dependency ${dependencyName} (used by ${locations.join(", ")})`,
          data: { dependency: dependencyName, locations },
        });
      } else if (
        usage.development.size > 0 &&
        !declaredRuntime[dependencyName] &&
        !declaredDevelopment[dependencyName]
      ) {
        const locations = [...usage.development].sort();
        findings.push({
          ruleId: REPO_DEPENDENCY_RULE_IDS.developmentDeclaration,
          path: owner.manifestPath,
          message: `${owner.manifestPath}: missing development dependency ${dependencyName} (used by ${locations.join(", ")})`,
          data: { dependency: dependencyName, locations },
        });
      } else if (
        usage.runtime.size === 0 &&
        usage.test.size > 0 &&
        !declaredRuntime[dependencyName] &&
        !declaredDevelopment[dependencyName]
      ) {
        const locations = [...usage.test].sort((left, right) => left.localeCompare(right));
        findings.push({
          ruleId: REPO_DEPENDENCY_RULE_IDS.testDeclaration,
          path: owner.manifestPath,
          message: `${owner.manifestPath}: missing test dependency ${dependencyName} (used by ${locations.join(", ")})`,
          data: { dependency: dependencyName, locations },
        });
      }
    }
  }

  const packageCycles = stronglyConnectedComponents(runtimeGraph);
  for (const component of packageCycles) {
    const cycle = canonicalCyclePath(component, runtimeGraph);
    const firstPackage = workspaceByName.get(component[0]!);
    findings.push({
      ruleId: REPO_DEPENDENCY_RULE_IDS.runtimeCycle,
      path: firstPackage?.manifestPath,
      message: `runtime workspace dependency cycle: ${cycle.join(" -> ")}`,
      data: { cycle, packages: component },
    });
  }

  const forbiddenEdgesByOwner = new Map<
    string,
    { owner: RepositoryPolicyPackage; targets: { evidence: unknown; name: string }[] }
  >();
  for (const [key, evidence] of [...edgeEvidence].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [from, to] = key.split("\0") as [string, string];
    const owner = workspaceByName.get(from);
    const target = workspaceByName.get(to);
    if (
      !owner?.directory.startsWith("packages/") ||
      !target ||
      !(target.directory.startsWith("apps/") || target.directory.startsWith("extensions/plugins/"))
    ) {
      continue;
    }
    const current = forbiddenEdgesByOwner.get(from) ?? { owner, targets: [] };
    current.targets.push({
      evidence: {
        manifestSections: [...evidence.manifestSections].sort(),
        sourceFiles: [...evidence.sourceFiles].sort(),
      },
      name: to,
    });
    forbiddenEdgesByOwner.set(from, current);
  }
  for (const [ownerName, violation] of [...forbiddenEdgesByOwner].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    findings.push({
      ruleId: REPO_DEPENDENCY_RULE_IDS.layerDirection,
      path: violation.owner.manifestPath,
      message: `${ownerName} depends on application/plugin packages: ${violation.targets.map((target) => target.name).join(", ")}`,
      data: toJson({ owner: ownerName, targets: violation.targets }),
    });
  }

  const runtimeModuleGraph = graphWithNodes(index.sourceFiles);
  const completeModuleGraph = graphWithNodes(index.sourceFiles);
  for (const record of index.imports) {
    if (record.kind !== "runtime" || !isRelativeSpecifier(record.specifier)) continue;
    const resolved = index.resolveRelativeImport(record.importer, record.specifier);
    if (!resolved) continue;
    const owner = record.ownerManifestPath;
    if (!owner || index.findNearestPackage(resolved)?.manifestPath !== owner) continue;
    addGraphEdge(completeModuleGraph, record.importer, resolved);
    if (record.mode === "runtime") addGraphEdge(runtimeModuleGraph, record.importer, resolved);
  }

  const runtimeModuleComponents = stronglyConnectedComponents(runtimeModuleGraph);
  const runtimeModuleKeys = new Set(
    runtimeModuleComponents.map((component) => [...component].sort().join("\0")),
  );
  const moduleCycles = [
    ...runtimeModuleComponents.map((component) => ({
      classification: "runtime" as const,
      component,
    })),
    ...stronglyConnectedComponents(completeModuleGraph)
      .filter((component) => !runtimeModuleKeys.has([...component].sort().join("\0")))
      .map((component) => ({ classification: "type-assisted" as const, component })),
  ];
  const moduleCyclesByPackage = new Map<
    string,
    {
      cycles: { classification: string; files: readonly string[]; path: readonly string[] }[];
      owner: RepositoryPolicyPackage;
    }
  >();
  let exceptedModuleCycles = 0;
  for (const cycle of moduleCycles) {
    const owner = index.findNearestPackage(cycle.component[0]!);
    const ownerName = owner ? packageName(owner) : undefined;
    if (!owner || !ownerName || !workspaceByName.has(ownerName)) continue;
    if (
      options.moduleCycleExceptions?.some((exception) =>
        moduleCycleExceptionMatches(exception, ownerName, cycle.component),
      )
    ) {
      exceptedModuleCycles += 1;
      continue;
    }
    const current = moduleCyclesByPackage.get(ownerName) ?? { cycles: [], owner };
    current.cycles.push({
      classification: cycle.classification,
      files: cycle.component,
      path: canonicalCyclePath(cycle.component, completeModuleGraph),
    });
    moduleCyclesByPackage.set(ownerName, current);
  }
  for (const [ownerName, entry] of [...moduleCyclesByPackage].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    findings.push({
      ruleId: REPO_DEPENDENCY_RULE_IDS.moduleCycle,
      path: entry.owner.manifestPath,
      message: `${ownerName} has ${entry.cycles.length} unreviewed package-local module cycle(s): ${entry.cycles.map((cycle) => cycle.path.join(" -> ")).join("; ")}`,
      data: toJson({ cycles: entry.cycles, packageName: ownerName }),
    });
  }

  for (const owner of owners) {
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ] as const) {
      for (const [dependencyName, version] of Object.entries(owner.manifest[section] ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        if (
          typeof version === "string" &&
          version.startsWith("workspace:") &&
          !workspaceByName.has(dependencyName)
        ) {
          findings.push({
            ruleId: REPO_DEPENDENCY_RULE_IDS.workspaceProtocol,
            path: owner.manifestPath,
            message: `${owner.manifestPath}: ${section}.${dependencyName} uses ${version}, but no matching workspace package is declared.`,
            data: { dependency: dependencyName, section, version },
          });
        }
      }
    }
  }

  if ((options.tools?.length ?? 0) > 0) {
    const rootManifestPath = path.join(repositoryRoot, "package.json");
    const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8")) as PackageManifest;
    const lockEntries = parseBunLockDependencyEntries(
      await readFile(path.join(repositoryRoot, "bun.lock"), "utf8"),
      path.join(repositoryRoot, "bun.lock"),
    );
    const sections: readonly DependencySection[] = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];

    for (const policy of options.tools ?? []) {
      for (const ownerManifestPath of policy.ownerManifests) {
        const owner = ownerByManifest.get(ownerManifestPath);
        if (!owner) {
          findings.push({
            ruleId: REPO_DEPENDENCY_RULE_IDS.toolIdentity,
            path: ownerManifestPath,
            message: `logical tool role ${policy.logicalRole} declares unknown owner ${ownerManifestPath}`,
            data: {
              declaredName: policy.declaredName,
              logicalRole: policy.logicalRole,
              ownerManifestPath,
            },
          });
          continue;
        }

        const ownerManifest = owner.manifest as PackageManifest;
        const location = sections
          .map((section) => ({
            section,
            specifier: ownerManifest[section]?.[policy.declaredName],
          }))
          .find(
            (entry): entry is { section: DependencySection; specifier: string } =>
              typeof entry.specifier === "string",
          );
        if (!location) {
          findings.push({
            ruleId: REPO_DEPENDENCY_RULE_IDS.toolIdentity,
            path: ownerManifestPath,
            message: `logical tool role ${policy.logicalRole} requires ${policy.declaredName} in ${ownerManifestPath}`,
            data: {
              declaredName: policy.declaredName,
              logicalRole: policy.logicalRole,
              ownerManifestPath,
            },
          });
          continue;
        }

        const reference = resolveDependencyReference({
          declaredName: policy.declaredName,
          declaredSpecifier: location.specifier,
          logicalToolRole: policy.logicalRole,
          manifestPath: path.join(repositoryRoot, ownerManifestPath),
          rootManifest,
          section: location.section,
        });
        if (reference.registryName !== policy.registryName) {
          findings.push({
            ruleId: REPO_DEPENDENCY_RULE_IDS.toolIdentity,
            path: ownerManifestPath,
            message: `${policy.logicalRole} resolves ${policy.declaredName} to ${reference.registryName ?? "no registry package"}; expected ${policy.registryName}`,
            data: toJson({ reference, expectedRegistryName: policy.registryName }),
          });
          continue;
        }

        const lockEntry = lockEntries.find((entry) => entry.declaredName === policy.declaredName);
        const evaluation = evaluateMinimumVersionPolicy({
          minimumVersion: policy.minimumVersion,
          reference,
          resolved: lockEntry ? { name: lockEntry.name, version: lockEntry.version } : undefined,
          stableRequired: policy.stableRequired,
        });
        for (const [evidenceKind, decision] of [
          ["declared", evaluation.declared],
          ["resolved", evaluation.resolved],
        ] as const) {
          if (decision.status !== "pass") {
            findings.push({
              ruleId: REPO_DEPENDENCY_RULE_IDS.toolVersion,
              path: evidenceKind === "declared" ? ownerManifestPath : "bun.lock",
              message: `${policy.logicalRole} ${evidenceKind} evidence for ${ownerManifestPath} does not satisfy ${policy.registryName} >= ${policy.minimumVersion}: ${decision.reason}`,
              data: toJson({
                decision,
                evidenceKind,
                logicalRole: policy.logicalRole,
                ownerManifestPath,
              }),
            });
          }
        }
      }
    }
  }

  return {
    findings: sortRepositoryPolicyFindings(findings),
    metadata: {
      exceptedModuleCycles,
      manifestEdges,
      moduleCycleCount: moduleCycles.length,
      packageCycleCount: packageCycles.length,
      repositoryRoot: path.resolve(repositoryRoot),
      sourceEdges,
      workspaceEdges: edgeEvidence.size,
      workspaceCount: index.workspacePackages.length,
    },
  };
}
