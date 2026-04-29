import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import pMap from "p-map";

import type { RemptsPlugin } from "../api/define-plugin";

function isRemptsPlugin(value: unknown): value is RemptsPlugin {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.apiVersion === 1 && typeof record.name === "string" && typeof record.entry === "string"
  );
}

export interface HostPluginLoadIssue {
  readonly packageName: string;
  readonly reason: string;
  readonly specifier: string;
}

export interface HostPluginLoadSuccess {
  readonly packageName: string;
  readonly plugin: RemptsPlugin;
  readonly specifier: string;
}

export interface InspectPluginsFromHostManifestResult {
  readonly loaded: readonly HostPluginLoadSuccess[];
  readonly rejected: readonly HostPluginLoadIssue[];
}

function readDependencyNames(block: unknown): readonly string[] {
  if (!block || typeof block !== "object") {
    return [];
  }

  return Object.keys(block as Record<string, unknown>).filter((key) => key.length > 0);
}

function readDependencyCandidateListFromManifest(manifest: unknown): readonly string[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }

  const root = manifest as Record<string, unknown>;
  const names = new Set<string>();

  for (const block of [
    root.dependencies,
    root.devDependencies,
    root.optionalDependencies,
    root.peerDependencies,
  ]) {
    for (const name of readDependencyNames(block)) {
      names.add(name);
    }
  }

  return [...names];
}

export function parseHostPluginSpecifier(entry: string): {
  exportName?: string | undefined;
  packageName: string;
} {
  const trimmed = entry.trim();
  const lastColon = trimmed.lastIndexOf(":");

  if (lastColon <= 0) {
    return { packageName: trimmed };
  }

  const before = trimmed.slice(0, lastColon);
  const after = trimmed.slice(lastColon + 1);

  if (after.length === 0) {
    return { packageName: trimmed };
  }

  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    if (slash < 0 || lastColon < slash) {
      return { packageName: trimmed };
    }
  }

  return { exportName: after, packageName: before };
}

