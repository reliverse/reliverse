import type { CommandContext, CommandDefinition } from "../api/define-command";
import {
  PromptUnavailableError,
  RemptsExitSignal,
  RemptsUsageError,
  RemptsValidationError,
  toStructuredRemptsError,
} from "./errors";

export interface ExecuteCommandResult {
  readonly exitCode: number;
  readonly unexpectedError?: unknown;
}

export async function executeCommand(
  command: CommandDefinition,
  context: CommandContext,
): Promise<ExecuteCommandResult> {
  try {
    await command.handler(context);

    return {
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof RemptsExitSignal) {
      if (error.messageText) {
        if (error.exitCode === 0) {
          context.out(error.messageText);
        } else if (context.output.mode === "json") {
          context.output.problem({
            code: "REMPTS_EXIT",
            kind: "usage",
            message: error.messageText,
            ok: false,
            remptsError: 1,
            schemaVersion: 1,
          });
        } else {
          context.err(error.messageText);
        }
      }

      return {
        exitCode: error.exitCode,
      };
    }

    if (error instanceof RemptsValidationError) {
      context.output.problem(toStructuredRemptsError(error));

      return {
        exitCode: error.exitCode,
      };
    }

    if (error instanceof RemptsUsageError || error instanceof PromptUnavailableError) {
      context.output.problem(toStructuredRemptsError(error));

      return {
        exitCode: error.exitCode,
      };
    }

    context.output.problem(toStructuredRemptsError(error));

    return {
      exitCode: 1,
      unexpectedError: error,
    };
  }
}
