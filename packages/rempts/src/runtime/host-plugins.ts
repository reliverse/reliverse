import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { RemptsPlugin } from "../api/define-plugin";

function isRemptsPlugin(value: unknown): value is RemptsPlugin {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && Array.isArray(record.commands);
}

function readPluginSpecifierListFromManifest(manifest: unknown): readonly string[] | null {
  if (!manifest || typeof manifest !== "object") {
    return null;
  }

  const root = manifest as Record<string, unknown>;

  for (const blockKey of ["rempts", "rse"] as const) {
    const block = root[blockKey];
    if (!block || typeof block !== "object" || block === null) {
      continue;
    }

    const plugins = (block as { plugins?: unknown }).plugins;
    if (
      Array.isArray(plugins) &&
      plugins.length > 0 &&
      plugins.every((item): item is string => typeof item === "string")
    ) {
      return plugins;
    }
  }

  return null;
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

function pickPluginExport(mod: Record<string, unknown>, exportName?: string | undefined): RemptsPlugin {
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

/**
 * Walks upward from `startDir` to find the nearest package.json that defines a non-empty
 * `rempts.plugins` or `rse.plugins` list.
 */
export async function findHostPluginPackageRoot(startDir: string): Promise<string | null> {
  let dir = startDir;

  for (;;) {
    const manifestPath = join(dir, "package.json");
    if (await fileExists(manifestPath)) {
      try {
        const raw = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(raw) as unknown;
        const list = readPluginSpecifierListFromManifest(manifest);

        if (list) {
          return dir;
        }
      } catch {
        // ignore invalid JSON and keep walking
      }
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
  const list = readPluginSpecifierListFromManifest(manifest);
  return list ?? [];
}

/**
 * Resolves each package name from the host manifest's directory and returns plugin objects.
 */
export async function loadPluginsFromHostManifest(
  hostRoot: string,
  specifiers: readonly string[],
): Promise<readonly RemptsPlugin[]> {
  const hostPackageJson = join(hostRoot, "package.json");
  if (!(await fileExists(hostPackageJson))) {
    throw new Error(`Missing package.json at host root: ${hostRoot}`);
  }

  const hostRequire = createRequire(hostPackageJson);
  const plugins: RemptsPlugin[] = [];

  for (const entry of specifiers) {
    const { exportName, packageName } = parseHostPluginSpecifier(entry);
    let resolved: string;

    try {
      resolved = hostRequire.resolve(packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot resolve Rempts plugin package "${packageName}": ${message}`);
    }

    const mod = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    plugins.push(pickPluginExport(mod, exportName));
  }

  return plugins;
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
