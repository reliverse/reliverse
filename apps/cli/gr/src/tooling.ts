import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  buildRprAcquireBundle,
  importRprAcquireBundle,
  RPR_ACQUIRE_LIST_SCHEMA,
  type RprAcquireRequestV0,
} from "@reliverse/rpr-cli/acquire";
import { updateRprCommonToolchain } from "@reliverse/rpr-cli/common-toolchain-update";
import {
  createRprNativeLock,
  createRprNativeLockFromStore,
  createRprToolchainComposition,
  materializeRprToolchainComposition,
  projectRprCommonToolchainToUserBin,
  readRprNativeLock,
  verifyRprNativeLock,
  verifyRprToolchainComposition,
  writeRprNativeLock,
  type RprNativeDependencyEdgeV0,
  type RprNativeLockV0,
  type RprToolchainCompositionV0,
} from "@reliverse/rpr-cli/native-lock";
import { withRprStorageLock, writeRprRootDocument } from "@reliverse/rpr-cli/storage-lock";
import { ingestRprRelease } from "@reliverse/rpr-cli/store";
import {
  digestRprDirectoryTree,
  verifyRprToolchainMaterialization,
} from "@reliverse/rpr-toolchain-materialization";

async function activateRepositoryToolchainGeneration(
  repositoryRoot: string,
  generation: string,
): Promise<void> {
  const statePath = path.join(repositoryRoot, "runtime.json");
  const previous = await readFile(statePath, "utf8")
    .then((value) => JSON.parse(value) as { schema?: string; current?: string; previous?: string })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  if (
    previous &&
    (previous.schema !== "reliverse.rpr.repository-toolchain-runtime.v0" ||
      typeof previous.current !== "string")
  ) {
    throw new Error("RPR_REPOSITORY_TOOLCHAIN_RUNTIME_INVALID");
  }
  if (previous?.current === generation) return;
  const state = {
    schema: "reliverse.rpr.repository-toolchain-runtime.v0",
    current: generation,
    ...(previous?.current && previous.current !== generation ? { previous: previous.current } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeRprRootDocument(statePath, state);
}

export interface GrWorkspaceExecutionMaterialization {
  readonly root: string;
  readonly lockfile: { readonly path: "bun.lock"; readonly sha256: `sha256:${string}` };
  readonly dependencyTopologySha256: `sha256:${string}`;
  readonly workspaceLinks: readonly {
    readonly packageName: string;
    readonly repositoryPath: string;
  }[];
  readonly dependencyLinks: readonly {
    readonly repositoryPath: string;
    readonly packageName: string;
    readonly materializedPath: string;
  }[];
  readonly packages: number;
}

function sha256Text(value: string): `sha256:${string}` {
  return `sha256:${Bun.CryptoHasher.hash("sha256", value, "hex")}`;
}

function pathInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalized = path.resolve(candidate);
  const rel = path.relative(normalizedRoot, normalized);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

type WorkspacePackage = Readonly<{
  packageName: string;
  root: string;
  manifest: any;
}>;

async function discoverWorkspacePackages(
  repositoryRoot: string,
  rootManifest: any,
): Promise<WorkspacePackage[]> {
  const patterns = Array.isArray(rootManifest?.workspaces)
    ? rootManifest.workspaces
    : Array.isArray(rootManifest?.workspaces?.packages)
      ? rootManifest.workspaces.packages
      : [];
  const discovered = new Map<string, WorkspacePackage>();
  for (const rawPattern of patterns) {
    if (typeof rawPattern !== "string" || !rawPattern.trim()) continue;
    const glob = new Bun.Glob(`${rawPattern.replace(/\/$/u, "")}/package.json`);
    for await (const relativeManifest of glob.scan({
      cwd: repositoryRoot,
      onlyFiles: true,
      dot: true,
    })) {
      const manifestPath = path.join(repositoryRoot, relativeManifest);
      let manifest: any;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch {
        continue;
      }
      const packageName = typeof manifest?.name === "string" ? manifest.name.trim() : "";
      if (!packageName) continue;
      const root = path.dirname(manifestPath);
      const existing = discovered.get(packageName);
      if (existing && path.resolve(existing.root) !== path.resolve(root)) {
        throw new Error(`GR_WORKSPACE_EXECUTION_DUPLICATE_WORKSPACE_PACKAGE:${packageName}`);
      }
      discovered.set(packageName, { packageName, root, manifest });
    }
  }
  return [...discovered.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}

function dependencyTopologyProjection(manifest: any): Record<string, unknown> {
  const copyMap = (value: unknown): Record<string, string> => {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, spec]) => typeof spec === "string")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, spec]) => [name, spec as string]),
    );
  };
  return {
    dependencies: copyMap(manifest?.dependencies),
    devDependencies: copyMap(manifest?.devDependencies),
    optionalDependencies: copyMap(manifest?.optionalDependencies),
    peerDependencies: copyMap(manifest?.peerDependencies),
    peerDependenciesMeta:
      manifest?.peerDependenciesMeta != null && typeof manifest.peerDependenciesMeta === "object"
        ? manifest.peerDependenciesMeta
        : {},
  };
}

function dependencyTopologySha256(
  repositoryRoot: string,
  rootManifest: any,
  workspaces: readonly WorkspacePackage[],
): `sha256:${string}` {
  const projection = [
    {
      repositoryPath: ".",
      packageName: typeof rootManifest?.name === "string" ? rootManifest.name : "",
      ...dependencyTopologyProjection(rootManifest),
    },
    ...workspaces.map((workspace) => ({
      repositoryPath: path.relative(repositoryRoot, workspace.root).replaceAll("\\", "/"),
      packageName: workspace.packageName,
      ...dependencyTopologyProjection(workspace.manifest),
    })),
  ];
  return sha256Text(JSON.stringify(projection));
}

