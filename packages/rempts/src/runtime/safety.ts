import type { CommandEffect, CommandSafety, CommandSafetyAPI } from "../api/define-command";
import type { CommandOptionsOutput, CommandOptionsRecord } from "../options/types";
import { RemptsUsageError } from "./errors";

function hasApplyOption(options: CommandOptionsOutput<CommandOptionsRecord>): boolean {
  return (options as { readonly apply?: unknown }).apply === true;
}

export function createCommandSafety(options: {
  readonly commandName: string;
  readonly commandOptions: CommandOptionsOutput<CommandOptionsRecord>;
  readonly safety?: CommandSafety | undefined;
}): CommandSafetyAPI {
  const apply = hasApplyOption(options.commandOptions);
  const defaultMode = options.safety?.defaultMode ?? "execute";
  const effects = [...(options.safety?.effects ?? [])];
  const requiresApply = options.safety?.requiresApply === true;
  const preview = defaultMode === "preview" && !apply;

  return {
    apply,
    effects,
    preview,
    requiresApply,
    assertApplied(effect, message) {
      if (apply) {
        return;
      }

      const effectLabel = effect ? ` for ${effect}` : "";
      throw new RemptsUsageError(
        message ??
          `Command "${options.commandName}" requires --apply before executing side effects${effectLabel}.`,
        1,
      );
    },
  };
}
