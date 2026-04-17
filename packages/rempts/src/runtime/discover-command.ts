import { RemptsUsageError } from "./errors";
import type { CommandNode, CommandSource, DiscoveredSubcommand } from "./command-source";

export interface DiscoveredCommandPath {
  readonly availableSubcommands: readonly DiscoveredSubcommand[];
  readonly commandNode: CommandNode | null;
  readonly matchedPath: readonly string[];
  readonly remainingArgv: readonly string[];
  readonly unknownSegment: string | null;
}

interface MergedScope {
  readonly commandNode: CommandNode | null;
  readonly subcommands: readonly DiscoveredSubcommand[];
  resolveSegment(segment: string): Promise<string | null>;
}

function formatPath(path: readonly string[]): string {
  return path.length === 0 ? "<root>" : path.join(" ");
}

async function getMergedScope(
  sources: readonly CommandSource[],
  path: readonly string[],
): Promise<MergedScope> {
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
    .map((entry) => ({
      node: entry.scope.node,
      sourceId: entry.sourceId,
    }));

  const subcommandsByName = new Map<
    string,
    { readonly sourceId: string; readonly subcommand: DiscoveredSubcommand }
  >();

  for (const entry of scopes) {
    for (const subcommand of entry.scope.subcommands) {
      if (!subcommandsByName.has(subcommand.name)) {
        subcommandsByName.set(subcommand.name, {
          sourceId: entry.sourceId,
          subcommand,
        });
      }
    }
  }

  return {
    commandNode: commandNodes[0]?.node ?? null,
    async resolveSegment(segment) {
      const matches = (
        await Promise.all(
          scopes.map(async (entry) => ({
            canonicalName: await entry.scope.resolveSegment(segment),
            sourceId: entry.sourceId,
          })),
        )
      ).filter(
        (
          entry,
        ): entry is { readonly canonicalName: string; readonly sourceId: string } =>
          entry.canonicalName !== null,
      );

      const uniqueCanonicalNames = [...new Set(matches.map((entry) => entry.canonicalName))];

      if (uniqueCanonicalNames.length > 1) {
        throw new RemptsUsageError(
          `Ambiguous command segment "${segment}" at "${formatPath(path)}". Matching sources: ${matches
            .map((entry) => entry.sourceId)
            .join(", ")}.`,
        );
      }

      return uniqueCanonicalNames[0] ?? null;
    },
    subcommands: [...subcommandsByName.values()]
      .map((entry) => entry.subcommand)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function discoverCommandPath(
  sources: readonly CommandSource[],
  argv: readonly string[],
): Promise<DiscoveredCommandPath> {
  const remainingArgv = [...argv];
  const matchedPath: string[] = [];
  let unknownSegment: string | null = null;

  while (remainingArgv.length > 0) {
    const segment = remainingArgv[0];

    if (segment === undefined) {
      break;
    }

    if (segment === "--" || segment.startsWith("-")) {
      break;
    }

    const scope = await getMergedScope(sources, matchedPath);
    const resolvedSegment = await scope.resolveSegment(segment);

    if (resolvedSegment) {
      matchedPath.push(resolvedSegment);
      remainingArgv.shift();
      continue;
    }

    unknownSegment = segment;
    break;
  }

  const scope = await getMergedScope(sources, matchedPath);

  return {
    availableSubcommands: scope.subcommands,
    commandNode: scope.commandNode,
    matchedPath,
    remainingArgv,
    unknownSegment,
  };
}
