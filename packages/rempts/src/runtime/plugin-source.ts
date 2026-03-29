import type { RemptsPlugin } from "../api/define-plugin";
import type { CommandNode, CommandSource, CommandSourceScope, DiscoveredSubcommand } from "./command-source";
import { isCommandDefinition } from "../api/define-command";
import { RemptsUsageError } from "./errors";

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }

  return prefix.every((segment, index) => path[index] === segment);
}

function buildCommandNode(
  plugin: RemptsPlugin,
  command: RemptsPlugin["commands"][number],
): CommandNode {
  const loadCommand = command.loadCommand;

  return {
    agent: command.agent,
    aliases: command.aliases ?? [],
    conventions: command.conventions,
    description: command.description,
    examples: command.examples ?? [],
    help: command.help,
    loadCommand: loadCommand
      ? async () => {
          const loaded = await loadCommand();

          if (!isCommandDefinition(loaded)) {
            throw new RemptsUsageError(
              `Plugin "${plugin.id}" command "${command.path.join(" ")}" must resolve to defineCommand(...).`,
            );
          }

          return loaded;
        }
      : undefined,
    name: command.path.at(-1) ?? plugin.id,
    path: command.path,
    sourceId: plugin.id,
    sourceKind: "plugin",
  };
}

export function createPluginCommandSource(plugin: RemptsPlugin): CommandSource {
  return {
    id: plugin.id,
    async getScope(path) {
      const relevantCommands = plugin.commands.filter((command) =>
        pathStartsWith(command.path, path),
      );

      if (relevantCommands.length === 0) {
        return null;
      }

      const exactCommand = relevantCommands.find((command) => command.path.length === path.length);
      const childGroups = new Map<
        string,
        {
          aliases: readonly string[];
          description?: string | undefined;
        }
      >();

      for (const command of relevantCommands) {
        if (command.path.length <= path.length) {
          continue;
        }

        const childName = command.path[path.length];

        if (childName === undefined) {
          continue;
        }

        const existing = childGroups.get(childName);

        if (existing) {
          continue;
        }

        const exactChild = relevantCommands.find(
          (candidate) =>
            candidate.path.length === path.length + 1 &&
            candidate.path[path.length] === childName,
        );

        childGroups.set(childName, {
          aliases: exactChild?.aliases ?? [],
          description: exactChild?.description,
        });
      }

      const subcommands: DiscoveredSubcommand[] = [...childGroups.entries()]
        .map(([name, child]) => ({
          description: child.description,
          name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));

      const scope: CommandSourceScope = {
        node: exactCommand ? buildCommandNode(plugin, exactCommand) : null,
        async resolveSegment(segment) {
          if (childGroups.has(segment)) {
            return segment;
          }

          const aliasMatches = [...childGroups.entries()].filter(([, child]) =>
            child.aliases.includes(segment),
          );

          if (aliasMatches.length !== 1) {
            return aliasMatches.length > 1 ? aliasMatches[0]?.[0] ?? null : null;
          }

          return aliasMatches[0]?.[0] ?? null;
        },
        subcommands,
      };

      return scope;
    },
  };
}
