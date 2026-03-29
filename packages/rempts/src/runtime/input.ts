import { RemptsUsageError } from "./errors";
import type { InteractionPolicy } from "./noninteractive";
import type { StdinMode } from "./types";

export interface CommandInputAPI {
  readonly available: boolean;
  readonly mode: StdinMode;
  json<TData = unknown>(): Promise<TData>;
  text(): Promise<string>;
}

export interface CreateCommandInputOptions {
  readonly interaction: InteractionPolicy;
  readonly stdin: typeof process.stdin;
}

function createInputUnavailableError(mode: StdinMode): RemptsUsageError {
  return new RemptsUsageError(
    "This command expected explicit stdin input, but stdin does not contain piped data.",
    1,
    {
      code: "REMPTS_STDIN_REQUIRED",
      hint:
        mode === "tty"
          ? "Pipe input into the command or use an explicit flag-based value."
          : "Make sure the piped input is available before invoking the command.",
    },
  );
}

async function readAllStdin(stdin: typeof process.stdin): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stdin) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createCommandInput(options: CreateCommandInputOptions): CommandInputAPI {
  let cachedTextPromise: Promise<string> | undefined;

  function ensureAvailable(): void {
    if (options.interaction.stdinMode === "tty") {
      throw createInputUnavailableError(options.interaction.stdinMode);
    }
  }

  async function getText(): Promise<string> {
    ensureAvailable();

    if (!cachedTextPromise) {
      cachedTextPromise = readAllStdin(options.stdin);
    }

    return cachedTextPromise;
  }

  return {
    available: options.interaction.stdinMode === "pipe",
    async json<TData = unknown>(): Promise<TData> {
      const rawText = await getText();

      try {
        return JSON.parse(rawText) as TData;
      } catch {
        throw new RemptsUsageError("Expected JSON input on stdin, but parsing failed.", 1, {
          code: "REMPTS_STDIN_INVALID_JSON",
          hint: "Pipe valid JSON into stdin or use a non-stdin input path.",
        });
      }
    },
    mode: options.interaction.stdinMode,
    text() {
      return getText();
    },
  };
}