function dependencyEntries(
  manifest: any,
  options: { readonly includeDev: boolean },
): Array<{ packageName: string; optional: boolean }> {
  const required = new Set<string>();
  const optional = new Set<string>();
  const maps = options.includeDev
    ? [manifest?.dependencies, manifest?.devDependencies]
    : [manifest?.dependencies];
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const name of Object.keys(map)) required.add(name);
  }
  if (manifest?.optionalDependencies && typeof manifest.optionalDependencies === "object") {
    for (const name of Object.keys(manifest.optionalDependencies)) {
      if (!required.has(name)) optional.add(name);
    }
  }
  if (manifest?.peerDependencies && typeof manifest.peerDependencies === "object") {
    for (const name of Object.keys(manifest.peerDependencies)) {
      const peerOptional = manifest?.peerDependenciesMeta?.[name]?.optional === true;
      if (peerOptional && !required.has(name)) optional.add(name);
      else required.add(name);
    }
  }
  return [
    ...[...required].sort().map((packageName) => ({ packageName, optional: false })),
    ...[...optional]
      .filter((packageName) => !required.has(packageName))
      .sort()
      .map((packageName) => ({ packageName, optional: true })),
  ];
}

async function resolveInstalledPackageSource(options: {
  repositoryRoot: string;
  importerRoot: string;
  packageName: string;
}): Promise<string | undefined> {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  let cursor = path.resolve(options.importerRoot);
  while (pathInside(repositoryRoot, cursor)) {
    const candidate = path.join(cursor, "node_modules", ...options.packageName.split("/"));
    if (await exists(path.join(candidate, "package.json"))) return await realpath(candidate);
    if (cursor === repositoryRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

export async function ensureWorkspaceExecutionRprMaterialization(options: {
  readonly rprRoot: string;
  readonly repositoryRoot: string;
}): Promise<GrWorkspaceExecutionMaterialization> {
  return withRprStorageLock(options.rprRoot, () =>
    ensureWorkspaceExecutionRprMaterializationLocked(options),
  );
}

async function ensureWorkspaceExecutionRprMaterializationLocked(options: {
  readonly rprRoot: string;
  readonly repositoryRoot: string;
}): Promise<GrWorkspaceExecutionMaterialization> {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const lockfilePath = path.join(repositoryRoot, "bun.lock");
  const nodeModules = path.join(repositoryRoot, "node_modules");
  if (!(await exists(lockfilePath)))
    throw new Error("GR_WORKSPACE_EXECUTION_LOCKFILE_MISSING:bun.lock");
  if (!(await exists(nodeModules)))
    throw new Error(
      "GR_WORKSPACE_EXECUTION_NODE_MODULES_MISSING:run bun install before creating an offline bundle",
    );
  const lockfileText = await readFile(lockfilePath, "utf8");
  const lockfileSha256 = sha256Text(lockfileText);
  const repositoryKey = Bun.CryptoHasher.hash("sha256", repositoryRoot, "hex").slice(0, 16);

  const rootManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const workspaces = await discoverWorkspacePackages(repositoryRoot, rootManifest);
  const workspaceByName = new Map(workspaces.map((entry) => [entry.packageName, entry]));
  const expectedWorkspaceLinks = workspaces.map((entry) => ({
    packageName: entry.packageName,
    repositoryPath: path.relative(repositoryRoot, entry.root).replaceAll("\\", "/"),
  }));

  const expectedDependencyTopologySha256 = dependencyTopologySha256(
    repositoryRoot,
    rootManifest,
    workspaces,
  );
  const executionKey = `${lockfileSha256.slice(7, 23)}-${expectedDependencyTopologySha256.slice(7, 23)}`;
  const base = path.join(
    options.rprRoot,
    "toolchains",
    "repositories",
    repositoryKey,
    executionKey,
  );
  const target = path.join(base, "materialized");
  const metadataPath = path.join(base, "workspace-execution.json");

  if ((await exists(target)) && (await exists(metadataPath))) {
    const verified = await verifyRprToolchainMaterialization(target);
    if (verified.ok) {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      if (
        metadata?.lockfile?.sha256 === lockfileSha256 &&
        metadata?.dependencyTopologySha256 === expectedDependencyTopologySha256 &&
        JSON.stringify(metadata.workspaceLinks ?? []) === JSON.stringify(expectedWorkspaceLinks) &&
        Array.isArray(metadata.dependencyLinks)
      ) {
        await activateRepositoryToolchainGeneration(path.dirname(base), executionKey);
        return {
          root: target,
          lockfile: metadata.lockfile,
          dependencyTopologySha256: metadata.dependencyTopologySha256,
          workspaceLinks: metadata.workspaceLinks ?? [],
          dependencyLinks: metadata.dependencyLinks,
          packages: Number(metadata.packages ?? 0),
        };
      }
    }
  }

  type ExternalInstance = {
    id: string;
    packageName: string;
    source: string;
    version: string;
    treeDigest: string;
    dependencies: RprNativeDependencyEdgeV0[];
  };
  const externalByKey = new Map<string, ExternalInstance>();
  const externalById = new Map<string, ExternalInstance>();

  const resolveExternal = async (
    packageName: string,
    importerRoot: string,
    optional: boolean,
  ): Promise<ExternalInstance | undefined> => {
    const source = await resolveInstalledPackageSource({
      repositoryRoot,
      importerRoot,
      packageName,
    });
    if (!source) {
      if (optional) return undefined;
      throw new Error(
        `GR_WORKSPACE_EXECUTION_DEPENDENCY_UNRESOLVED:${packageName}:${path.relative(repositoryRoot, importerRoot) || "."}`,
      );
    }
    let packageJson: any;
    try {
      packageJson = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    } catch {
      throw new Error(`GR_WORKSPACE_EXECUTION_PACKAGE_MANIFEST_MISSING:${packageName}`);
    }
    const resolvedPackageName =
      typeof packageJson?.name === "string" && packageJson.name.trim()
        ? packageJson.name.trim()
        : packageName;
    const version =
      typeof packageJson?.version === "string" && packageJson.version
        ? packageJson.version
        : "0.0.0";
    const treeDigest = await digestRprDirectoryTree(source);
    const key = `${resolvedPackageName}\u0000${treeDigest}`;
    const existing = externalByKey.get(key);
    if (existing) return existing;
    const id = `dep-${Bun.CryptoHasher.hash("sha256", `${resolvedPackageName}\u0000${treeDigest}`, "hex").slice(0, 20)}`;
    const instance: ExternalInstance = {
      id,
      packageName: resolvedPackageName,
      source,
      version,
      treeDigest,
      dependencies: [],
    };
    externalByKey.set(key, instance);
    externalById.set(id, instance);
    for (const child of dependencyEntries(packageJson, { includeDev: false })) {
      if (workspaceByName.has(child.packageName)) continue;
      const resolved = await resolveExternal(child.packageName, source, child.optional);
      if (resolved) {
        instance.dependencies.push({
          requestedName: child.packageName,
          entryId: resolved.id,
        });
      }
    }
    instance.dependencies = [
      ...new Map(
        instance.dependencies.map((dependency) => [
          `${dependency.requestedName ?? ""}\u0000${dependency.entryId}`,
          dependency,
        ]),
      ).values(),
    ].sort(
      (a, b) =>
        (a.requestedName ?? "").localeCompare(b.requestedName ?? "") ||
        a.entryId.localeCompare(b.entryId),
    );
    return instance;
  };

  const rootEntries: string[] = [];
  for (const dependency of dependencyEntries(rootManifest, { includeDev: true })) {
    if (workspaceByName.has(dependency.packageName)) continue;
    const resolved = await resolveExternal(
      dependency.packageName,
      repositoryRoot,
      dependency.optional,
    );
    if (resolved) rootEntries.push(resolved.id);
  }

  const dependencyLinks: Array<{
    repositoryPath: string;
    packageName: string;
    materializedPath: string;
  }> = [];
  for (const workspace of workspaces) {
    const repositoryPath = path.relative(repositoryRoot, workspace.root).replaceAll("\\", "/");
    for (const dependency of dependencyEntries(workspace.manifest, { includeDev: true })) {
      if (workspaceByName.has(dependency.packageName)) continue;
      const resolved = await resolveExternal(
        dependency.packageName,
        workspace.root,
        dependency.optional,
      );
      if (!resolved) continue;
      dependencyLinks.push({
        repositoryPath,
        packageName: dependency.packageName,
        materializedPath: `packages/${resolved.id.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}`,
      });
    }
  }

  const externalInstances = [...externalById.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!externalInstances.length) throw new Error("GR_WORKSPACE_EXECUTION_EXTERNAL_PACKAGES_EMPTY");
  const releases: Array<{
    id: string;
    releaseId: string;
    packageName: string;
    dependencies: readonly RprNativeDependencyEdgeV0[];
  }> = [];
  for (const external of externalInstances) {
    const ingested = await ingestRprRelease({
      sourceDirectory: external.source,
      storeRoot: options.rprRoot,
      recordId: `rpr:record:workspace:${external.id}`,
      version: external.version,
      sourceKind: "npm",
      sourceReference: `bun.lock:${lockfileSha256}:${external.packageName}@${external.version}:${external.treeDigest}`,
      status: "active",
    });
    releases.push({
      id: external.id,
      releaseId: ingested.release.releaseId,
      packageName: external.packageName,
      dependencies: external.dependencies,
    });
  }

  const targetTriple = { os: process.platform, arch: process.arch } as const;
  const lock = await createRprNativeLockFromStore({
    storeRoot: options.rprRoot,
    target: targetTriple,
    requests: releases.map((entry) => ({
      id: entry.id,
      request: entry.releaseId,
      dependencies: entry.dependencies,
      packageName: entry.packageName,
      portability: { kind: "repository-specific" as const, repository: lockfileSha256 },
    })),
  });
  const composition = createRprToolchainComposition({
    name: `workspace-${lockfileSha256.slice(7, 19)}`,
    lock,
    entries: releases.map((entry) => entry.id),
    rootEntries: [...new Set(rootEntries)].sort(),
    profile: { kind: "repository-specific", repository: lockfileSha256 },
  });
  await mkdir(base, { recursive: true });
  await writeRprNativeLock(path.join(base, "lock.json"), lock);
  await writeFile(path.join(base, "composition.json"), `${JSON.stringify(composition, null, 2)}\n`);
  await materializeRprToolchainComposition({
    storeRoot: options.rprRoot,
    lock,
    composition,
    target,
  });

  const metadata = {
    schema: "gr.workspace-execution.v0",
    lockfile: { path: "bun.lock" as const, sha256: lockfileSha256 },
    dependencyTopologySha256: expectedDependencyTopologySha256,
    workspaceLinks: expectedWorkspaceLinks,
    dependencyLinks: dependencyLinks.sort(
      (a, b) =>
        a.repositoryPath.localeCompare(b.repositoryPath) ||
        a.packageName.localeCompare(b.packageName),
    ),
    packages: releases.length,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await activateRepositoryToolchainGeneration(path.dirname(base), executionKey);
  return {
    root: target,
    lockfile: metadata.lockfile,
    dependencyTopologySha256: metadata.dependencyTopologySha256,
    workspaceLinks: metadata.workspaceLinks,
    dependencyLinks: metadata.dependencyLinks,
    packages: metadata.packages,
  };
}

export interface GrCommonToolingPolicy {
  readonly mode?: "auto" | "none";
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly versions?: Readonly<Record<string, string>>;
}

type CommonBootstrapEntry = Readonly<{
  id: string;
  kind: "acquired" | "current-gr" | "handoff-operator";
  requestId?: string;
  recordId: string;
  version: string;
  packageName?: string;
  projection?: string;
  executable?: string;
  dependencies?: readonly string[];
  defines?: Readonly<Record<string, string>>;
}>;

interface CommonBootstrapPlan {
  readonly target: { readonly os: string; readonly arch: string; readonly libc?: string };
  readonly acquire: { readonly requests: readonly RprAcquireRequestV0[] };
  readonly entries: readonly CommonBootstrapEntry[];
  readonly evidence: readonly string[];
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

export function resolveUserRprRoot(input?: string): string {
  if (input?.trim()) return path.resolve(expandHome(input.trim()));
  const reliverseHome = process.env.RELIVERSE_HOME?.trim();
  return path.resolve(
    reliverseHome ? expandHome(reliverseHome) : path.join(homedir(), ".reliverse"),
    "rpr",
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function exactVersion(spec: unknown, actualPackage?: string): string | undefined {
  if (typeof spec !== "string") return undefined;
  const value = spec.trim();
  const exact = value.match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u)?.[1];
  if (exact) return exact;
  const alias = value.match(/^npm:([^@]+|@[^/]+\/[^@]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u);
  if (alias && (!actualPackage || alias[1] === actualPackage)) return alias[2];
  return undefined;
}

function normalizedTool(value: string): string {
  if (value === "typescript-7" || value === "ts7") return "typescript";
  if (value === "handoff" || value === "@reliverse/rse-handoff") return "rse-handoff";
  return value;
}

function supportedBunArtifact(version: string): RprAcquireRequestV0 | undefined {
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      id: "bun",
      kind: "http",
      url: `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip`,
      filename: "bun-linux-x64.zip",
      materialize: { kind: "zip", path: "bun", stripComponents: 1 },
    };
  }
  return undefined;
}

function supportedTs7Artifact(version: string): RprAcquireRequestV0 | undefined {
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      id: "ts7",
      kind: "http",
      url: `https://github.com/microsoft/TypeScript/releases/download/v${version}/typescript-linux-x64.tgz`,
      filename: "typescript-linux-x64.tgz",
      materialize: { kind: "tar", path: "ts7", stripComponents: 1 },
    };
  }
  return undefined;
}

function npmMaterializationPath(name: string): string {
  return `packages/${name.replace(/^@/u, "").replaceAll("/", "__")}`;
}

function packageSpec(pkg: any, name: string): unknown {
  const maps = [
    pkg?.dependencies,
    pkg?.devDependencies,
    pkg?.optionalDependencies,
    pkg?.peerDependencies,
  ];
  for (const map of maps) {
    if (map && Object.prototype.hasOwnProperty.call(map, name)) {
      const raw = map[name];
      if (raw === "catalog:") return pkg?.workspaces?.catalog?.[name];
      return raw;
    }
  }
  return undefined;
}

function allPackageSpecs(pkg: any): Array<{ name: string; spec: unknown }> {
  const names = new Set<string>();
  for (const map of [
    pkg?.dependencies,
    pkg?.devDependencies,
    pkg?.optionalDependencies,
    pkg?.peerDependencies,
  ]) {
    if (map && typeof map === "object") for (const name of Object.keys(map)) names.add(name);
  }
  return [...names].map((name) => ({ name, spec: packageSpec(pkg, name) }));
}

async function packageVersion(file: string, fallback: string): Promise<string> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return typeof parsed?.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : fallback;
  } catch {
    return fallback;
  }
}

export async function inferCommonToolingBootstrap(options: {
  repositoryRoot: string;
  policy?: GrCommonToolingPolicy;
  handoffEnabled?: boolean;
}): Promise<CommonBootstrapPlan> {
  const policy = options.policy ?? {};
  if (policy.mode === "none") throw new Error("GR_COMMON_TOOLING_DISABLED");
  const packageJsonPath = path.join(options.repositoryRoot, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const include = new Set((policy.include ?? []).map(normalizedTool));
  const exclude = new Set((policy.exclude ?? []).map(normalizedTool));
  const overrideVersion = (name: string) =>
    policy.versions?.[name] ?? policy.versions?.[normalizedTool(name)];
  const evidence: string[] = [];
  const requests: RprAcquireRequestV0[] = [];
  const entries: CommonBootstrapEntry[] = [];

  const packageManager =
    typeof pkg.packageManager === "string"
      ? pkg.packageManager.match(/^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u)?.[1]
      : undefined;
  const runtimeBun =
    typeof Bun !== "undefined" && typeof Bun.version === "string" ? Bun.version : undefined;
  const bunVersion =
    overrideVersion("bun") ?? packageManager ?? (include.has("bun") ? runtimeBun : undefined);
  const needsBunForBuild = await exists(
    path.join(options.repositoryRoot, "apps", "cli", "gr", "src", "cli.ts"),
  );
  if (!exclude.has("bun") && (bunVersion || needsBunForBuild)) {
    const version = bunVersion ?? runtimeBun;
    if (!version) throw new Error("GR_COMMON_TOOLING_BUN_VERSION_UNRESOLVED");
    const request = supportedBunArtifact(version);
    if (!request)
      throw new Error(
        `GR_COMMON_TOOLING_BUN_PLATFORM_UNSUPPORTED:${process.platform}/${process.arch}`,
      );
    requests.push(request);
    entries.push({
      id: "bun",
      kind: "acquired",
      requestId: "bun",
      recordId: "rpr:record:bun",
      version,
      packageName: "bun",
      projection: "bun",
      executable: "bun",
    });
    evidence.push(packageManager ? `packageManager:bun@${version}` : `runtime:bun@${version}`);
  }

  const tsCandidates = allPackageSpecs(pkg)
    .filter(
      ({ name, spec }) =>
        name === "typescript" ||
        name.startsWith("typescript-") ||
        (typeof spec === "string" && spec.startsWith("npm:typescript@")),
    )
    .map(({ name, spec }) => ({
      name,
      version: exactVersion(spec, "typescript") ?? exactVersion(spec),
    }))
    .filter((entry): entry is { name: string; version: string } => Boolean(entry.version))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const tsVersion = overrideVersion("typescript") ?? tsCandidates[0]?.version;
  if (!exclude.has("typescript") && (tsVersion || include.has("typescript"))) {
    if (!tsVersion) throw new Error("GR_COMMON_TOOLING_TYPESCRIPT_VERSION_UNRESOLVED");
    const major = Number(tsVersion.split(".")[0]);
    const native = major >= 7 ? supportedTs7Artifact(tsVersion) : undefined;
    if (native) {
      requests.push(native);
      entries.push({
        id: "typescript",
        kind: "acquired",
        requestId: "ts7",
        recordId: "rpr:record:typescript-native",
        version: tsVersion,
        packageName: "typescript",
        projection: "tsc7",
        executable: "lib/tsc",
      });
      evidence.push(`package:typescript@${tsVersion}:native`);
    } else {
      requests.push({
        id: "typescript",
        kind: "npm",
        package: "typescript",
        version: tsVersion,
        materialize: { kind: "tar", path: "typescript", stripComponents: 1 },
      });
      entries.push({
        id: "typescript",
        kind: "acquired",
        requestId: "typescript",
        recordId: "rpr:record:typescript",
        version: tsVersion,
        packageName: "typescript",
      });
      evidence.push(`package:typescript@${tsVersion}`);
    }
  }

  for (const name of ["@types/node", "@types/bun", "bun-types"] as const) {
    if (exclude.has(name)) continue;
    const version = overrideVersion(name) ?? exactVersion(packageSpec(pkg, name));
    if (!version && !include.has(name)) continue;
    if (!version) throw new Error(`GR_COMMON_TOOLING_VERSION_UNRESOLVED:${name}`);
    const id = name.replace(/^@/u, "").replaceAll("/", "-");
    requests.push({
      id,
      kind: "npm",
      package: name,
      version,
      materialize: { kind: "tar", path: npmMaterializationPath(name), stripComponents: 1 },
    });
    entries.push({
      id,
      kind: "acquired",
      requestId: id,
      recordId: `rpr:record:${name}`,
      version,
      packageName: name,
    });
    evidence.push(`package:${name}@${version}`);
  }

  const grVersion = await packageVersion(
    path.join(options.repositoryRoot, "apps", "cli", "gr", "package.json"),
    "0.1.0",
  );
  entries.push({
    id: "gr",
    kind: "current-gr",
    recordId: "rpr:record:@reliverse/gr-cli",
    version: grVersion,
    packageName: "@reliverse/gr-cli",
    projection: "gr",
    executable: "gr",
    dependencies: entries.some((entry) => entry.id === "bun") ? ["bun"] : [],
    defines: { RELIVERSE_GR_VERSION: grVersion },
  });
  evidence.push(`repository:@reliverse/gr-cli@${grVersion}`);

  const handoffSource = path.join(
    options.repositoryRoot,
    "packages",
    "rse",
    "rse-handoff",
    "src",
    "index.ts",
  );
  const wantsHandoff = options.handoffEnabled || include.has("rse-handoff");
  if (!exclude.has("rse-handoff") && wantsHandoff && (await exists(handoffSource))) {
    const version = await packageVersion(
      path.join(options.repositoryRoot, "packages", "rse", "rse-handoff", "package.json"),
      "0.1.0",
    );
    entries.push({
      id: "handoff",
      kind: "handoff-operator",
      recordId: "rpr:record:@reliverse/rse-handoff-operator",
      version,
      packageName: "@reliverse/rse-handoff",
      projection: "rse-handoff",
      executable: "rse-handoff",
      dependencies: entries.some((entry) => entry.id === "bun") ? ["bun"] : [],
    });
    evidence.push(`repository:@reliverse/rse-handoff@${version}`);
  }

  return {
    target: {
      os: process.platform === "win32" ? "windows" : process.platform,
      arch: process.arch === "x64" ? "x64" : process.arch,
      ...(process.platform === "linux" ? { libc: "gnu" } : {}),
    },
    acquire: { requests },
    entries,
    evidence,
  };
}

async function run(executable: string, args: readonly string[], cwd?: string): Promise<void> {
  const child = Bun.spawn([executable, ...args], {
    ...(cwd ? { cwd } : {}),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`GR_COMMON_BOOTSTRAP_COMMAND_FAILED:${path.basename(executable)}:${code}`);
}

async function buildCurrentGr(options: {
  bun?: string;
  repositoryRoot: string;
  targetDirectory: string;
  entry: CommonBootstrapEntry;
}): Promise<void> {
  await mkdir(options.targetDirectory, { recursive: true });
  const output = path.join(options.targetDirectory, options.entry.executable ?? "gr");
  await mkdir(path.dirname(output), { recursive: true });
  const sourceInvocation = Bun.argv.some((arg) =>
    arg.replaceAll("\\", "/").endsWith("/apps/cli/gr/src/cli.ts"),
  );
  if (
    !sourceInvocation &&
    /^gr(?:\.exe)?$/iu.test(path.basename(process.execPath)) &&
    (await exists(process.execPath)) &&
    !/\bbun(?:\.exe)?$/iu.test(path.basename(process.execPath))
  ) {
    await cp(process.execPath, output);
    return;
  }
  if (!options.bun) throw new Error("GR_COMMON_BOOTSTRAP_BUN_REQUIRED_FOR_SOURCE_GR");
  const args = [
    "build",
    path.join(options.repositoryRoot, "apps/cli/gr/src/cli.ts"),
    "--compile",
    "--no-compile-autoload-dotenv",
    "--outfile",
    output,
  ];
  for (const [key, value] of Object.entries(options.entry.defines ?? {}))
    args.push("--define", `${key}=${JSON.stringify(value)}`);
  await run(options.bun, args, options.repositoryRoot);
}

async function buildHandoffOperator(options: {
  bun?: string;
  repositoryRoot: string;
  targetDirectory: string;
  entry: CommonBootstrapEntry;
}): Promise<void> {
  if (!options.bun) throw new Error("GR_COMMON_BOOTSTRAP_BUN_REQUIRED_FOR_HANDOFF");
  await mkdir(options.targetDirectory, { recursive: true });
  const wrapper = path.join(options.targetDirectory, "entry.ts");
  const source = path
    .join(options.repositoryRoot, "packages", "rse", "rse-handoff", "src", "index.ts")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  await writeFile(
    wrapper,
    `import { inspectRseHandoffProjection, validateRseHandoffDirectory } from "${source}";\nconst [command, root] = Bun.argv.slice(2);\nif (!command || !root) process.exit(2);\nif (command === "verify") { const result = await validateRseHandoffDirectory(root); console.log(JSON.stringify(result, null, 2)); process.exit(result.ok ? 0 : 1); }\nif (command === "inspect") { console.log(JSON.stringify(await inspectRseHandoffProjection(root), null, 2)); process.exit(0); }\nprocess.exit(2);\n`,
  );
  await run(
    options.bun,
    [
      "build",
      wrapper,
      "--compile",
      "--no-compile-autoload-dotenv",
      "--outfile",
      path.join(options.targetDirectory, options.entry.executable ?? "rse-handoff"),
    ],
    options.repositoryRoot,
  );
  await rm(wrapper, { force: true });
}

async function refreshRepositoryBuiltCommonEntries(options: {
  rprRoot: string;
  repositoryRoot: string;
  lock: RprNativeLockV0;
  composition: RprToolchainCompositionV0;
  materializationRoot: string;
}): Promise<{ lock: RprNativeLockV0; composition: RprToolchainCompositionV0; changed: boolean }> {
  const byId = new Map(options.lock.entries.map((entry) => [entry.id, entry]));
  const refreshIds = ["gr", "handoff"].filter(
    (id) => byId.has(id) && options.composition.entries.includes(id),
  );
  if (refreshIds.length === 0)
    return { lock: options.lock, composition: options.composition, changed: false };

  const bunExecutable = path.join(options.materializationRoot, "bin", "bun");
  if (!(await exists(bunExecutable))) throw new Error("GR_COMMON_REFRESH_BUN_EXECUTABLE_MISSING");

  const buildRoot = await mkdtemp(path.join(tmpdir(), "gr-common-refresh-"));
  const replacements = new Map<string, RprNativeLockV0["entries"][number]>();
  try {
    for (const id of refreshIds) {
      const current = byId.get(id)!;
      const sourceDirectory = path.join(buildRoot, id);
      const entry: CommonBootstrapEntry = {
        id,
        kind: id === "gr" ? "current-gr" : "handoff-operator",
        recordId: current.recordId,
        version: current.version,
        ...(current.packageName ? { packageName: current.packageName } : {}),
        ...(current.projection ? { projection: current.projection } : {}),
        ...(current.executable ? { executable: current.executable } : {}),
        dependencies: current.dependencies.map((dependency) => dependency.entryId),
        ...(id === "gr" ? { defines: { RELIVERSE_GR_VERSION: current.version } } : {}),
      };
      if (entry.kind === "current-gr") {
        await buildCurrentGr({
          bun: bunExecutable,
          repositoryRoot: options.repositoryRoot,
          targetDirectory: sourceDirectory,
          entry,
        });
      } else {
        await buildHandoffOperator({
          bun: bunExecutable,
          repositoryRoot: options.repositoryRoot,
          targetDirectory: sourceDirectory,
          entry,
        });
      }
      // Preserve exact immutable release provenance on a byte-identical refresh.
      if ((await digestRprDirectoryTree(sourceDirectory)) === current.treeDigest) continue;
      const ingested = await ingestRprRelease({
        sourceDirectory,
        storeRoot: options.rprRoot,
        payloadRetention: "development",
        recordId: current.recordId,
        version: current.version,
        sourceKind: "repository",
        status: "active",
      });
      const blob = ingested.release.blobs.find((candidate) => candidate.role === "source-tree");
      if (!blob?.digest.startsWith("sha256:"))
        throw new Error(`GR_COMMON_REFRESH_SOURCE_TREE_MISSING:${id}`);
      replacements.set(id, {
        ...current,
        releaseId: ingested.release.releaseId,
        recordId: ingested.release.recordId,
        version: ingested.release.version,
        treeDigest: blob.digest as `sha256:${string}`,
      });
    }
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }

  const entries = options.lock.entries.map((entry) => replacements.get(entry.id) ?? entry);
  const changed = entries.some(
    (entry, index) =>
      entry.releaseId !== options.lock.entries[index]?.releaseId ||
      entry.treeDigest !== options.lock.entries[index]?.treeDigest,
  );
  if (!changed) return { lock: options.lock, composition: options.composition, changed: false };

  const lock = createRprNativeLock({
    target: options.lock.target,
    roots: options.lock.roots,
    entries,
  });
  const composition = createRprToolchainComposition({
    name: options.composition.name,
    lock,
    entries: options.composition.entries,
    ...(options.composition.profile ? { profile: options.composition.profile } : {}),
  });
  return { lock, composition, changed: true };
}

async function bootstrapCommonRprToolchain(options: {
  rprRoot: string;
  repositoryRoot: string;
  policy?: GrCommonToolingPolicy;
  handoffEnabled?: boolean;
}) {
  const plan = await inferCommonToolingBootstrap({
    repositoryRoot: options.repositoryRoot,
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.handoffEnabled != null ? { handoffEnabled: options.handoffEnabled } : {}),
  });
  const bootstrapRoot = path.join(options.rprRoot, "bootstrap", "common");
  await mkdir(bootstrapRoot, { recursive: true });
  const materializedByRequest = new Map<string, string>();
  if (plan.acquire.requests.length) {
    const acquireListPath = path.join(bootstrapRoot, "acquire-list.json");
    const acquireBundlePath = path.join(bootstrapRoot, "acquire-bundle.tar.gz");
    await writeFile(
      acquireListPath,
      `${JSON.stringify({ schema: RPR_ACQUIRE_LIST_SCHEMA, id: "gr-common-tooling", target: { os: plan.target.os, arch: plan.target.arch, ...(plan.target.libc ? { abi: plan.target.libc } : {}) }, requests: plan.acquire.requests }, null, 2)}\n`,
    );
    await buildRprAcquireBundle({
      listPath: acquireListPath,
      outputPath: acquireBundlePath,
      authorized: true,
    });
    const imported = await importRprAcquireBundle({
      bundlePath: acquireBundlePath,
      storeRoot: options.rprRoot,
      materialize: true,
      authorized: true,
    });
    for (const entry of imported.materializations)
      materializedByRequest.set(entry.requestId, entry.path);
  }

  const bunEntry = plan.entries.find((entry) => entry.id === "bun");
  const bunRoot = bunEntry?.requestId ? materializedByRequest.get(bunEntry.requestId) : undefined;
  const bunExecutable =
    bunEntry?.executable && bunRoot ? path.join(bunRoot, bunEntry.executable) : undefined;
  if (bunExecutable && !(await exists(bunExecutable)))
    throw new Error("GR_COMMON_BOOTSTRAP_BUN_EXECUTABLE_MISSING");

  const releaseById = new Map<string, Awaited<ReturnType<typeof ingestRprRelease>>["release"]>();
  const buildRoot = await mkdtemp(path.join(tmpdir(), "gr-common-bootstrap-"));
  try {
    for (const entry of plan.entries) {
      let sourceDirectory: string;
      if (entry.kind === "acquired") {
        sourceDirectory = entry.requestId ? (materializedByRequest.get(entry.requestId) ?? "") : "";
        if (!sourceDirectory)
          throw new Error(
            `GR_COMMON_BOOTSTRAP_REQUEST_NOT_MATERIALIZED:${entry.requestId ?? entry.id}`,
          );
      } else {
        sourceDirectory = path.join(buildRoot, entry.id);
        if (entry.kind === "current-gr") {
          await buildCurrentGr({
            ...(bunExecutable ? { bun: bunExecutable } : {}),
            repositoryRoot: options.repositoryRoot,
            targetDirectory: sourceDirectory,
            entry,
          });
        } else {
          await buildHandoffOperator({
            ...(bunExecutable ? { bun: bunExecutable } : {}),
            repositoryRoot: options.repositoryRoot,
            targetDirectory: sourceDirectory,
            entry,
          });
        }
      }
      const ingested = await ingestRprRelease({
        sourceDirectory,
        storeRoot: options.rprRoot,
        recordId: entry.recordId,
        version: entry.version,
        sourceKind: entry.kind === "acquired" ? "manual" : "repository",
        status: "active",
      });
      releaseById.set(entry.id, ingested.release);
    }
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }

  const packageNameByEntryId = new Map(
    plan.entries.map((entry) => [entry.id, entry.packageName] as const),
  );
  const lock = await createRprNativeLockFromStore({
    storeRoot: options.rprRoot,
    target: plan.target,
    requests: plan.entries.map((entry) => ({
      id: entry.id,
      request: releaseById.get(entry.id)!.releaseId,
      dependencies: (entry.dependencies ?? []).map((entryId) => {
        const requestedName = packageNameByEntryId.get(entryId);
        return {
          entryId,
          ...(requestedName ? { requestedName } : {}),
        };
      }),
      ...(entry.packageName ? { packageName: entry.packageName } : {}),
      ...(entry.projection ? { projection: entry.projection } : {}),
      ...(entry.executable ? { executable: entry.executable } : {}),
      portability: { kind: "common" as const },
    })),
  });
  const composition = createRprToolchainComposition({
    name: "common",
    lock,
    entries: plan.entries.map((entry) => entry.id),
    profile: { kind: "common" },
  });
  const base = path.join(options.rprRoot, "toolchains", "common");
  await mkdir(base, { recursive: true });
  await writeRprNativeLock(path.join(base, "lock.json"), lock);
  await writeFile(path.join(base, "composition.json"), `${JSON.stringify(composition, null, 2)}\n`);
  await writeFile(
    path.join(base, "bootstrap-evidence.json"),
    `${JSON.stringify({ schema: "gr.common-tooling-inference.v0", evidence: plan.evidence }, null, 2)}\n`,
  );
  return { lock, composition };
}

export async function ensureCommonRprToolchainMaterialization(options: {
  rprRoot: string;
  repositoryRoot?: string;
  toolingPolicy?: GrCommonToolingPolicy;
  handoffEnabled?: boolean;
}): Promise<{
  root: string;
  lockId: string;
  compositionId: string;
  materialized: boolean;
  bootstrapped: boolean;
  projected: boolean;
}> {
  return withRprStorageLock(options.rprRoot, () =>
    ensureCommonRprToolchainMaterializationLocked(options),
  );
}

async function ensureCommonRprToolchainMaterializationLocked(options: {
  rprRoot: string;
  repositoryRoot?: string;
  toolingPolicy?: GrCommonToolingPolicy;
  handoffEnabled?: boolean;
}): Promise<{
  root: string;
  lockId: string;
  compositionId: string;
  materialized: boolean;
  bootstrapped: boolean;
  projected: boolean;
}> {
  const base = path.join(options.rprRoot, "toolchains", "common");
  const lockPath = path.join(base, "lock.json");
  const compositionPath = path.join(base, "composition.json");
  const target = path.join(base, "materialized");
  let current = await verifyRprToolchainMaterialization(target);

  if (current.ok && (await exists(lockPath))) {
    const persistedLock = await readRprNativeLock(lockPath);
    const persistedLockVerification = verifyRprNativeLock(persistedLock);

    if (!persistedLockVerification.ok) {
      if (!options.repositoryRoot) {
        throw new Error(
          `RPR_COMMON_TOOLCHAIN_LOCK_INCOMPATIBLE:${persistedLockVerification.diagnostics.join(",")}`,
        );
      }

      throw new Error(
        `RPR_COMMON_TOOLCHAIN_LOCK_INCOMPATIBLE:${persistedLockVerification.diagnostics.join(",")}`,
      );
    }
  }

  if (current.ok) {
    let lock = await readRprNativeLock(lockPath);
    let composition = JSON.parse(
      await Bun.file(compositionPath).text(),
    ) as RprToolchainCompositionV0;
    let refreshed = false;
    if (options.repositoryRoot) {
      const result = await refreshRepositoryBuiltCommonEntries({
        rprRoot: options.rprRoot,
        repositoryRoot: options.repositoryRoot,
        lock,
        composition,
        materializationRoot: target,
      });
      lock = result.lock;
      composition = result.composition;
      refreshed = result.changed;
      if (refreshed) {
        await updateRprCommonToolchain({
          storeRoot: options.rprRoot,
          lock,
          composition,
          healthCheck: async (root) => {
            await run(path.join(root, "bin/gr"), ["--version"]);
          },
        });
      }
    }
    const verified = await verifyRprToolchainMaterialization(target);
    if (!verified.ok)
      throw new Error(`RPR_COMMON_TOOLCHAIN_REFRESH_INVALID:${verified.diagnostics.join(",")}`);
    const receipt = verified.receipt as Record<string, unknown>;
    const projection = await projectRprCommonToolchainToUserBin({ materializationRoot: target });
    return {
      root: target,
      lockId: String(receipt.lockId),
      compositionId: String(receipt.compositionId),
      materialized: refreshed,
      bootstrapped: false,
      projected: projection.projections.length > 0,
    };
  }
  let bootstrapped = false;
  if (!(await exists(lockPath)) || !(await exists(compositionPath))) {
    if (!options.repositoryRoot) throw new Error(`RPR_COMMON_TOOLCHAIN_NOT_REGISTERED:${base}`);
    await bootstrapCommonRprToolchain({
      rprRoot: options.rprRoot,
      repositoryRoot: options.repositoryRoot,
      ...(options.toolingPolicy ? { policy: options.toolingPolicy } : {}),
      ...(options.handoffEnabled != null ? { handoffEnabled: options.handoffEnabled } : {}),
    });
    bootstrapped = true;
  }
  const lock = await readRprNativeLock(lockPath);
  const composition = JSON.parse(
    await Bun.file(compositionPath).text(),
  ) as RprToolchainCompositionV0;
  if (composition.profile?.kind !== "common")
    throw new Error("RPR_COMMON_TOOLCHAIN_PROFILE_REQUIRED");
  const verification = verifyRprToolchainComposition(composition, lock);
  if (!verification.ok)
    throw new Error(`RPR_COMMON_TOOLCHAIN_INVALID:${verification.diagnostics.join(",")}`);
  await materializeRprToolchainComposition({
    storeRoot: options.rprRoot,
    lock,
    composition,
    target,
  });
  const projection = await projectRprCommonToolchainToUserBin({ materializationRoot: target });
  return {
    root: target,
    lockId: lock.lockId,
    compositionId: composition.compositionId,
    materialized: true,
    bootstrapped,
    projected: projection.projections.length > 0,
  };
}
