import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { CommandDefinition } from "../api/define-command";
import type { CommandSource, CommandSourceScope, DiscoveredSubcommand } from "./command-source";
import { loadCommand } from "./load-command";
import type { ResolvedEntry } from "./resolve-entry";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

async function listChildDirectories(directoryPath: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const childDirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const discoveredDirectories = await Promise.all(
      childDirectories.map(async (childDirectory) => {
        const childPath = join(directoryPath, childDirectory);

        try {
          const childEntries = await readdir(childPath, { withFileTypes: true });
          return childEntries.length > 0 ? childDirectory : null;
        } catch {
          return null;
        }
      }),
    );

    return discoveredDirectories.filter((entry): entry is string => entry !== null);
  } catch {
    return [];
  }
}

function createCachedCommandLoader(filePath: string): () => Promise<CommandDefinition> {
  let cachedCommand: Promise<CommandDefinition> | undefined;

  return () => {
    if (!cachedCommand) {
      cachedCommand = loadCommand(filePath);
    }

    return cachedCommand;
  };
}

export function createFileCommandSource(resolvedEntry: ResolvedEntry): CommandSource {
  return {
    id: "local",
    async getScope(path) {
      const directoryPath = join(resolvedEntry.commandRoot, ...path);
      const commandFilePath = join(directoryPath, resolvedEntry.commandFileName);
      const directoryExists = path.length === 0 ? await pathExists(directoryPath) : await isDirectory(directoryPath);
      const commandExists = await pathExists(commandFilePath);

      if (!directoryExists && !commandExists) {
        return path.length === 0
          ? {
              node: null,
              resolveSegment: async () => null,
              subcommands: [],
            }
          : null;
      }

      const loadCurrentCommand = commandExists ? createCachedCommandLoader(commandFilePath) : undefined;
      const childDirectories = directoryExists ? await listChildDirectories(directoryPath) : [];
      const childMetadata = await Promise.all(
        childDirectories.map(async (childName) => {
          const childDirectoryPath = join(directoryPath, childName);
          const childCommandFilePath = join(childDirectoryPath, resolvedEntry.commandFileName);
          const childCommandExists = await pathExists(childCommandFilePath);

          if (!childCommandExists) {
            return {
              aliases: [],
              description: undefined,
              name: childName,
            };
          }

          try {
            const command = await loadCommand(childCommandFilePath);

            return {
              aliases: command.meta?.aliases ?? [],
              description: command.meta?.description,
              name: childName,
            };
          } catch {
            return {
              aliases: [],
              description: undefined,
              name: childName,
            };
          }
        }),
      );

      const node = loadCurrentCommand
        ? await loadCurrentCommand().then((command) => ({
            agent: command.agent,
            aliases: command.meta?.aliases ?? [],
            conventions: command.conventions,
            description: command.meta?.description,
            directoryPath,
            examples: command.help?.examples ?? [],
            filePath: commandFilePath,
            help: command.help?.text,
            loadCommand: loadCurrentCommand,
            name: command.meta?.name ?? path.at(-1) ?? resolvedEntry.entryFileName,
            path,
            sourceId: "local",
            sourceKind: "file" as const,
          }))
        : null;

      const subcommands: DiscoveredSubcommand[] = childMetadata.map((child) => ({
        description: child.description,
        name: child.name,
      }));

      const aliasesBySegment = new Map<string, string>();

      for (const child of childMetadata) {
        for (const alias of child.aliases) {
          if (!aliasesBySegment.has(alias)) {
            aliasesBySegment.set(alias, child.name);
          }
        }
      }

      const childNameSet = new Set(childDirectories);

      const scope: CommandSourceScope = {
        node,
        async resolveSegment(segment) {
          if (childNameSet.has(segment)) {
            return segment;
          }

          return aliasesBySegment.get(segment) ?? null;
        },
        subcommands,
      };

      return scope;
    },
  };
}
