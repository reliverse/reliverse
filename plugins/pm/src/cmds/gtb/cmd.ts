import { defineCommand } from "@reliverse/rempts";

import {
  formatGtbSummary,
  isGtbUsageErrorMessage,
  normalizeGtbOptions,
  runGtb,
  type GtbOptions,
} from "./impl/index";

const COMMAND_NAME = "gtb";
const USAGE = "rse gtb [flags] [package]";
const HELP_HINT = 'Run "rse gtb --help" for examples and flag details.';
const REPORTED_USAGE_ERROR = Symbol("reported usage error");

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description:
      "Get npm package tarballs with smart optional dependency resolution for platform-native packages.",
  },
  agent: {
    notes:
      "Use --apply when you need this command to run npm pack and write tarballs. In preview mode, use the output plan to verify exact package versions before applying.",
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
      "rse gtb typescript",
      "rse gtb --package typescript",
      "rse gtb --package typescript --version 6.0.3",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 --apply",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 -o ./tarballs --apply",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 --include-optional false --apply",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 --optional-mode all --apply",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 --overwrite --apply",
      "rse gtb --package @typescript/native-preview --tag beta --os linux --arch x64 --json",
      "rse gtb --aliased --package tsgo --tag beta --os linux --arch x64",
      "rse gtb --aliased --package tsgo --tag beta --os linux --arch x64 -o ./tarballs --apply",
      "rse gtb --aliased --package tsgo --os linux --arch x64 -o ./tarballs --apply",
    ],
    text: "Get npm tarballs through npm pack. The command resolves dist-tags to exact versions and can automatically include platform-matching optional dependencies, which is useful for native preview packages such as TypeScript 7 tsgo.",
  },
  options: {
    package: {
      type: "string",
      description: "Package name, package spec, or alias when --aliased is enabled.",
      inputSources: ["flag"],
    },
    tag: {
      type: "string",
      description:
        "npm dist-tag to resolve when --version is not provided, e.g. beta, next, canary. Aliases can provide their own default tag.",
      inputSources: ["flag"],
    },
    version: {
      type: "string",
      description: "Exact npm package version or version range. When provided, it wins over --tag.",
      inputSources: ["flag"],
    },
    os: {
      type: "string",
      description:
        "Target OS used for platform optional dependency matching. Defaults to current OS. Common values: linux, darwin, win32.",
      inputSources: ["flag"],
    },
    arch: {
      type: "string",
      description:
        "Target CPU architecture used for platform optional dependency matching. Defaults to current architecture. Common values: x64, arm64.",
      inputSources: ["flag"],
    },
    output: {
      type: "string",
      short: "o",
      description: "Directory where tarballs are written. Defaults to the current directory.",
      inputSources: ["flag"],
    },
    includeOptional: {
      type: "boolean",
      defaultValue: true,
      description:
        "Include optional dependency tarballs. Defaults to true because native packages often hide their binary there.",
      inputSources: ["flag", "default"],
    },
    optionalMode: {
      type: "string",
      defaultValue: "matching",
      description:
        "Optional dependency mode: matching, all, or none. matching keeps only dependencies matching --os/--arch.",
      inputSources: ["flag", "default"],
    },
    aliased: {
      type: "boolean",
      defaultValue: false,
      description:
        "Treat --package as an Rse reserved alias, e.g. tsgo -> @typescript/native-preview.",
      inputSources: ["flag", "default"],
    },
    npmBin: {
      type: "string",
      defaultValue: "npm",
      description: "npm executable to use for npm view/npm pack.",
      inputSources: ["flag", "default"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing existing tarballs in the output directory.",
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
      const apply = ctx.safety.apply === true;

      if (apply) {
        ctx.safety.assertApplied("fs.write");
      }

      const options: GtbOptions = normalizeGtbOptions({
        args: ctx.args,
        options: { ...ctx.options, json: ctx.globalFlags.json },
        apply,
      });

      const run = await runGtb(options);

      if (options.json) {
        ctx.out(`${JSON.stringify(run, null, 2)}\n`);
        return;
      }

      ctx.out(
        formatGtbSummary(run, {
          heading: (text) => ctx.colors.stdout.cyan(ctx.colors.stdout.bold(text)),
          key: (text) => ctx.colors.stdout.blue(ctx.colors.stdout.bold(text)),
          value: (text) => ctx.colors.stdout.white(text),
          info: (text) => ctx.colors.stdout.cyan(text),
          warning: (text) => ctx.colors.stdout.yellow(text),
          success: (text) => ctx.colors.stdout.green(text),
          muted: (text) => ctx.colors.stdout.gray(text),
          error: (text) => ctx.colors.stdout.red(text),
        }),
      );
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);

      if (isGtbUsageErrorMessage(message)) {
        emitUsageError(message);
      }

      ctx.exit(1, message);
    }
  },
});
