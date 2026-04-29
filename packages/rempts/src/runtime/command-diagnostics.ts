import type { CommandNode, CommandSource, DiscoveredSubcommand } from "./command-source";

export interface CommandCandidate {
  readonly description?: string | undefined;
  readonly name: string;
  readonly path: readonly string[];
  readonly sourceId: string;
  readonly sourceKind: "file" | "plugin";
}

export interface CommandSubcommandDiagnostic {
  readonly name: string;
  readonly sources: readonly string[];
}

export interface CommandTreeNodeDiagnostic {
  readonly availableSubcommands: readonly string[];
  readonly chosenCommand?: CommandCandidate | undefined;
  readonly path: readonly string[];
  readonly shadowedCommands: readonly CommandCandidate[];
  readonly subcommandDiagnostics: readonly CommandSubcommandDiagnostic[];
}

export interface CommandTreeReport {
  readonly nodes: readonly CommandTreeNodeDiagnostic[];
}

function toCandidate(node: CommandNode): CommandCandidate {
  return {
    description: node.description,
    name: node.name,
    path: node.path,
    sourceId: node.sourceId,
    sourceKind: node.sourceKind,
  };
}

export async function inspectCommandTree(sources: readonly CommandSource[]): Promise<CommandTreeReport> {
  const visited = new Set<string>();
  const nodes: CommandTreeNodeDiagnostic[] = [];

  async function walk(path: readonly string[]): Promise<void> {
    const key = path.join("/");
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const scopes = (
      await Promise.all(
        sources.map(async (source) => ({
          scope: await source.getScope(path),
          sourceId: source.id,
        })),
      )
    ).filter(
      (entry): entry is { readonly scope: NonNullable<typeof entry.scope>; readonly sourceId: string } =>
        entry.scope !== null,
    );

    const commandNodes = scopes
      .filter((entry) => entry.scope.node !== null)
      .map((entry) => entry.scope.node as CommandNode);

    const subcommandMap = new Map<string, Set<string>>();
    for (const entry of scopes) {
      for (const subcommand of entry.scope.subcommands) {
        const sourcesForName = subcommandMap.get(subcommand.name) ?? new Set<string>();
        sourcesForName.add(entry.sourceId);
        subcommandMap.set(subcommand.name, sourcesForName);
      }
    }

    nodes.push({
      availableSubcommands: [...subcommandMap.keys()].sort((a, b) => a.localeCompare(b)),
      chosenCommand: commandNodes[0] ? toCandidate(commandNodes[0]) : undefined,
      path,
      shadowedCommands: commandNodes.slice(1).map(toCandidate),
      subcommandDiagnostics: [...subcommandMap.entries()]
        .map(([name, sourceIds]) => ({ name, sources: [...sourceIds].sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });

    for (const name of [...subcommandMap.keys()].sort((a, b) => a.localeCompare(b))) {
      await walk([...path, name]);
    }
  }

  await walk([]);

  return {
    nodes: nodes.sort((left, right) => left.path.join("/").localeCompare(right.path.join("/"))),
  };
}
