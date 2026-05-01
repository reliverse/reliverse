import { defineCommand } from "@reliverse/rempts";

import { formatPtcSummary, runPtc, type PtcOptions } from "../../impl/ptc/index";

const COMMAND_NAME = "ptc";
const USAGE = "rse ptc [flags] <input-path...>";
const HELP_HINT = 'Run "rse ptc --help" for examples and flag details.';
const REPORTED_USAGE_ERROR = Symbol("reported usage error");

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      "Pack project text files into one `.txt` context file, or unpack a packed context back into files.",
  },
  agent: {
    notes:
      "Use --apply when you need this command to write files. Use --overwrite when replacing an existing packed output file or unpacked target files.",
  },
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
      "rse ptc . -o monorepo-context.txt --allow-dot",
      "rse ptc packages/rempts -o rempts-context.txt",
      "rse ptc packages/rempts -o rempts-context.txt --apply",
      "rse ptc packages/rempts -o rempts-context.txt --overwrite --apply",
      "rse ptc rempts-context.patched.txt --unpack --overwrite --apply",
      "rse ptc rempts-context.patched.txt --unpack -o /home/blefnk/dev/reliverse/reliverse --overwrite --apply",
      "rse ptc packages/rempts -o rempts-context.txt --ext ts,tsx,json,md",
      "rse ptc packages/rempts -o rempts-context.txt --ignore tmp,logs",
      "rse ptc packages/rempts -o rempts-context.txt --max-size 500kb",
    ],
    text: "Pack your project text files into one deterministic `.txt` context file, or unpack a packed context file back into the original project tree recorded in its metadata.",
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description: "Output file path for packing, or original packed project root for unpacking",
      inputSources: ["flag"],
    },
    ext: {
      type: "string",
      description: "Comma-separated exact extension allowlist, replacing defaults",
      inputSources: ["flag"],
    },
    extMerge: {
      type: "string",
      description: "Comma-separated extension allowlist merged into defaults",
      inputSources: ["flag"],
    },
    ignore: {
      type: "string",
      description: "Comma-separated names to ignore in addition to defaults",
      inputSources: ["flag"],
    },
    maxSize: {
      type: "string",
      defaultValue: "1mb",
      description: "Maximum file size to include, e.g. 500kb, 1mb, 2000b, or unlimited",
      inputSources: ["flag", "default"],
    },
    includeHidden: {
      type: "boolean",
      description: "Include hidden paths inside walked directories",
      inputSources: ["flag"],
    },
    unpack: {
      type: "boolean",
      description:
        "Unpack a packed context file back into the original project tree from its metadata",
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing an existing packed output file or unpacked target files",
      inputSources: ["flag"],
    },
    allowDot: {
      type: "boolean",
      description: "Allow using `.` as an input path for packing",
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
      throw REPORTED_USAGE_ERROR;
    };

    try {
      const inputPaths = normalizeInputPaths(ctx.args);
      const isUnpack = ctx.options.unpack === true;
      const allowDot = ctx.options.allowDot === true;
      const hasDotInput = hasDotInputPath(inputPaths);
      const apply = ctx.safety.apply === true;

      if (apply) {
        ctx.safety.assertApplied("fs.write");
      }

      if (!isUnpack && hasDotInput && !allowDot) {
        emitUsageError(
          "Using `.` as an input path is blocked by default to avoid packing entire repositories by mistake. Pass --allow-dot to enable it intentionally.",
        );
      }

      if (!apply && !isUnpack && hasDotInput) {
        const { stdout } = ctx.colors;
        const warning = stdout.bold("Warning:");
        const applyFlag = stdout.bold("--apply");
        const extFlag = stdout.bold("--ext");
        const ignoreFlag = stdout.bold("--ignore");
        const maxSizeFlag = stdout.bold("--max-size");

        ctx.out(
          [
            "",
            stdout.yellow(
              `${warning} You selected "." as an input path, so ptc will scan from the current project root.`,
            ),
            stdout.yellow("         This can produce a very large context output."),
            stdout.yellow(
              `         Before running with ${applyFlag}, narrow the scope with input paths and filters, for example ${extFlag}, ${ignoreFlag}, or ${maxSizeFlag}.`,
            ),
            "",
          ].join("\n"),
        );
      }

      const options: PtcOptions = {
        inputPaths,
        outputPath: toOptionalString(ctx.options.output),
        apply,
        ext: toOptionalStringArrayInput(ctx.options.ext),
        extMerge: toOptionalStringArrayInput(ctx.options.extMerge),
        ignore: toOptionalStringArrayInput(ctx.options.ignore),
        maxSize: toOptionalMaxSize(ctx.options.maxSize),
        includeHidden: ctx.options.includeHidden === true,
        unpack: isUnpack,
        overwrite: ctx.options.overwrite === true,
      };

      const run = await runPtc(options);

      ctx.out(
        formatPtcSummary(run, {
          heading: (text) => ctx.colors.stdout.cyan(ctx.colors.stdout.bold(text)),
          key: (text) => ctx.colors.stdout.blue(ctx.colors.stdout.bold(text)),
          value: (text) => ctx.colors.stdout.white(text),
          info: (text) => ctx.colors.stdout.cyan(text),
          warning: (text) => ctx.colors.stdout.yellow(text),
          success: (text) => ctx.colors.stdout.green(text),
          error: (text) => ctx.colors.stdout.red(text),
        }),
      );
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      if (isPtcUsageErrorMessage(message)) {
        emitUsageError(message);
      }

      ctx.exit(1, message);
    }
  },
});

function normalizeInputPaths(args: unknown): string[] {
  if (!Array.isArray(args)) {
    return [];
  }

  return args
    .map(String)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function hasDotInputPath(inputPaths: string[]): boolean {
  return inputPaths.some((inputPath) => {
    const normalized = inputPath.replace(/\\/g, "/");
    return normalized === "." || normalized === "./";
  });
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

function toOptionalStringArrayInput(value: unknown): string | string[] | undefined {
  if (Array.isArray(value)) {
    const values = value
      .filter(
        (item): item is string | number => typeof item === "string" || typeof item === "number",
      )
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);

    return values.length > 0 ? values : undefined;
  }

  return toOptionalString(value);
}

function toOptionalMaxSize(value: unknown): string | number | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function isPtcUsageErrorMessage(message: string): boolean {
  return (
    message.includes("At least one input path is required") ||
    message.includes("Unpack mode expects exactly one packed context file") ||
    message.includes("Use either --ext or --ext-merge, not both") ||
    message.includes("Invalid max size") ||
    message.includes("Unsupported extension from") ||
    message.includes("did not include any supported text extensions")
  );
}
