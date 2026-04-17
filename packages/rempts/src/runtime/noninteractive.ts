import { isCI as detectCI, isTTY as detectTTY } from "@reliverse/myenv";

import type {
  ConfirmationMode,
  RemptsHostInteractionMode,
  RemptsInteractionMode,
  StdinMode,
} from "./types";

export interface InteractionPolicyOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly commandMode?: RemptsInteractionMode | undefined;
  readonly hostMode?: RemptsHostInteractionMode | undefined;
  readonly interactive?: boolean | undefined;
  readonly noInput?: boolean | undefined;
  readonly noTTY?: boolean | undefined;
  readonly noTUI?: boolean | undefined;
  readonly stdin: typeof process.stdin;
  readonly stdout: typeof process.stdout;
  readonly tui?: boolean | undefined;
}

export interface InteractionPolicy {
  readonly canPrompt: boolean;
  readonly commandMode: RemptsInteractionMode;
  readonly confirmationMode: ConfirmationMode;
  readonly effectiveMode: RemptsInteractionMode;
  readonly isNonInteractive: boolean;
  readonly isTTY: boolean;
  readonly isTUIAllowed: boolean;
  readonly requestedHostMode: RemptsHostInteractionMode;
  readonly reason: string;
  readonly stdinMode: StdinMode;
}

function resolveRequestedHostMode(options: InteractionPolicyOptions): RemptsHostInteractionMode {
  if (options.noInput) {
    return "never";
  }

  if (options.tui) {
    return "tui";
  }

  if (options.interactive) {
    return "tty";
  }

  return options.hostMode ?? "never";
}

function normalizeCommandMode(options: InteractionPolicyOptions): RemptsInteractionMode {
  if (options.commandMode) {
    return options.commandMode;
  }

  if (options.noTTY) {
    return "never";
  }

  if (options.noTUI) {
    return "tty";
  }

  return "never";
}

function intersectModes(
  requestedHostMode: RemptsHostInteractionMode,
  commandMode: RemptsInteractionMode,
): RemptsInteractionMode {
  if (commandMode === "never" || requestedHostMode === "never") {
    return "never";
  }

  if (requestedHostMode === "auto") {
    return commandMode;
  }

  if (requestedHostMode === "tty") {
    return commandMode === "tui" ? "tty" : commandMode;
  }

  return commandMode;
}

export function getStdinMode(stdin: typeof process.stdin): StdinMode {
  return stdin.isTTY ? "tty" : "pipe";
}

export function resolveInteractionPolicy(
  options: InteractionPolicyOptions,
): InteractionPolicy {
  const stdinMode = getStdinMode(options.stdin);
  const requestedHostMode = resolveRequestedHostMode(options);
  const commandMode = normalizeCommandMode(options);
  const capabilityTTY = Boolean(options.stdin.isTTY) && detectTTY("stdout", { stdout: options.stdout });
  const isTTY = capabilityTTY;
  const ci = detectCI({ env: options.env });
  const environmentDisallowsInteraction = ci || !capabilityTTY;
  const requestedMode = intersectModes(requestedHostMode, commandMode);
  const effectiveMode: RemptsInteractionMode =
    options.noInput || environmentDisallowsInteraction ? "never" : requestedMode;
  const isNonInteractive = effectiveMode === "never";

  let reason = "interactive mode is enabled";

  if (options.noInput) {
    reason = "interactive input is disabled by --no-input";
  } else if (ci) {
    reason = "CI environment detected";
  } else if (!capabilityTTY) {
    reason = "stdin/stdout is not an interactive TTY";
  } else if (requestedHostMode === "never") {
    reason = "host interaction mode is disabled by default";
  } else if (commandMode === "never") {
    reason = "command is configured for non-interactive execution";
  } else if (effectiveMode === "tty") {
    reason = "plain interactive prompts are allowed";
  } else if (effectiveMode === "tui") {
    reason = "TUI prompts are allowed";
  }

  return {
    canPrompt: !isNonInteractive,
    commandMode,
    confirmationMode: isNonInteractive ? "disabled" : "prompt",
    effectiveMode,
    isNonInteractive,
    isTTY,
    isTUIAllowed: effectiveMode === "tui",
    requestedHostMode,
    reason,
    stdinMode,
  };
}

export function getPromptUnavailableMessage(
  promptLabel: string,
  interaction: InteractionPolicy,
): string {
  const optInHint =
    interaction.commandMode === "never"
      ? "This command does not allow interactive prompts."
      : interaction.requestedHostMode === "never"
        ? "Re-run with --interactive or --tui if this command supports guided input."
        : "Re-run in an interactive TTY if you want guided input."
;

  return `Prompt "${promptLabel}" is unavailable in non-interactive mode (${interaction.reason}). Supply the value via flags, stdin, or defaultValue. ${optInHint}`;
}
