import path from "node:path";

import {
  ARCHIVE_MANIFEST_PATH,
  ARCHIVE_SHA256SUMS_PATH,
  PLATFORM_NOTE_FILES,
  RSPACE_CREATED_BY,
  RSPACE_PROTOCOL,
  RSPACE_STATE_PATH,
} from "./constants";
import { toPosixPath } from "./paths";
import type { RspaceImportedSource, RspacePlatform, RspaceState } from "./types";

export function createRspaceState(input: {
  name: string;
  team?: string;
  entryFile: string;
  platform: RspacePlatform;
  source: RspaceImportedSource;
  copiedSourceFiles: string[];
  now: Date;
}): RspaceState {
  const generatedFiles = createGeneratedFileList(input.entryFile);
  const importedFiles = input.copiedSourceFiles.map((file) => {
    if (!input.source.targetPath) {
      return toPosixPath(file);
    }

    return toPosixPath(path.posix.join(input.source.targetPath, file));
  });

  const files = uniqueSorted([...generatedFiles, ...importedFiles]);
  const now = input.now.toISOString();

  return {
    protocol: RSPACE_PROTOCOL,
    kind: "rse-agent-space",
    name: input.name,
    team: input.team,
    entryFile: input.entryFile,
    platform: input.platform,
    optimizedFor: input.platform === "generic" ? ["generic"] : ["generic", input.platform],
    createdBy: RSPACE_CREATED_BY,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    files,
    generatedFiles,
  };
}

export function createGeneratedFileList(entryFile: string): string[] {
  return uniqueSorted([
    entryFile,
    "AGENTS.md",
    "IDENTITY.md",
    "TOOLS.md",
    "MEMORY.md",
    ARCHIVE_MANIFEST_PATH,
    ARCHIVE_SHA256SUMS_PATH,
    RSPACE_STATE_PATH,
    ...PLATFORM_NOTE_FILES,
  ]);
}

export function stringifyState(state: RspaceState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
