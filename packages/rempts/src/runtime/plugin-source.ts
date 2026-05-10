import type { RemptsPlugin } from "../api/define-plugin";
import type { CommandDefinition } from "../api/define-command";
import type { CommandNode, CommandSource, CommandSourceScope, DiscoveredSubcommand } from "./command-source";
import { createFileCommandSource } from "./file-source";
import { resolveEntry } from "./resolve-entry";

interface InlineCommandNode {
  command?: CommandDefinition<any> | undefined;
  children: Map<string, InlineCommandNode>;
}

function createInlineRoot(plugin: RemptsPlugin): InlineCommandNode {
  const root: InlineCommandNode = { children: new Map() };

  for (const entry of plugin.commands ?? []) {
    let current = root;

    for (const segment of entry.path) {
      const next = current.children.get(segment) ?? { children: new Map() };
      current.children.set(segment, next);
      current = next;
    }

    current.command = entry.command;
  }

  return root;
}

function getInlineNode(root: InlineCommandNode, path: readonly string[]): InlineCommandNode | null {
  let current = root;

  for (const segment of path) {
    const next = current.children.get(segment);
    if (!next) return null;
    current = next;
  }

  return current;
}

function toInlineCommandNode(
  plugin: RemptsPlugin,
  path: readonly string[],
  inlineNode: InlineCommandNode,
): CommandNode | null {
  const command = inlineNode.command;
  if (!command) return null;

  const loadCommand = async () => command;

  return {
    agent: command.agent,
    aliases: command.meta?.aliases ?? [],
    conventions: command.conventions,
    description: command.meta?.description,
    examples: command.help?.examples ?? [],
    help: command.help?.text,
    interactive: command.interactive ?? "never",
    loadCommand,
    name: command.meta?.name ?? path.at(-1) ?? plugin.name,
    path,
    sourceId: plugin.name,
    sourceKind: "plugin",
  };
}

function toInlineSubcommands(inlineNode: InlineCommandNode): DiscoveredSubcommand[] {
  return [...inlineNode.children.entries()]
    .map(([name, child]) => ({
      description: child.command?.meta?.description,
      name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createInlinePluginCommandSource(plugin: RemptsPlugin): CommandSource {
  const root = createInlineRoot(plugin);

  return {
    id: plugin.name,
    async getScope(path): Promise<CommandSourceScope | null> {
      const inlineNode = getInlineNode(root, path);
      if (!inlineNode) return path.length === 0
        ? { node: null, resolveSegment: async () => null, subcommands: [] }
        : null;

      const childNames = new Set(inlineNode.children.keys());
      const aliasesBySegment = new Map<string, string>();

      for (const [childName, child] of inlineNode.children) {
        for (const alias of child.command?.meta?.aliases ?? []) {
          if (!aliasesBySegment.has(alias)) aliasesBySegment.set(alias, childName);
        }
      }

      return {
        node: toInlineCommandNode(plugin, path, inlineNode) ?? getSyntheticTopLevelNode(plugin, path),
        async resolveSegment(segment) {
          if (childNames.has(segment)) return segment;
          return aliasesBySegment.get(segment) ?? null;
        },
        subcommands: toInlineSubcommands(inlineNode),
      };
    },
  };
}

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

function getSyntheticTopLevelNode(
  plugin: RemptsPlugin,
  path: readonly string[],
): CommandNode | null {
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
  if (plugin.commands && plugin.commands.length > 0) {
    return createInlinePluginCommandSource(plugin);
  }

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
