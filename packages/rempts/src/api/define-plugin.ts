import type { CommandOptionsRecord } from "@reliverse/parser";

import { RemptsUsageError } from "../runtime/errors";
import { resolveEntry } from "../runtime/resolve-entry";
import type { CommandDefinition } from "./define-command";

export const REMPTS_PLUGIN_API_VERSION = 1;

export type RemptsJsonSchema = boolean | { readonly [key: string]: unknown };

export interface RemptsPluginConfigContribution {
    /** JSON Schema fragment merged into the root Rse config schema. */
    readonly schema?: RemptsJsonSchema | undefined;
    /** Optional default values used by config generators. */
    readonly defaults?: Record<string, unknown> | undefined;
}

export interface RemptsPlugin {
    readonly apiVersion: typeof REMPTS_PLUGIN_API_VERSION;
    readonly capabilities?: readonly string[] | undefined;
    readonly commands?: readonly RemptsPluginCommand[] | undefined;
    readonly config?: RemptsPluginConfigContribution | undefined;
    readonly description?: string | undefined;
    readonly entry: string;
    readonly name: string;
    readonly options?: CommandOptionsRecord | undefined;
    readonly provides?: readonly string[] | undefined;
}

export interface RemptsPluginCommand {
    readonly command: CommandDefinition<any>;
    readonly path: readonly string[];
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
    for (const command of plugin.commands ?? []) {
        if (command.path.length === 0) {
            throw new RemptsUsageError(
                `Plugin command path for "${plugin.name}" cannot be empty.`,
            );
        }

        for (const segment of command.path) {
            assertValidSegment(segment, command.path);
        }
    }

    if (plugin.apiVersion !== REMPTS_PLUGIN_API_VERSION) {
        throw new RemptsUsageError(
            `Unsupported Rempts plugin apiVersion "${String(plugin.apiVersion)}" for plugin "${plugin.name}". Expected ${REMPTS_PLUGIN_API_VERSION}.`,
        );
    }
    resolveEntry(plugin.entry);

    return {
        apiVersion: plugin.apiVersion,
        capabilities: plugin.capabilities
            ? [...plugin.capabilities]
            : undefined,
        commands: plugin.commands
            ? plugin.commands.map((command) => ({
                  command: command.command,
                  path: [...command.path],
              }))
            : undefined,
        config: plugin.config
            ? {
                  defaults: plugin.config.defaults
                      ? { ...plugin.config.defaults }
                      : undefined,
                  schema: plugin.config.schema,
              }
            : undefined,
        description: plugin.description,
        entry: plugin.entry,
        name: plugin.name,
        options: plugin.options ? { ...plugin.options } : undefined,
        provides: plugin.provides ? [...plugin.provides] : undefined,
    };
}
