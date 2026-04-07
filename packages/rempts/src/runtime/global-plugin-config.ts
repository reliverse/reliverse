import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RemptsGlobalHostConfigV1 {
  readonly version: 1;
  /**
   * Optional Bun install root (equivalent to BUN_INSTALL), used to locate the global
   * node_modules directory for globally installed Rempts plugins.
   *
   * Example: "/home/me/.bun"
   */
  readonly bunInstallRoot?: string | undefined;
  readonly CLIs?: Record<string, { readonly plugins?: readonly string[] | undefined } | undefined> | undefined;
}

export function getDefaultRemptsGlobalConfigPath(): string {
  return join(homedir(), ".reliverse", "rempts", "config.json");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseGlobalConfig(raw: string): RemptsGlobalHostConfigV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
      return null;
    }
    return parsed as RemptsGlobalHostConfigV1;
  } catch {
    return null;
  }
}

export async function readGlobalRemptsConfig(
  configPath = getDefaultRemptsGlobalConfigPath(),
): Promise<RemptsGlobalHostConfigV1 | null> {
  try {
    const raw = await readFile(configPath, "utf8");
    return parseGlobalConfig(raw);
  } catch {
    return null;
  }
}

/**
 * Reads global host plugin specifiers for a program name (e.g. "rse").
 *
 * This is intentionally a *fallback* config source, meant for globally-installed
 * CLIs or "no project" usage. Local project manifests remain the primary source
 * when present.
 */
export async function readGlobalHostPluginSpecifiers(
  cliName: string,
  configPath = getDefaultRemptsGlobalConfigPath(),
): Promise<readonly string[]> {
  try {
    const config = await readGlobalRemptsConfig(configPath);
    if (!config) {
      return [];
    }

    const cli = config.CLIs?.[cliName];
    const plugins = cli?.plugins;
    return isStringArray(plugins) && plugins.length > 0 ? plugins : [];
  } catch {
    return [];
  }
}

