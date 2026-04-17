import type {
  CommandContext,
  CommandPromptAPI,
  CommandRuntimeInfo,
} from "../api/define-command";
import type { CommandOptionsOutput, CommandOptionsRecord } from "../options/types";
import { RemptsExitSignal } from "./errors";
import type { CommandInputAPI } from "./input";
import type { InteractionPolicy } from "./noninteractive";
import type {
  ConfirmationMode,
  ParsedGlobalFlags,
  RuntimeOutput,
  StdinMode,
} from "./types";

export interface CreateCommandContextOptions<
  TOptions extends CommandOptionsRecord = CommandOptionsRecord,
> {
  readonly args: readonly string[];
  readonly cliPluginNames?: readonly string[] | undefined;
  readonly options: CommandOptionsOutput<TOptions>;
  readonly command: CommandRuntimeInfo<TOptions>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: typeof process.stdin;
  readonly stdout: typeof process.stdout;
  readonly stderr: typeof process.stderr;
  readonly isTTY: boolean;
  readonly isTUI: boolean;
  readonly globalFlags: ParsedGlobalFlags;
  readonly input: CommandInputAPI;
  readonly interaction: InteractionPolicy;
  readonly output: RuntimeOutput;
  readonly confirmationMode: ConfirmationMode;
  readonly stdinMode: StdinMode;
  readonly prompt: CommandPromptAPI;
}

export function createCommandContext<TOptions extends CommandOptionsRecord>(
  options: CreateCommandContextOptions<TOptions>,
): CommandContext<TOptions> {
  return {
    args: options.args,
    cliPluginNames: options.cliPluginNames ?? [],
    command: options.command,
    confirmationMode: options.confirmationMode,
    cwd: options.cwd,
    env: options.env,
    err(...values: readonly unknown[]) {
      options.output.error(...values);
    },
    exit(code = 0, message?: string | undefined): never {
      throw new RemptsExitSignal(code, message);
    },
    globalFlags: options.globalFlags,
    input: options.input,
    interaction: options.interaction,
    isTTY: options.isTTY,
    isTUI: options.isTUI,
    nonInteractive: options.interaction.isNonInteractive,
    options: options.options,
    output: options.output,
    out(...values: readonly unknown[]) {
      options.output.text(...values);
    },
    prompt: options.prompt,
    stderr: options.stderr,
    stdinMode: options.stdinMode,
    stdin: options.stdin,
    stdout: options.stdout,
  };
}
