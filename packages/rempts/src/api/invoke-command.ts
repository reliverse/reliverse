import type { CommandOptionsRecord, EmptyCommandOptions } from "@reliverse/parser";

import type { CommandContext, CommandDefinition } from "./define-command";

export interface InvokeCommandOptions<TOptions extends CommandOptionsRecord = EmptyCommandOptions> {
  readonly name?: string | undefined;
  readonly options?: CommandContext<TOptions>["options"] | undefined;
  readonly path?: readonly string[] | undefined;
}

/**
 * Runs a command handler from another command while preserving the current Rempts runtime context.
 *
 * This is intentionally small: it does not re-parse argv, render help, or catch exit signals.
 * Callers that need full CLI dispatch should invoke the CLI entry instead.
 */
export function invokeCommand<TOptions extends CommandOptionsRecord = EmptyCommandOptions>(
  command: CommandDefinition<TOptions>,
  context: CommandContext,
  options: InvokeCommandOptions<TOptions> = {},
): Promise<unknown> | unknown {
  const path = options.path ?? context.command.path;
  const childContext = {
    ...context,
    command: {
      ...context.command,
      agent: command.agent,
      aliases: command.meta?.aliases ?? [],
      conventions: command.conventions,
      description: command.meta?.description,
      examples: command.help?.examples ?? [],
      help: command.help?.text,
      interactive: command.interactive ?? "never",
      name: options.name ?? command.meta?.name ?? path.at(-1) ?? context.command.name,
      options: command.options,
      path,
      safety: command.safety,
    },
    options: (options.options ?? {}) as CommandContext<TOptions>["options"],
  } as CommandContext<TOptions>;

  return command.handler(childContext);
}
