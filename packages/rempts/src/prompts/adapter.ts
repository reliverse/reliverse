import type {
  CommandPromptAPI,
  PromptConfirmOptions,
  PromptInputOptions,
  PromptSelectOptions,
} from "../api/define-command";
import {
  resolveInteractionPolicy,
  type InteractionPolicy,
} from "../runtime/noninteractive";
import type { ConfirmationMode, StdinMode } from "../runtime/types";
import { createPlainPromptAdapter } from "./plain";
import { createOpenTUIPromptAdapter } from "./opentui";

export interface PromptRuntimeOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly noInput?: boolean | undefined;
  readonly noTTY?: boolean | undefined;
  readonly noTUI?: boolean | undefined;
  readonly stdin: typeof process.stdin;
  readonly stdout: typeof process.stdout;
  readonly stderr: typeof process.stderr;
}

export interface ResolvedPromptRuntime {
  readonly confirmationMode: ConfirmationMode;
  readonly interaction: InteractionPolicy;
  readonly isTTY: boolean;
  readonly isTUI: boolean;
  readonly prompt: CommandPromptAPI;
  readonly stdinMode: StdinMode;
}

export function isInteractiveTTY(options: PromptRuntimeOptions): boolean {
  return resolveInteractionPolicy(options).isTTY;
}

export async function createPromptRuntime(
  options: PromptRuntimeOptions,
): Promise<ResolvedPromptRuntime> {
  const interaction = resolveInteractionPolicy(options);

  if (interaction.isTUIAllowed) {
    const opentuiAdapter = await createOpenTUIPromptAdapter({
      ...options,
      interaction,
    });

    if (opentuiAdapter) {
      return {
        confirmationMode: interaction.confirmationMode,
        interaction,
        isTTY: interaction.isTTY,
        isTUI: true,
        prompt: opentuiAdapter,
        stdinMode: interaction.stdinMode,
      };
    }
  }

  return {
    confirmationMode: interaction.confirmationMode,
    interaction,
    isTTY: interaction.isTTY,
    isTUI: false,
    prompt: createPlainPromptAdapter({
      ...options,
      interaction,
    }),
    stdinMode: interaction.stdinMode,
  };
}

function getDefaultPromptRuntimeOptions(
  partialOptions: Partial<PromptRuntimeOptions>,
): PromptRuntimeOptions {
  return {
    env: partialOptions.env ?? process.env,
    noInput: partialOptions.noInput,
    noTTY: partialOptions.noTTY,
    noTUI: partialOptions.noTUI,
    stderr: partialOptions.stderr ?? process.stderr,
    stdin: partialOptions.stdin ?? process.stdin,
    stdout: partialOptions.stdout ?? process.stdout,
  };
}

export async function inputPrompt(
  options: PromptInputOptions & Partial<PromptRuntimeOptions>,
): Promise<string> {
  const runtime = await createPromptRuntime(getDefaultPromptRuntimeOptions(options));
  return runtime.prompt.input(options);
}

export async function confirmPrompt(
  options: PromptConfirmOptions & Partial<PromptRuntimeOptions>,
): Promise<boolean> {
  const runtime = await createPromptRuntime(getDefaultPromptRuntimeOptions(options));
  return runtime.prompt.confirm(options);
}

export async function selectPrompt<TValue extends string>(
  options: PromptSelectOptions<TValue> & Partial<PromptRuntimeOptions>,
): Promise<TValue> {
  const runtime = await createPromptRuntime(getDefaultPromptRuntimeOptions(options));
  return runtime.prompt.select(options);
}
