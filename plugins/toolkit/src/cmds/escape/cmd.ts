import { defineCommand } from "@reliverse/rempts";

import { formatEscapeActionMessage, runEscape } from "../../impl/escape";

const COMMAND_NAME = "escape";
const USAGE = "rse escape --input <path> [flags]";
const HELP_HINT = 'Run "rse escape --help" for examples and flag details.';

class ReportedUsageError extends Error {
  constructor() {
    super("Usage error was already reported.");
    this.name = "ReportedUsageError";
  }
}

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      "Convert text files to escaped TypeScript modules, or unescape generated modules back to plain files.",
  },
  agent: {
    notes:
      "This command is idempotent by default. Re-runs produce no-op results when outputs are already up to date, and differing existing outputs fail fast unless --overwrite is supplied.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write"],
  },
  help: {
    examples: [
      'rse escape --input "path/to/file.md"',
      'rse escape --input "path/to/dir"',
      'rse escape --input "path/to/dir" --apply --overwrite',
      'rse escape --input "path/to/dir" --map "md:.rules,path/to/file json:*.markdown"',
      'rse escape --input "path/to/dir-escaped" --unescape',
      'rse escape --input "path/to/dir" --json',
    ],
    text: "Input resolution is explicit: provide --input to preview, then pass --apply to write files. Use --overwrite only when replacing existing outputs is intentional.",
  },
  options: {
    overwrite: {
      type: "boolean",
      description: "Overwrite existing output files when the generated content differs",
      inputSources: ["flag"],
    },
    input: {
      type: "string",
      required: true,
      description: "Path to file or directory to process",
      hint: "Pass an explicit path. This command does not infer targets from stdin.",
      inputSources: ["flag"],
    },
    map: {
      type: "string",
      description: 'Custom file mapping format: "md:.rules,path/to/file json:*.jsonc"',
      inputSources: ["flag"],
    },
    recursive: {
      type: "boolean",
      defaultValue: true,
      description: "Process directories recursively",
      inputSources: ["flag", "default"],
    },
    unescape: {
      type: "boolean",
      description:
        "Reverse the escape operation, converting escaped .ts/.js modules back to plain files",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const emitUsageError = (message: string): never => {
      ctx.output.problem({
        code: "REMPTS_USAGE",
        hint: HELP_HINT,
        kind: "usage",
        message,
        ok: false,
        relatedCommand: COMMAND_NAME,
        remptsError: 1,
        schemaVersion: 1,
        usage: USAGE,
      });

      ctx.exit(1);
      throw new ReportedUsageError();
    };

    try {
      const inputPath =
        toRequiredString(ctx.options.input) ??
        emitUsageError("Missing required option: --input <path>.");

      const apply = ctx.safety.apply === true;
      const overwrite = ctx.options.overwrite === true;
      const unescape = ctx.options.unescape === true;
      const recursive = ctx.options.recursive !== false;
      const map = toOptionalString(ctx.options.map);
      const isJsonOutput = ctx.output.mode === "json";

      if (apply) {
        ctx.safety.assertApplied("fs.write");
      }

      if (unescape && map) {
        emitUsageError("--map can only be used when converting files, not when unescaping.");
      }

      const result = await runEscape({
        inputPath, // Type 'string | undefined' is not assignable to type 'string'. The expected type comes from property 'inputPath' which is declared here on type 'EscapeRunOptions'
        apply,
        overwrite,
        recursive,
        unescape,
        map,
      });

      if (!isJsonOutput) {
        const { stdout } = ctx.colors;
        const infoLabel = (text: string) => stdout.cyan(stdout.bold(text));
        const okLabel = (text: string) => stdout.green(stdout.bold(text));
        const warnLabel = (text: string) => stdout.yellow(stdout.bold(text));

        ctx.out(`${infoLabel("Processing:")} ${result.fileCount} file(s)...`);

        for (const action of result.actions) {
          ctx.out(formatEscapeActionMessage(action));
        }

        ctx.out(
          `${infoLabel("Summary:")} ${result.written} written, ${result.planned} planned, ${result.noop} no-op, ${result.blocked} blocked.`,
        );

        ctx.out(
          result.preview
            ? okLabel("Preview complete!")
            : result.kind === "unescape"
              ? okLabel("Unescape complete!")
              : okLabel("Conversion complete!"),
        );

        if (result.blocked > 0) {
          ctx.exit(
            1,
            `${warnLabel("Blocked outputs:")} Re-run with --overwrite to overwrite them.`,
          );
          return;
        }
      }

      if (result.blocked > 0) {
        if (isJsonOutput) {
          ctx.output.data({
            ...result,
            ok: false,
            remptsPreview: 1,
          });
        }

        ctx.exit(1, "Blocked outputs: re-run with --overwrite to overwrite them.");
        return;
      }

      if (isJsonOutput) {
        ctx.output.result(result, COMMAND_NAME);
      }
    } catch (error) {
      if (error instanceof ReportedUsageError) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      if (isEscapeUsageErrorMessage(message)) {
        emitUsageError(message);
      }

      ctx.exit(1, message);
    }
  },
});

function toRequiredString(value: unknown): string | undefined {
  const text = toOptionalString(value);
  return text?.trim() || undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function isEscapeUsageErrorMessage(message: string): boolean {
  return (
    message.includes("Missing required option") ||
    message.includes("--map can only be used") ||
    message.includes("No escaped files found to process") ||
    message.includes("No files found to process") ||
    message.includes("Input path does not exist") ||
    message.includes("Input path is neither a file nor a directory")
  );
}
