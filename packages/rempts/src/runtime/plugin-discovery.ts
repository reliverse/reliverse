import type { RemptsPlugin } from "../api/define-plugin";
import type { CommandOptionsRecord } from "../options/types";
import { RemptsUsageError } from "./errors";
import {
  readGlobalHostPluginSpecifiers,
  readGlobalRemptsConfig,
  getDefaultRemptsGlobalConfigPath,
} from "./global-plugin-config";
import {
  getBunGlobalNodeModulesDirectory,
  inspectPluginsFromHostManifest,
  isBunGlobalEntryPath,
  resolveHostPluginsFromDirectory,
} from "./host-plugins";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  const pattern = `^${glob.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(pattern);
}

export function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

export interface ResolveDiscoveredPluginsOptions {
  readonly allowedPatterns: readonly string[];
  readonly cliName: string;
  readonly conflictPriority?: readonly string[] | undefined;
  readonly cwd: string;
  readonly entryDirectory: string;
  readonly entryFilePath: string;
}

export interface PluginConflictPriorityMatch {
  readonly index: number;
  readonly kind: "exact-package" | "pattern";
  readonly rule: string;
}

export interface PluginDiscoveryLoadedPlugin {
  readonly apiVersion: number;
  readonly capabilities?: readonly string[] | undefined;
  readonly description?: string | undefined;
  readonly entry: string;
  readonly options?: CommandOptionsRecord | undefined;
  readonly packageName: string;
  readonly pluginName: string;
  readonly priorityMatch?: PluginConflictPriorityMatch | undefined;
  readonly provides?: readonly string[] | undefined;
  readonly source: "global-config" | "local-manifest";
  readonly specifier: string;
}

export interface PluginDiscoveryRejectedPlugin {
  readonly packageName: string;
  readonly reason: string;
  readonly source: "global-config" | "local-manifest";
  readonly specifier: string;
}

export interface PluginDiscoveryIgnoredSpecifier {
  readonly reason: string;
  readonly source: "global-config" | "local-manifest";
  readonly specifier: string;
}

export interface PluginDiscoveryReport {
  readonly allowedPatterns: readonly string[];
  readonly cliName: string;
  readonly configPath: string;
  readonly conflictPriority: readonly string[];
  readonly globalConfigSpecifiers: readonly string[];
  readonly globalEntry: boolean;
  readonly hostRoot: string | null;
  readonly hostSearchRoot: string;
  readonly ignored: readonly PluginDiscoveryIgnoredSpecifier[];
  readonly localManifestSpecifiers: readonly string[];
  readonly loaded: readonly PluginDiscoveryLoadedPlugin[];
  readonly rejected: readonly PluginDiscoveryRejectedPlugin[];
}

export function matchConflictPriorityRule(
  packageName: string,
  conflictPriority: readonly string[],
): PluginConflictPriorityMatch | undefined {
  for (const [index, rule] of conflictPriority.entries()) {
    if (rule === packageName) {
      return { index, kind: "exact-package", rule };
    }

    if (matchesAnyGlob(packageName, [rule])) {
      return { index, kind: "pattern", rule };
    }
  }

  return undefined;
}

function sortLoadedPlugins(
  entries: readonly PluginDiscoveryLoadedPlugin[],
): readonly PluginDiscoveryLoadedPlugin[] {
  return [...entries].sort((left, right) => {
    const leftIndex = left.priorityMatch?.index ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.priorityMatch?.index ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    return left.packageName.localeCompare(right.packageName);
  });
}

function createConfigError(): RemptsUsageError {
  return new RemptsUsageError(
    [
      "plugins is configured, but plugins.allowedPatterns is empty.",
      "",
      "Rempts plugin discovery runs in strict mode. Scanning all dependencies/devDependencies is not supported",
      "because most dependencies are not plugins and would fail strict validation.",
      "",
      "Fix: provide an allowlist of plugin package globs, e.g.:",
      '  plugins: { allowedPatterns: ["@reliverse/*-rse-plugin"] }',
      "",
      "Alternatively, configure global host plugins:",
      `  ${getDefaultRemptsGlobalConfigPath()}`,
    ].join("\n"),
    1,
  );
}

function toLoadedPlugins(
  source: "global-config" | "local-manifest",
  entries: readonly { packageName: string; plugin: RemptsPlugin; specifier: string }[],
  conflictPriority: readonly string[],
): readonly PluginDiscoveryLoadedPlugin[] {
  return entries.map((entry) => ({
    apiVersion: entry.plugin.apiVersion,
    capabilities: entry.plugin.capabilities,
    description: entry.plugin.description,
    entry: entry.plugin.entry,
    options: entry.plugin.options,
    packageName: entry.packageName,
    pluginName: entry.plugin.name,
    priorityMatch: matchConflictPriorityRule(entry.packageName, conflictPriority),
    provides: entry.plugin.provides,
    source,
    specifier: entry.specifier,
  }));
}

function toRejectedPlugins(
  source: "global-config" | "local-manifest",
  entries: readonly { packageName: string; reason: string; specifier: string }[],
): readonly PluginDiscoveryRejectedPlugin[] {
  return entries.map((entry) => ({
    packageName: entry.packageName,
    reason: entry.reason,
    source,
    specifier: entry.specifier,
  }));
}

export async function inspectPluginDiscovery(
  options: ResolveDiscoveredPluginsOptions,
): Promise<PluginDiscoveryReport> {
  if (options.allowedPatterns.length === 0) {
    throw createConfigError();
  }

  const globalConfig = await readGlobalRemptsConfig();
  const conflictPriority = options.conflictPriority ?? [];
  const bunInstallRoot = globalConfig?.bunInstallRoot;
  const bunGlobalNodeModules = getBunGlobalNodeModulesDirectory(bunInstallRoot);
  const globalEntry = isBunGlobalEntryPath(options.entryFilePath, bunInstallRoot);
  const hostSearchRoot = globalEntry ? options.entryDirectory : options.cwd;

  try {
    const { hostRoot, pluginSpecifiers } = await resolveHostPluginsFromDirectory(hostSearchRoot);
    const localCandidates = hostRoot
      ? pluginSpecifiers.filter((name) => matchesAnyGlob(name, options.allowedPatterns))
      : [];
    const localIgnored = pluginSpecifiers
      .filter((name) => !matchesAnyGlob(name, options.allowedPatterns))
      .map((specifier) => ({
        reason: "Package name does not match this CLI's plugins.allowedPatterns.",
        source: "local-manifest" as const,
        specifier,
      }));
    const localLoaded =
      hostRoot && localCandidates.length > 0
        ? await inspectPluginsFromHostManifest(hostRoot, localCandidates, {
            resolvePaths: globalEntry ? [bunGlobalNodeModules] : undefined,
          })
        : { loaded: [], rejected: [] };

    const globalConfigSpecifiers =
      localLoaded.loaded.length > 0 ? [] : await readGlobalHostPluginSpecifiers(options.cliName);
    const globalRejectedByPattern = globalConfigSpecifiers
      .filter((name) => !matchesAnyGlob(name, options.allowedPatterns))
      .map((specifier) => ({
        packageName: specifier,
        reason: `Global plugin config entry \"${specifier}\" is not allowed by this CLI's plugins.allowedPatterns.`,
        specifier,
      }));

    const allowedGlobalSpecifiers = globalConfigSpecifiers.filter((name) =>
      matchesAnyGlob(name, options.allowedPatterns),
    );
    const globalLoaded =
      allowedGlobalSpecifiers.length > 0
        ? await inspectPluginsFromHostManifest(hostRoot ?? hostSearchRoot, allowedGlobalSpecifiers, {
            resolvePaths: [bunGlobalNodeModules],
          })
        : { loaded: [], rejected: [] };

    return {
      allowedPatterns: [...options.allowedPatterns],
      cliName: options.cliName,
      configPath: getDefaultRemptsGlobalConfigPath(),
      conflictPriority: [...conflictPriority],
      globalConfigSpecifiers,
      globalEntry,
      hostRoot,
      hostSearchRoot,
      ignored: localIgnored,
      localManifestSpecifiers: pluginSpecifiers,
      loaded: sortLoadedPlugins([
        ...toLoadedPlugins("global-config", globalLoaded.loaded, conflictPriority),
        ...toLoadedPlugins("local-manifest", localLoaded.loaded, conflictPriority),
      ]),
      rejected: [
        ...toRejectedPlugins("global-config", globalRejectedByPattern),
        ...toRejectedPlugins("global-config", globalLoaded.rejected),
        ...toRejectedPlugins("local-manifest", localLoaded.rejected),
      ],
    };
  } catch (error) {
    if (error instanceof RemptsUsageError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new RemptsUsageError(`Failed to inspect Rempts host plugins: ${message}`, 1);
  }
}

