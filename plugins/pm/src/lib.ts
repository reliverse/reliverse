import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type DependencySection =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

export interface PackageManifest {
  readonly catalog?: Record<string, string> | undefined;
  readonly catalogs?: Record<string, Record<string, string>> | undefined;
  readonly name?: string | undefined;
  readonly private?: boolean | undefined;
  readonly version?: string | undefined;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  optionalDependencies?: Record<string, string> | undefined;
  peerDependencies?: Record<string, string> | undefined;
  workspaces?:
    | readonly string[]
    | {
        readonly catalog?: Record<string, string> | undefined;
        readonly catalogs?: Record<string, Record<string, string>> | undefined;
        readonly packages?: readonly string[] | undefined;
      }
    | undefined;
}

export interface PackageInput {
  readonly name: string;
  readonly requestedSpecifier?: string | undefined;
}

export interface TargetContext {
  readonly baseCwd: string;
  readonly installCwd: string;
  readonly repoRootDir: string;
  readonly repoRootManifest: PackageManifest;
  readonly repoRootManifestPath: string;
  readonly targetDir: string;
  readonly targetLabel: string;
  readonly targetManifest: PackageManifest;
  readonly targetManifestPath: string;
  readonly usesCatalog: boolean;
  readonly usesWorkspaces: boolean;
}

export interface ManifestTarget {
  readonly dir: string;
  readonly label: string;
  readonly manifest: PackageManifest;
  readonly manifestPath: string;
}

export interface InstallResult {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ManifestSnapshot {
  readonly path: string;
  readonly text: string;
}

const SECTION_PRIORITY: readonly DependencySection[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const packageMetadataCache = new Map<string, Promise<RegistryPackageMetadata>>();

interface RegistryPackageMetadata {
  readonly latestVersion: string;
  readonly versions: readonly string[];
}

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string | undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isWorkspaceObject(
  workspaces: PackageManifest["workspaces"],
): workspaces is {
  readonly catalog?: Record<string, string> | undefined;
  readonly catalogs?: Record<string, Record<string, string>> | undefined;
  readonly packages?: readonly string[] | undefined;
} {
  return workspaces !== undefined && !Array.isArray(workspaces);
}

interface CatalogContainer {
  readonly defaultCatalog: Record<string, string>;
  readonly location: "top-level" | "workspaces";
  readonly namedCatalogs: Record<string, Record<string, string>>;
}

function ensureObject(
  value: Record<string, string> | undefined,
): Record<string, string> {
  return value ? { ...value } : {};
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortNestedRecord(
  record: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, sortRecord(value)]),
  );
}

function normalizeCatalogName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

export function getCatalogProtocol(name?: string | undefined): string {
  const normalizedName = normalizeCatalogName(name);
  return normalizedName ? `catalog:${normalizedName}` : "catalog:";
}

export function parseCatalogProtocol(
  specifier: string,
): string | undefined | null {
  if (!specifier.startsWith("catalog:")) {
    return null;
  }

  return normalizeCatalogName(specifier.slice("catalog:".length));
}

export function parsePackageInput(input: string): PackageInput {
  const match = /^(?<name>(?:@[^/]+\/)?[^@]+?)(?:@(?<specifier>.+))?$/.exec(input);

  if (!match?.groups?.name) {
    throw new Error(`Invalid package specifier "${input}".`);
  }

  return {
    name: match.groups.name,
    requestedSpecifier: match.groups.specifier,
  };
}

async function readManifest(path: string): Promise<PackageManifest> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as PackageManifest;
}

async function readManifestSnapshot(path: string): Promise<ManifestSnapshot> {
  return {
    path,
    text: await readFile(path, "utf8"),
  };
}

export async function restoreSnapshots(
  snapshots: readonly ManifestSnapshot[],
): Promise<void> {
  await Promise.all(
    snapshots.map((snapshot) => writeFile(snapshot.path, snapshot.text, "utf8")),
  );
}

