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
  return typeof record.id === "string" && Array.isArray(record.commands);
}

function readDependencyCandidateListFromManifest(manifest: unknown): readonly string[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }

  const root = manifest as Record<string, unknown>;
  const dependencies = root.dependencies;
  const devDependencies = root.devDependencies;

  const names: string[] = [];

  if (dependencies && typeof dependencies === "object") {
    for (const key of Object.keys(dependencies as Record<string, unknown>)) {
      if (typeof key === "string" && key.length > 0) {
        names.push(key);
      }
    }
  }

  if (devDependencies && typeof devDependencies === "object") {
    for (const key of Object.keys(devDependencies as Record<string, unknown>)) {
      if (typeof key === "string" && key.length > 0 && !names.includes(key)) {
        names.push(key);
      }
    }
  }

  return names;
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
  const depBlocks = [root.dependencies, root.peerDependencies, root.devDependencies];
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
  const hostPackageJson = join(hostRoot, "package.json");
  if (!(await fileExists(hostPackageJson))) {
    throw new Error(`Missing package.json at host root: ${hostRoot}`);
  }

  const hostRequire = createRequire(hostPackageJson);

  return pMap(
    specifiers,
    async (entry) => {
      const { exportName, packageName } = parseHostPluginSpecifier(entry);
      let resolved: string;

      try {
        resolved = hostRequire.resolve(
          packageName,
          options?.resolvePaths ? { paths: [...options.resolvePaths] } : undefined,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot resolve Rempts plugin package "${packageName}": ${message}`);
      }

      const pluginPackageJsonPath = await findNearestPackageJsonPath(resolved);
      if (!pluginPackageJsonPath) {
        throw new Error(
          `Rempts plugin package "${packageName}" is missing a package.json near "${resolved}".`,
        );
      }

      try {
        const pluginManifestRaw = await readFile(pluginPackageJsonPath, "utf8");
        const pluginManifest = JSON.parse(pluginManifestRaw) as unknown;
        if (!manifestDeclaresRemptsDependency(pluginManifest)) {
          throw new Error(
            `Rempts plugin package "${packageName}" must declare "@reliverse/rempts" in its package.json (dependencies/peerDependencies/devDependencies).`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to validate Rempts plugin package "${packageName}" manifest: ${message}`,
        );
      }

      try {
        const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
        return pickPluginExport(mod, exportName);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load Rempts plugin package "${packageName}": ${message}`);
      }
    },
    {
      concurrency: 8,
    },
  );
}

export interface ResolveHostPluginsResult {
  readonly hostRoot: string | null;
  readonly pluginSpecifiers: readonly string[];
}

export async function resolveHostPluginsFromDirectory(cwd: string): Promise<ResolveHostPluginsResult> {
  const hostRoot = await findHostPluginPackageRoot(cwd);

  if (!hostRoot) {
    return { hostRoot: null, pluginSpecifiers: [] };
  }

  const pluginSpecifiers = await readHostPluginSpecifiers(hostRoot);
  return { hostRoot, pluginSpecifiers };
}
