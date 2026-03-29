import { pathToFileURL } from "node:url";

import { isCommandDefinition, type CommandDefinition } from "../api/define-command";
import type { CommandOptionsRecord } from "../options/types";
import { RemptsUsageError } from "./errors";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function loadCommand(
  filePath: string,
): Promise<CommandDefinition<CommandOptionsRecord>> {
  const imported = await import(pathToFileURL(filePath).href);

  if (!isRecord(imported) || !("default" in imported)) {
    throw new RemptsUsageError(
      `Command module "${filePath}" must default-export a defineCommand(...) result.`,
    );
  }

  const command = imported.default;

  if (!isCommandDefinition(command)) {
    throw new RemptsUsageError(
      `Command module "${filePath}" must default-export a defineCommand(...) result.`,
    );
  }

  return command;
}
