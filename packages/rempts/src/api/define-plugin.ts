import type { CommandOptionsRecord } from "@reliverse/parser";

import { RemptsUsageError } from "../runtime/errors";
import { resolveEntry } from "../runtime/resolve-entry";

export const REMPTS_PLUGIN_API_VERSION = 1;

export interface RemptsPlugin {
  readonly apiVersion: typeof REMPTS_PLUGIN_API_VERSION;
  readonly capabilities?: readonly string[] | undefined;
  readonly description?: string | undefined;
  readonly entry: string;
  readonly name: string;
  readonly options?: CommandOptionsRecord | undefined;
  readonly provides?: readonly string[] | undefined;
}

function assertValidSegment(segment: string, path: readonly string[]): void {
  if (segment.length === 0) {
    throw new RemptsUsageError(
      `Plugin command path "${path.join(" ")}" contains an empty segment.`,
    );
  }

  if (segment.startsWith("-")) {
    throw new RemptsUsageError(
      `Plugin command path "${path.join(" ")}" contains invalid segment "${segment}".`,
    );
  }
}

export function definePlugin(plugin: RemptsPlugin): RemptsPlugin {
  assertValidSegment(plugin.name, [plugin.name]);
  if (plugin.apiVersion !== REMPTS_PLUGIN_API_VERSION) {
    throw new RemptsUsageError(
      `Unsupported Rempts plugin apiVersion "${String(plugin.apiVersion)}" for plugin "${plugin.name}". Expected ${REMPTS_PLUGIN_API_VERSION}.`,
    );
  }
  resolveEntry(plugin.entry);

  return {
    apiVersion: plugin.apiVersion,
    capabilities: plugin.capabilities ? [...plugin.capabilities] : undefined,
    description: plugin.description,
    entry: plugin.entry,
    name: plugin.name,
    options: plugin.options ? { ...plugin.options } : undefined,
    provides: plugin.provides ? [...plugin.provides] : undefined,
  };
}
