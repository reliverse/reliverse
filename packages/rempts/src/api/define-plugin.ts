import type {
  CommandAgentMetadata,
  CommandConventions,
} from "./define-command";
import { RemptsUsageError } from "../runtime/errors";

export interface PluginCommandConfig {
  readonly agent?: CommandAgentMetadata | undefined;
  readonly aliases?: ReadonlyArray<string> | undefined;
  readonly conventions?: CommandConventions | undefined;
  readonly description?: string | undefined;
  readonly examples?: ReadonlyArray<string> | undefined;
  readonly help?: string | undefined;
  readonly loadCommand?: (() => Promise<unknown>) | undefined;
  /**
   * Command path relative to the plugin root.
   *
   * - `[]` targets the plugin root command itself
   * - `["build"]` becomes `<plugin.name> build`
   */
  readonly path: ReadonlyArray<string>;
}

export interface RemptsPlugin {
  readonly commands: readonly PluginCommandConfig[];
  readonly description?: string | undefined;
  readonly id: string;
  readonly name: string;
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

function getParentKey(path: readonly string[]): string {
  return path.slice(0, -1).join("\0");
}

function getPathKey(path: readonly string[]): string {
  return path.join("\0");
}

function getNormalizedPath(pluginName: string, path: readonly string[]): readonly string[] {
  return [pluginName, ...path];
}

function normalizePluginCommands(
  pluginName: string,
  commands: readonly PluginCommandConfig[],
): PluginCommandConfig[] {
  return commands.map((command) => ({
    ...command,
    aliases: command.aliases ? [...command.aliases] : [],
    examples: command.examples ? [...command.examples] : [],
    path: getNormalizedPath(pluginName, command.path),
  }));
}

function validatePluginCommands(
  pluginId: string,
  commands: readonly PluginCommandConfig[],
): void {
  const seenPaths = new Set<string>();
  const siblingKeys = new Map<string, Set<string>>();

  for (const command of commands) {
    if (command.path.length === 0) {
      throw new RemptsUsageError(`Plugin "${pluginId}" contains a command with an empty path.`);
    }

    for (const segment of command.path) {
      assertValidSegment(segment, command.path);
    }

    const pathKey = getPathKey(command.path);

    if (seenPaths.has(pathKey)) {
      throw new RemptsUsageError(
        `Plugin "${pluginId}" defines duplicate command path "${command.path.join(" ")}".`,
      );
    }

    seenPaths.add(pathKey);

    const parentKey = getParentKey(command.path);
    const siblingSet = siblingKeys.get(parentKey) ?? new Set<string>();
    const commandName = command.path.at(-1);

    if (commandName === undefined) {
      throw new RemptsUsageError(`Plugin "${pluginId}" contains a command with an empty path.`);
    }

    if (siblingSet.has(commandName)) {
      throw new RemptsUsageError(
        `Plugin "${pluginId}" defines duplicate sibling command "${command.path.join(" ")}".`,
      );
    }

    siblingSet.add(commandName);

    for (const alias of command.aliases ?? []) {
      assertValidSegment(alias, command.path);

      if (siblingSet.has(alias)) {
        throw new RemptsUsageError(
          `Plugin "${pluginId}" defines colliding alias "${alias}" under "${command.path
            .slice(0, -1)
            .join(" ")}".`,
        );
      }

      siblingSet.add(alias);
    }

    siblingKeys.set(parentKey, siblingSet);
  }
}

export function definePlugin(plugin: RemptsPlugin): RemptsPlugin {
  assertValidSegment(plugin.name, [plugin.name]);

  const commands = normalizePluginCommands(plugin.name, plugin.commands);

  validatePluginCommands(plugin.id, commands);

  return {
    commands,
    description: plugin.description,
    id: plugin.id,
    name: plugin.name,
  };
}