export async function resolveDiscoveredPlugins(
  options: ResolveDiscoveredPluginsOptions,
): Promise<readonly RemptsPlugin[]> {
  const report = await inspectPluginDiscovery(options);
  return resolvePluginsFromReport(report);
}

export function resolvePluginsFromReport(
  report: PluginDiscoveryReport,
): readonly RemptsPlugin[] {

  const disallowedGlobal = report.rejected.filter(
    (entry) => entry.source === "global-config" && entry.reason.includes("not allowed by this CLI's plugins.allowedPatterns"),
  );

  if (disallowedGlobal.length > 0) {
    throw new RemptsUsageError(
      [
        "Global plugin config contains entries that are not allowed by this CLI's allowedPatterns.",
        "",
        `Config: ${report.configPath}`,
        `CLI: ${report.cliName}`,
        "",
        "Not allowed:",
        ...disallowedGlobal.map((entry) => `- ${entry.specifier}`),
        "",
        "Fix: remove these entries or adjust plugins.allowedPatterns in the CLI.",
      ].join("\n"),
      1,
    );
  }

  const loadFailure = report.rejected.find((entry) => !entry.reason.includes("not allowed by this CLI's plugins.allowedPatterns"));
  if (loadFailure) {
    throw new RemptsUsageError(`Failed to load Rempts host plugins: ${loadFailure.reason}`, 1);
  }

  return report.loaded.map((entry) => ({
    apiVersion: entry.apiVersion as 1,
    capabilities: entry.capabilities,
    description: entry.description,
    entry: entry.entry,
    name: entry.pluginName,
    options: entry.options,
    provides: entry.provides,
  }));
}
