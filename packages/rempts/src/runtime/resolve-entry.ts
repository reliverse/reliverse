import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvedEntry {
  readonly commandFileName: string;
  readonly commandRoot: string;
  readonly entryDirectory: string;
  readonly entryFileName: string;
  readonly entryFilePath: string;
  readonly runtimeExtension: ".js" | ".ts";
}

function toFilePath(entry: string): string {
  if (entry.startsWith("file://")) {
    return fileURLToPath(entry);
  }

  return resolve(entry);
}

export function resolveEntry(entry: string): ResolvedEntry {
  const entryFilePath = toFilePath(entry);
  const runtimeExtension = extname(entryFilePath);

  if (runtimeExtension !== ".ts" && runtimeExtension !== ".js") {
    throw new Error(
      `Unsupported entry extension "${runtimeExtension || "<none>"}". Rempts only supports .ts and .js entry files.`,
    );
  }

  const entryDirectory = dirname(entryFilePath);

  return {
    commandFileName: `cmd${runtimeExtension}`,
    commandRoot: resolve(entryDirectory, "cmds"),
    entryDirectory,
    entryFileName: basename(entryFilePath),
    entryFilePath,
    runtimeExtension,
  };
}
