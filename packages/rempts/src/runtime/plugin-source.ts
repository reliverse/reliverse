import type { RemptsPlugin } from "../api/define-plugin";
import type { CommandNode, CommandSource } from "./command-source";
import { createFileCommandSource } from "./file-source";
import { resolveEntry } from "./resolve-entry";

function withPluginMetadata(plugin: RemptsPlugin, node: CommandNode | null): CommandNode | null {
  if (!node) {
    return null;
  }

  return {
    ...node,
    sourceId: plugin.name,
    sourceKind: "plugin",
  };
}

function getSyntheticTopLevelNode(plugin: RemptsPlugin, path: readonly string[]): CommandNode | null {
  if (path.length !== 1 || !plugin.description) {
    return null;
  }

  return {
    aliases: [],
    description: plugin.description,
    examples: [],
    interactive: "never",
    name: path[0] ?? plugin.name,
    path,
    sourceId: plugin.name,
    sourceKind: "plugin",
  };
}

export function createPluginCommandSource(plugin: RemptsPlugin): CommandSource {
  const fileSource = createFileCommandSource(resolveEntry(plugin.entry));

  return {
    id: plugin.name,
    async getScope(path) {
      const scope = await fileSource.getScope(path);

      if (!scope) {
        return null;
      }

      return {
        node: withPluginMetadata(plugin, scope.node) ?? getSyntheticTopLevelNode(plugin, path),
        resolveSegment: scope.resolveSegment,
        subcommands:
          path.length === 0 && plugin.description
            ? scope.subcommands.map((subcommand) => ({
                ...subcommand,
                description: subcommand.description ?? plugin.description,
              }))
            : scope.subcommands,
      };
    },
  };
}