function pickPluginExport(mod: Record<string, unknown>, exportName?: string): RemptsPlugin {
  if (exportName) {
    const named = mod[exportName];
    if (!isRemptsPlugin(named)) {
      throw new Error(`Export "${exportName}" is not a valid Rempts plugin.`);
    }

    return named;
  }

  if (isRemptsPlugin(mod.remptsPlugin)) {
    return mod.remptsPlugin;
  }

  if (isRemptsPlugin(mod.rsePlugin)) {
    return mod.rsePlugin;
  }

  if (isRemptsPlugin(mod.default)) {
    return mod.default;
  }

  for (const value of Object.values(mod)) {
    if (isRemptsPlugin(value)) {
      return value;
    }
  }

  throw new Error(
    "No Rempts plugin export found (expected remptsPlugin, rsePlugin, default, or a named plugin object).",
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findNearestPackageJsonPath(startPath: string): Promise<string | null> {
  let dir = dirname(startPath);

  for (;;) {
    const manifestPath = join(dir, "package.json");
    if (await fileExists(manifestPath)) {
      return manifestPath;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function manifestDeclaresRemptsDependency(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== "object") {
    return false;
  }

  const root = manifest as Record<string, unknown>;
  const depBlocks = [
    root.dependencies,
    root.peerDependencies,
    root.devDependencies,
    root.optionalDependencies,
  ];

  return depBlocks.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    return "@reliverse/rempts" in (block as Record<string, unknown>);
  });
}

/**
 * Walks upward from `startDir` to find the nearest directory that has a package.json.
 */
export async function findHostPluginPackageRoot(startDir: string): Promise<string | null> {
  let dir = startDir;

  for (;;) {
    const manifestPath = join(dir, "package.json");
    if (await fileExists(manifestPath)) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

export async function readHostPluginSpecifiers(hostRoot: string): Promise<readonly string[]> {
  const manifestPath = join(hostRoot, "package.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as unknown;
  return readDependencyCandidateListFromManifest(manifest);
}

export function getBunGlobalNodeModulesDirectory(bunInstallRoot?: string): string {
  const root = bunInstallRoot ?? join(homedir(), ".bun");
  return join(root, "install", "global", "node_modules");
}

export function isBunGlobalEntryPath(entryFilePath: string, bunInstallRoot?: string): boolean {
  // Bun global installs live under: ~/.bun/install/global/node_modules/<pkg>/...
  // If the CLI entry is within that tree, we treat plugin resolution as global.
  const globalNodeModules = getBunGlobalNodeModulesDirectory(bunInstallRoot);
  const normalized = globalNodeModules.endsWith("/") ? globalNodeModules : `${globalNodeModules}/`;
  return entryFilePath.startsWith(normalized);
}

export interface LoadPluginsFromHostManifestOptions {
  /**
   * Extra module resolution bases used by require.resolve.
   * Useful for Bun global installs: resolving sibling global packages from
   * ~/.bun/install/global/node_modules isn't possible when resolving from inside
   * a package directory under node_modules without passing explicit paths.
   */
  readonly resolvePaths?: readonly string[] | undefined;
}

/**
 * Resolves each candidate package name from the host root and returns valid plugin objects.
 */
export async function loadPluginsFromHostManifest(
  hostRoot: string,
  specifiers: readonly string[],
  options?: LoadPluginsFromHostManifestOptions,
): Promise<readonly RemptsPlugin[]> {
  const inspected = await inspectPluginsFromHostManifest(hostRoot, specifiers, options);
  if (inspected.rejected.length > 0) {
    const first = inspected.rejected[0];
    throw new Error(first?.reason ?? "Failed to load Rempts plugin package.");
  }

  return inspected.loaded.map((entry) => entry.plugin);
}

export async function inspectPluginsFromHostManifest(
  hostRoot: string,
  specifiers: readonly string[],
  options?: LoadPluginsFromHostManifestOptions,
): Promise<InspectPluginsFromHostManifestResult> {
  const hostPackageJson = join(hostRoot, "package.json");
  if (!(await fileExists(hostPackageJson))) {
    throw new Error(`Missing package.json at host root: ${hostRoot}`);
  }

  const hostRequire = createRequire(hostPackageJson);

  const inspected = await pMap(
    specifiers,
    async (entry) => {
      const { exportName, packageName } = parseHostPluginSpecifier(entry);

      if (packageName.length === 0) {
        return {
          ok: false as const,
          packageName,
          reason: "Empty Rempts plugin package specifier.",
          specifier: entry,
        };
      }

      try {
        const resolved = hostRequire.resolve(
          packageName,
          options?.resolvePaths ? { paths: [...options.resolvePaths] } : undefined,
        );

        const pluginPackageJsonPath = await findNearestPackageJsonPath(resolved);
        if (!pluginPackageJsonPath) {
          throw new Error(
            `Rempts plugin package "${packageName}" is missing a package.json near "${resolved}".`,
          );
        }

        const pluginManifestRaw = await readFile(pluginPackageJsonPath, "utf8");
        const pluginManifest = JSON.parse(pluginManifestRaw) as unknown;
        if (!manifestDeclaresRemptsDependency(pluginManifest)) {
          throw new Error(
            `Rempts plugin package "${packageName}" must declare "@reliverse/rempts" in its package.json (dependencies/peerDependencies/devDependencies/optionalDependencies).`,
          );
        }

        const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
        const plugin = pickPluginExport(mod, exportName);

        return {
          ok: true as const,
          packageName,
          plugin,
          specifier: entry,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false as const,
          packageName,
          reason: `Failed to load Rempts plugin package "${packageName}": ${message}`,
          specifier: entry,
        };
      }
    },
    {
      concurrency: 8,
    },
  );

  return {
    loaded: inspected.filter((entry): entry is HostPluginLoadSuccess & { ok: true } => entry.ok),
    rejected: inspected.filter((entry): entry is HostPluginLoadIssue & { ok: false } => !entry.ok),
  };
}

export interface ResolveHostPluginsResult {
  readonly hostRoot: string | null;
  readonly pluginSpecifiers: readonly string[];
}

export async function resolveHostPluginsFromDirectory(
  cwd: string,
): Promise<ResolveHostPluginsResult> {
  const hostRoot = await findHostPluginPackageRoot(cwd);

  if (!hostRoot) {
    return { hostRoot: null, pluginSpecifiers: [] };
  }

  const pluginSpecifiers = await readHostPluginSpecifiers(hostRoot);
  return { hostRoot, pluginSpecifiers };
}
