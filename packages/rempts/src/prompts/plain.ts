import { createInterface } from "node:readline/promises";

import type {
  CommandPromptAPI,
  PromptConfirmOptions,
  PromptInputOptions,
  PromptSelectOptions,
} from "../api/define-command";
import {
  getPromptUnavailableMessage,
  type InteractionPolicy,
} from "../runtime/noninteractive";
import { PromptUnavailableError } from "../runtime/errors";

export interface PlainPromptAdapterOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly interaction: InteractionPolicy;
  readonly stderr: typeof process.stderr;
  readonly stdin: typeof process.stdin;
  readonly stdout: typeof process.stdout;
}

type OutputStream = Pick<typeof process.stdout, "write">;

function getPromptMessage(
  options:
    | PromptConfirmOptions
    | PromptInputOptions
    | PromptSelectOptions<string>,
): string {
  return options.message ?? options.title ?? "Prompt";
}

function writeLine(stream: OutputStream, value: string): void {
  stream.write(`${value}\n`);
}

async function askQuestion(
  options: PlainPromptAdapterOptions,
  question: string,
): Promise<string> {
  const readline = createInterface({
    input: options.stdin,
    output: options.stdout,
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

export function createPlainPromptAdapter(
  adapterOptions: PlainPromptAdapterOptions,
): CommandPromptAPI {
  return {
    async confirm(options: PromptConfirmOptions): Promise<boolean> {
      if (!adapterOptions.interaction.canPrompt) {
        if (options.defaultValue !== undefined) {
          return options.defaultValue;
        }

        throw new PromptUnavailableError(
          getPromptUnavailableMessage(getPromptMessage(options), adapterOptions.interaction),
        );
      }

      while (true) {
        const suffix =
          options.defaultValue === undefined
            ? "[y/n]"
            : options.defaultValue
              ? "[Y/n]"
              : "[y/N]";
        const answer = (await askQuestion(
          adapterOptions,
          `${getPromptMessage(options)} ${suffix} `,
        ))
          .trim()
          .toLowerCase();

        if (answer === "" && options.defaultValue !== undefined) {
          return options.defaultValue;
        }

        if (answer === "y" || answer === "yes") {
          return true;
        }

        if (answer === "n" || answer === "no") {
          return false;
        }

        writeLine(adapterOptions.stderr, 'Please answer "y" or "n".');
      }
    },

    async input(options: PromptInputOptions): Promise<string> {
      if (!adapterOptions.interaction.canPrompt) {
        if (options.defaultValue !== undefined) {
          return options.defaultValue;
        }

        throw new PromptUnavailableError(
          getPromptUnavailableMessage(getPromptMessage(options), adapterOptions.interaction),
        );
      }

      while (true) {
        const placeholder = options.placeholder ? ` (${options.placeholder})` : "";
        const defaultValue =
          options.defaultValue !== undefined ? ` [${options.defaultValue}]` : "";
        const answer = await askQuestion(
          adapterOptions,
          `${getPromptMessage(options)}${placeholder}${defaultValue}: `,
        );
        const normalizedValue = answer.trim() || options.defaultValue || "";

        if (normalizedValue.length > 0 || !options.required) {
          return normalizedValue;
        }

        writeLine(adapterOptions.stderr, "A value is required.");
      }
    },

    async select<TValue extends string>(options: PromptSelectOptions<TValue>): Promise<TValue> {
      if (!adapterOptions.interaction.canPrompt) {
        if (options.defaultValue !== undefined) {
          return options.defaultValue;
        }

        throw new PromptUnavailableError(
          getPromptUnavailableMessage(getPromptMessage(options), adapterOptions.interaction),
        );
      }

      writeLine(adapterOptions.stdout, getPromptMessage(options));

      options.options.forEach((option, index) => {
        const description = option.description ? ` - ${option.description}` : "";
        writeLine(adapterOptions.stdout, `  ${index + 1}. ${option.label}${description}`);
      });

      while (true) {
        const defaultIndex = options.defaultValue
          ? options.options.findIndex((option) => option.value === options.defaultValue)
          : -1;
        const suffix = defaultIndex >= 0 ? ` [${defaultIndex + 1}]` : "";
        const answer = (await askQuestion(adapterOptions, `Select an option${suffix}: `)).trim();

        if (answer === "" && defaultIndex >= 0) {
          const defaultOption = options.options[defaultIndex];

          if (defaultOption) {
            return defaultOption.value;
          }
        }

        const answerIndex = Number(answer);

        if (Number.isInteger(answerIndex) && answerIndex >= 1 && answerIndex <= options.options.length) {
          const indexedOption = options.options[answerIndex - 1];

          if (indexedOption) {
            return indexedOption.value;
          }
        }

        const exactMatch = options.options.find(
          (option) => option.label === answer || option.value === answer,
        );

        if (exactMatch) {
          return exactMatch.value;
        }

        writeLine(adapterOptions.stderr, "Choose a valid option number or value.");
      }
    },
  };
}
