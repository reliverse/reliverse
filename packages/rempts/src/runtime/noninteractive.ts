import type { ConfirmationMode, StdinMode } from "./types";

export interface InteractionPolicyOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly noInput?: boolean | undefined;
  readonly noTTY?: boolean | undefined;
  readonly noTUI?: boolean | undefined;
  readonly stdin: typeof process.stdin;
  readonly stdout: typeof process.stdout;
}

export interface InteractionPolicy {
  readonly canPrompt: boolean;
  readonly confirmationMode: ConfirmationMode;
  readonly isNonInteractive: boolean;
  readonly isTTY: boolean;
  readonly isTUIAllowed: boolean;
  readonly reason: string;
  readonly stdinMode: StdinMode;
}

export function getStdinMode(stdin: typeof process.stdin): StdinMode {
  return stdin.isTTY ? "tty" : "pipe";
}

export function resolveInteractionPolicy(
  options: InteractionPolicyOptions,
): InteractionPolicy {
  const stdinMode = getStdinMode(options.stdin);
  const isTTY = !options.noTTY && Boolean(options.stdin.isTTY && options.stdout.isTTY);
  const isNonInteractive =
    Boolean(options.noInput) || Boolean(options.env.CI) || !isTTY;

  let reason = "interactive terminal available";

  if (options.noTTY) {
    reason = "TTY behavior is disabled";
  } else if (options.noInput) {
    reason = "interactive input is disabled by --no-input";
  } else if (options.env.CI) {
    reason = "CI environment detected";
  } else if (!isTTY) {
    reason = "stdin/stdout is not an interactive TTY";
  }

  return {
    canPrompt: !isNonInteractive,
    confirmationMode: isNonInteractive ? "disabled" : "prompt",
    isNonInteractive,
    isTTY,
    isTUIAllowed: !isNonInteractive && !options.noTUI,
    reason,
    stdinMode,
  };
}

export function getPromptUnavailableMessage(
  promptLabel: string,
  interaction: InteractionPolicy,
): string {
  return `Prompt "${promptLabel}" is unavailable in non-interactive mode (${interaction.reason}). Supply the value via flags, stdin, or defaultValue.`;
}