export async function writeManifest(
  path: string,
  manifest: PackageManifest,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function getWorkspacePatterns(manifest: PackageManifest): readonly string[] {
  const workspaces = manifest.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  return isWorkspaceObject(workspaces) ? workspaces.packages ?? [] : [];
}

function getCatalogContainer(manifest: PackageManifest): CatalogContainer {
  const workspaces = manifest.workspaces;
  const topLevelCatalog = manifest.catalog ? { ...manifest.catalog } : {};
  const topLevelCatalogs = manifest.catalogs
    ? Object.fromEntries(
        Object.entries(manifest.catalogs).map(([name, catalog]) => [
          name,
          { ...catalog },
        ]),
      )
    : {};

  if (Object.keys(topLevelCatalog).length > 0 || Object.keys(topLevelCatalogs).length > 0) {
    return {
      defaultCatalog: topLevelCatalog,
      location: "top-level",
      namedCatalogs: topLevelCatalogs,
    };
  }

  if (isWorkspaceObject(workspaces)) {
    return {
      defaultCatalog: workspaces.catalog ? { ...workspaces.catalog } : {},
      location: "workspaces",
      namedCatalogs: workspaces.catalogs
        ? Object.fromEntries(
            Object.entries(workspaces.catalogs).map(([name, catalog]) => [
              name,
              { ...catalog },
            ]),
          )
        : {},
    };
  }

  return {
    defaultCatalog: {},
    location: "top-level",
    namedCatalogs: {},
  };
}

export function getManifestCatalog(
  manifest: PackageManifest,
  catalogName?: string | undefined,
): Record<string, string> {
  const container = getCatalogContainer(manifest);
  const normalizedName = normalizeCatalogName(catalogName);

  if (!normalizedName) {
    return container.defaultCatalog;
  }

  return container.namedCatalogs[normalizedName]
    ? { ...container.namedCatalogs[normalizedName] }
    : {};
}

export function findCatalogEntry(
  manifest: PackageManifest,
  packageName: string,
  preferredCatalogName?: string | undefined,
): { catalogName?: string | undefined; specifier: string } | null {
  const container = getCatalogContainer(manifest);
  const normalizedName = normalizeCatalogName(preferredCatalogName);

  if (normalizedName) {
    const namedCatalog = container.namedCatalogs[normalizedName];

    if (namedCatalog?.[packageName]) {
      return {
        catalogName: normalizedName,
        specifier: namedCatalog[packageName],
      };
    }

    return null;
  }

  if (container.defaultCatalog[packageName]) {
    return {
      catalogName: undefined,
      specifier: container.defaultCatalog[packageName],
    };
  }

  for (const [catalogName, catalog] of Object.entries(container.namedCatalogs)) {
    if (catalog[packageName]) {
      return {
        catalogName,
        specifier: catalog[packageName],
      };
    }
  }

  return null;
}

function setCatalog(
  manifest: PackageManifest,
  catalog: Record<string, string>,
  catalogs: Record<string, Record<string, string>>,
  catalogName?: string | undefined,
): PackageManifest {
  const workspaces = manifest.workspaces;
  const container = getCatalogContainer(manifest);
  const normalizedName = normalizeCatalogName(catalogName);
  const nextCatalogs = { ...catalogs };

  if (normalizedName && !nextCatalogs[normalizedName]) {
    nextCatalogs[normalizedName] = {};
  }

  if (container.location === "workspaces") {
    return {
      ...manifest,
      workspaces: {
        catalog: sortRecord(catalog),
        catalogs: sortNestedRecord(nextCatalogs),
        packages: isWorkspaceObject(workspaces) ? workspaces.packages ?? [] : [],
      },
    };
  }

  return {
    ...manifest,
    catalog: sortRecord(catalog),
    catalogs: sortNestedRecord(nextCatalogs),
  };
}

async function findNearestPackageDir(startDir: string): Promise<string | null> {
  let currentDir = resolve(startDir);

  while (true) {
    if (await pathExists(join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

async function findWorkspaceRoot(
  startDir: string,
): Promise<{ dir: string; manifest: PackageManifest; manifestPath: string } | null> {
  let currentDir = resolve(startDir);

  while (true) {
    const manifestPath = join(currentDir, "package.json");

    if (await pathExists(manifestPath)) {
      const manifest = await readManifest(manifestPath);

      if (getWorkspacePatterns(manifest).length > 0) {
        return {
          dir: currentDir,
          manifest,
          manifestPath,
        };
      }
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function toManifestGlobPattern(pattern: string): string {
  const trimmed = pattern.trim().replace(/\/+$/, "");

  if (trimmed.endsWith("package.json")) {
    return trimmed;
  }

  return `${trimmed}/package.json`;
}

async function listWorkspaceDirectories(
  rootDir: string,
  patterns: readonly string[],
): Promise<string[]> {
  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const pattern of patterns) {
    const isNegative = pattern.startsWith("!");
    const manifestPattern = toManifestGlobPattern(
      isNegative ? pattern.slice(1) : pattern,
    );
    const glob = new Bun.Glob(manifestPattern);

    for await (const match of glob.scan({
      absolute: true,
      cwd: rootDir,
      dot: false,
    })) {
      const directory = dirname(match);

      if (isNegative) {
        excluded.add(directory);
      } else {
        included.add(directory);
      }
    }
  }

  return [...included]
    .filter((directory) => !excluded.has(directory))
    .sort((left, right) => left.localeCompare(right));
}

async function findWorkspaceTarget(
  repoRootDir: string,
  repoRootManifest: PackageManifest,
  target: string,
): Promise<string | null> {
  const directories = await listWorkspaceDirectories(
    repoRootDir,
    getWorkspacePatterns(repoRootManifest),
  );

  for (const directory of directories) {
    const manifestPath = join(directory, "package.json");
    const manifest = await readManifest(manifestPath);
    const relativePath = relative(repoRootDir, directory);

    if (manifest.name === target || relativePath === target) {
      return directory;
    }
  }

  return null;
}

export async function resolveTargetContext(options: {
  readonly cwd?: string | undefined;
  readonly target?: string | undefined;
}): Promise<TargetContext> {
  const baseCwd = resolve(options.cwd ?? ".");
  const nearestPackageDir = await findNearestPackageDir(baseCwd);

  if (!nearestPackageDir) {
    throw new Error(
      `No package.json found from "${baseCwd}" upward. Pass --cwd to a repo or workspace root.`,
    );
  }

  const workspaceRoot = await findWorkspaceRoot(baseCwd);
  const repoRootDir = workspaceRoot?.dir ?? nearestPackageDir;
  const repoRootManifestPath = workspaceRoot?.manifestPath ?? join(repoRootDir, "package.json");
  const repoRootManifest = workspaceRoot?.manifest ?? (await readManifest(repoRootManifestPath));
  const usesWorkspaces = getWorkspacePatterns(repoRootManifest).length > 0;

  let targetDir = nearestPackageDir;

  if (options.target) {
    const directPath = resolve(baseCwd, options.target);
    const manifestPath = directPath.endsWith("package.json")
      ? directPath
      : join(directPath, "package.json");

    if (await pathExists(manifestPath)) {
      targetDir = dirname(manifestPath);
    } else {
      const repoRelativePath = join(repoRootDir, options.target);

      if (await pathExists(join(repoRelativePath, "package.json"))) {
        targetDir = repoRelativePath;
      } else if (usesWorkspaces) {
        const workspaceTarget = await findWorkspaceTarget(
          repoRootDir,
          repoRootManifest,
          options.target,
        );

        if (!workspaceTarget) {
          throw new Error(
            `Target "${options.target}" was not found. Pass a workspace path like "packages/rempts" or a known workspace package name.`,
          );
        }

        targetDir = workspaceTarget;
      } else {
        throw new Error(
          `Target "${options.target}" does not contain a package.json. Pass --target to a package directory.`,
        );
      }
    }
  }

  const targetManifestPath = join(targetDir, "package.json");

  if (!(await pathExists(targetManifestPath))) {
    throw new Error(`Target package.json was not found at "${targetManifestPath}".`);
  }

  const targetManifest = await readManifest(targetManifestPath);
  const targetLabel =
    relative(repoRootDir, targetDir) || targetManifest.name || targetDir;

  return {
    baseCwd,
    installCwd: usesWorkspaces ? repoRootDir : targetDir,
    repoRootDir,
    repoRootManifest,
    repoRootManifestPath,
    targetDir,
    targetLabel,
    targetManifest,
    targetManifestPath,
    usesCatalog: usesWorkspaces && targetDir !== repoRootDir,
    usesWorkspaces,
  };
}

export function getRequestedSection(flags: {
  readonly dev?: boolean | undefined;
  readonly optional?: boolean | undefined;
  readonly peer?: boolean | undefined;
}): DependencySection {
  const selected = [
    flags.dev ? "devDependencies" : null,
    flags.peer ? "peerDependencies" : null,
    flags.optional ? "optionalDependencies" : null,
  ].filter((value): value is DependencySection => value !== null);

  if (selected.length > 1) {
    throw new Error("Choose only one of --dev, --peer, or --optional.");
  }

  return selected[0] ?? "dependencies";
}

export function findDependencyLocation(
  manifest: PackageManifest,
  packageName: string,
): { section: DependencySection; specifier: string } | null {
  for (const section of SECTION_PRIORITY) {
    const dependencies = manifest[section];
    const specifier = dependencies?.[packageName];

    if (specifier) {
      return {
        section,
        specifier,
      };
    }
  }

  return null;
}

export function listTargetDependencies(manifest: PackageManifest): readonly string[] {
  return [...new Set(
    SECTION_PRIORITY.flatMap((section) => Object.keys(manifest[section] ?? {})),
  )].sort((left, right) => left.localeCompare(right));
}

export function getCatalogSpecifier(
  context: TargetContext,
  packageName: string,
  catalogName?: string | undefined,
): string | undefined {
  return getManifestCatalog(context.repoRootManifest, catalogName)[packageName];
}

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const metadata = await fetchRegistryPackageMetadata(packageName);
  return metadata.latestVersion;
}

async function fetchRegistryPackageMetadata(
  packageName: string,
  options?: { readonly force?: boolean | undefined },
): Promise<RegistryPackageMetadata> {
  if (options?.force !== true) {
    const cached = packageMetadataCache.get(packageName);

    if (cached) {
      return cached;
    }
  }

  const request = (async () => {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to resolve package metadata for "${packageName}" from npm (${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      readonly versions?: Record<string, unknown> | undefined;
      readonly "dist-tags"?: { readonly latest?: string | undefined } | undefined;
    };
    const versions = Object.keys(payload.versions ?? {}).sort(Bun.semver.order);
    const latestVersion = payload["dist-tags"]?.latest;

    if (!latestVersion) {
      throw new Error(`Registry metadata for "${packageName}" did not include dist-tags.latest.`);
    }

    return {
      latestVersion,
      versions,
    };
  })();

  if (options?.force !== true) {
    packageMetadataCache.set(packageName, request);
  }

  return request;
}

function isPinnedVersionSpecifier(specifier: string): boolean {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(specifier);
}

function isMutableRangeSpecifier(specifier: string): boolean {
  return specifier.startsWith("^") || specifier.startsWith("~");
}

function parseSemver(version: string): ParsedSemver | null {
  const match =
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );

  if (!match?.groups?.major || !match.groups.minor || !match.groups.patch) {
    return null;
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease,
  };
}

function extractBaseSpecifierVersion(specifier: string): string | null {
  const normalized = specifier.trim();

  if (normalized.startsWith("^") || normalized.startsWith("~")) {
    return normalized.slice(1);
  }

  return normalized;
}

function resolveSmartBranchVersion(options: {
  readonly currentSpecifier: string;
  readonly metadata: RegistryPackageMetadata;
}): string | null {
  const baseVersion = extractBaseSpecifierVersion(options.currentSpecifier);

  if (!baseVersion) {
    return null;
  }

  const parsedBase = parseSemver(baseVersion);

  if (!parsedBase?.prerelease) {
    return null;
  }

  const branchCandidates = options.metadata.versions.filter((version) => {
    const parsedVersion = parseSemver(version);

    if (!parsedVersion) {
      return false;
    }

    return (
      parsedVersion.major === parsedBase.major &&
      parsedVersion.minor === parsedBase.minor &&
      parsedVersion.patch === parsedBase.patch
    );
  });

  if (branchCandidates.length === 0) {
    return null;
  }

  const stableCandidate = branchCandidates.find(
    (version) => parseSemver(version)?.prerelease === undefined,
  );

  if (stableCandidate) {
    return stableCandidate;
  }

  return branchCandidates.at(-1) ?? null;
}

function findLatestStableVersion(metadata: RegistryPackageMetadata): string | null {
  for (let index = metadata.versions.length - 1; index >= 0; index -= 1) {
    const candidate = metadata.versions[index];

    if (candidate && parseSemver(candidate)?.prerelease === undefined) {
      return candidate;
    }
  }

  return null;
}

export async function resolveUpdateVersion(options: {
  readonly currentSpecifier: string;
  readonly force?: boolean | undefined;
  readonly latest?: boolean | undefined;
  readonly packageName: string;
  readonly smart?: boolean | undefined;
}): Promise<string> {
  const metadata = await fetchRegistryPackageMetadata(options.packageName, {
    force: options.force,
  });

  if (options.smart === true) {
    if (options.latest) {
      const latestStableVersion = findLatestStableVersion(metadata);

      if (latestStableVersion) {
        return latestStableVersion;
      }
    } else {
      const smartBranchVersion = resolveSmartBranchVersion({
        currentSpecifier: options.currentSpecifier,
        metadata,
      });

      if (smartBranchVersion) {
        return smartBranchVersion;
      }
    }
  }

  if (options.latest) {
    return metadata.latestVersion;
  }

  if (
    !isMutableRangeSpecifier(options.currentSpecifier) &&
    !isPinnedVersionSpecifier(options.currentSpecifier)
  ) {
    return metadata.latestVersion;
  }

  const satisfyingVersions = metadata.versions.filter((version) =>
    Bun.semver.satisfies(version, options.currentSpecifier),
  );

  return satisfyingVersions.at(-1) ?? metadata.latestVersion;
}

export function canRewriteSpecifier(specifier: string): boolean {
  return isMutableRangeSpecifier(specifier) || isPinnedVersionSpecifier(specifier);
}

export function createUpdatedSpecifier(options: {
  readonly currentSpecifier: string;
  readonly version: string;
}): string {
  if (!canRewriteSpecifier(options.currentSpecifier)) {
    return options.currentSpecifier;
  }

  return applyVersionStyle(options.currentSpecifier, options.version);
}

export function applyVersionStyle(currentSpecifier: string, version: string): string {
  if (currentSpecifier.startsWith("~")) {
    return `~${version}`;
  }

  if (currentSpecifier.startsWith("^")) {
    return `^${version}`;
  }

  return version;
}

export function createDesiredSpecifier(options: {
  readonly exact?: boolean | undefined;
  readonly requestedSpecifier?: string | undefined;
  readonly version: string;
}): string {
  if (options.requestedSpecifier) {
    return options.requestedSpecifier;
  }

  return options.exact ? options.version : `^${options.version}`;
}

async function runBunCommand(
  cwd: string,
  args: readonly string[],
): Promise<InstallResult> {
  const processHandle = Bun.spawn([process.execPath, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);

  return {
    command: `bun ${args.join(" ")}`,
    cwd,
    exitCode,
    ok: exitCode === 0,
    stderr,
    stdout,
  };
}

export async function runBunInstall(
  cwd: string,
  options?: { readonly force?: boolean | undefined },
): Promise<InstallResult> {
  return runBunCommand(cwd, [
    "install",
    ...(options?.force ? ["--force"] : []),
  ]);
}

export async function runBunUpdate(
  cwd: string,
  options?: {
    readonly force?: boolean | undefined;
    readonly latest?: boolean | undefined;
    readonly packages?: readonly string[] | undefined;
    readonly recursive?: boolean | undefined;
  },
): Promise<InstallResult> {
  return runBunCommand(cwd, [
    "update",
    ...(options?.force ? ["--force"] : []),
    ...(options?.latest ? ["--latest"] : []),
    ...(options?.recursive ? ["--recursive"] : []),
    ...(options?.packages ?? []),
  ]);
}

export function cloneManifest(manifest: PackageManifest): PackageManifest {
  return JSON.parse(JSON.stringify(manifest)) as PackageManifest;
}

export function setDependency(
  manifest: PackageManifest,
  section: DependencySection,
  packageName: string,
  specifier: string,
): PackageManifest {
  const nextManifest = cloneManifest(manifest);
  const nextSection = ensureObject(nextManifest[section]);

  nextSection[packageName] = specifier;
  nextManifest[section] = sortRecord(nextSection);

  return nextManifest;
}

export function setCatalogEntry(
  manifest: PackageManifest,
  packageName: string,
  specifier: string,
  catalogName?: string | undefined,
): PackageManifest {
  const container = getCatalogContainer(manifest);
  const normalizedName = normalizeCatalogName(catalogName);
  const nextDefaultCatalog = { ...container.defaultCatalog };
  const nextNamedCatalogs = Object.fromEntries(
    Object.entries(container.namedCatalogs).map(([name, catalog]) => [
      name,
      { ...catalog },
    ]),
  ) as Record<string, Record<string, string>>;

  if (normalizedName) {
    const currentCatalog = nextNamedCatalogs[normalizedName] ?? {};
    nextNamedCatalogs[normalizedName] = {
      ...currentCatalog,
      [packageName]: specifier,
    };
  } else {
    nextDefaultCatalog[packageName] = specifier;
  }

  return setCatalog(manifest, nextDefaultCatalog, nextNamedCatalogs, normalizedName);
}

export function isWorkspaceProtocol(specifier: string): boolean {
  return specifier.startsWith("workspace:");
}

export function isCatalogProtocol(specifier: string): boolean {
  return specifier.startsWith("catalog:");
}

export async function listManifestTargets(
  context: TargetContext,
  options?: { readonly includeWorkspacePackages?: boolean | undefined },
): Promise<readonly ManifestTarget[]> {
  const targets: ManifestTarget[] = [
    {
      dir: context.targetDir,
      label: context.targetLabel,
      manifest: context.targetManifest,
      manifestPath: context.targetManifestPath,
    },
  ];

  if (
    !options?.includeWorkspacePackages ||
    !context.usesWorkspaces ||
    context.targetDir !== context.repoRootDir
  ) {
    return targets;
  }

  const workspaceDirectories = await listWorkspaceDirectories(
    context.repoRootDir,
    getWorkspacePatterns(context.repoRootManifest),
  );

  for (const directory of workspaceDirectories) {
    const manifestPath = join(directory, "package.json");

    if (manifestPath === context.targetManifestPath) {
      continue;
    }

    const manifest = await readManifest(manifestPath);

    targets.push({
      dir: directory,
      label: relative(context.repoRootDir, directory) || manifest.name || directory,
      manifest,
      manifestPath,
    });
  }

  return targets;
}

export async function collectSnapshots(
  paths: readonly string[],
): Promise<readonly ManifestSnapshot[]> {
  return Promise.all(paths.map((path) => readManifestSnapshot(path)));
}
