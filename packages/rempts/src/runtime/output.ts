import { createRelico } from "@reliverse/relico";

import type {
  OutputMode,
  RuntimeOutput,
  StructuredRemptsError,
  StructuredRemptsResult,
} from "./types";

type OutputStream = Pick<typeof process.stdout, "write">;

interface OutputWriterOptions {
  readonly mode: OutputMode;
  readonly stderr: OutputStream;
  readonly stdout: OutputStream;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}

function formatTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  return Bun.inspect(value);
}

function writeLine(stream: OutputStream, value: string): void {
  stream.write(`${value}\n`);
}

function writeJsonLine(stream: OutputStream, value: unknown): void {
  const encoded = JSON.stringify(value, (_key, currentValue) =>
    normalizeValue(currentValue),
  );

  writeLine(stream, encoded);
}

export function createRuntimeOutput(options: OutputWriterOptions): RuntimeOutput {
  const stdoutColors = createRelico({ stream: "stdout" });
  const stderrColors = createRelico({ stream: "stderr" });

  return {
    colors: {
      stderr: stderrColors,
      stdout: stdoutColors,
    },
    data(value: unknown) {
      if (options.mode === "json") {
        writeJsonLine(options.stdout, value);
        return;
      }

      writeLine(options.stdout, formatTextValue(value));
    },
    error(...values: readonly unknown[]) {
      if (options.mode === "json") {
        writeJsonLine(options.stderr, {
          remptsEvent: 1,
          stream: "stderr",
          type: "error",
          values,
        });
        return;
      }

      writeLine(options.stderr, stderrColors.red(values.map(formatTextValue).join(" ")));
    },
    mode: options.mode,
    problem(error: StructuredRemptsError) {
      if (options.mode === "json") {
        writeJsonLine(options.stderr, error);
        return;
      }

      writeLine(options.stderr, `${stderrColors.red(stderrColors.bold("Error:"))} ${error.message}`);

      if (error.hint) {
        writeLine(options.stderr, `${stderrColors.cyan(stderrColors.bold("Hint:"))} ${error.hint}`);
      }

      if (error.usage) {
        writeLine(options.stderr, `${stderrColors.yellow(stderrColors.bold("Usage:"))} ${error.usage}`);
      }

      if (error.issues && error.issues.length > 0) {
        for (const issue of error.issues) {
          writeLine(
            options.stderr,
            `  ${stderrColors.magenta(issue.flagName)}: ${issue.message}`,
          );
        }
      }
    },
    result<TData>(value: TData, command?: string | undefined) {
      const structuredResult: StructuredRemptsResult<TData> = {
        command,
        data: value,
        ok: true,
        remptsResult: 1,
        schemaVersion: 1,
      };

      if (options.mode === "json") {
        writeJsonLine(options.stdout, structuredResult);
        return;
      }

      writeLine(options.stdout, stdoutColors.green(formatTextValue(value)));
    },
    text(...values: readonly unknown[]) {
      if (options.mode === "json") {
        writeJsonLine(options.stdout, {
          remptsEvent: 1,
          stream: "stdout",
          type: "text",
          values,
        });
        return;
      }

      writeLine(options.stdout, values.map(formatTextValue).join(" "));
    },
  };
}
