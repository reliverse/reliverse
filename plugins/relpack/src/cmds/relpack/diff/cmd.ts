import { defineCommand } from "@reliverse/rempts";

import { diffArchiveWithOutput } from "../../../impl/core/commands/diff";
import { buildIgnoredNames, parseIgnoredNameInput } from "../../../impl/core/ignore";
import {
  emitUsageError,
  formatDiffOutput,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  printJson,
  RELPACK_FORMATS,
  resolveArchiveArgs,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
  toOptionalString,
} from "../_shared";

const COMMAND_NAME = "diff";
const USAGE = "rse relpack diff <archive> -o <dir> [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Compare an archive with an output directory before extraction.",
  },
  conventions: {
    idempotent: true,
    supportsApply: false,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: false,
    effects: ["fs.read"],
  },
  help: {
    examples: [
      "rse relpack diff relpack-0.1.0.zip -o ./plugins/relpack",
      "rse relpack diff './relpack-*.zip' -o ./plugins/relpack",
      "rse relpack diff dist.tar.zst -o ./out --format tar.zst",
      "rse relpack diff dist.zip -o ./out --ignore node_modules,dist",
      "rse relpack diff dist.zip -o ./out --json",
    ],
    text: `Compare archive contents with a target directory. Archive globs like ./relpack-*.zip are supported. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description: "Directory to compare against. Required for diff.",
      inputSources: ["flag"],
    },
    format: {
      type: "string",
      description: `Archive format override. Usually inferred from the archive filename. Values: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    ignore: {
      type: "string",
      description: "Comma-separated extra output names to ignore while finding removed files.",
      inputSources: ["flag"],
    },
    includeIgnored: {
      type: "boolean",
      description: "Disable default ignored names while finding removed files.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const archiveResolution = await resolveArchiveArgs(ctx, COMMAND_NAME, USAGE, commandContext.cwd);
      const archive = archiveResolution.archive;
      const outputDir = toOptionalString(ctx.options?.output);
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const extraIgnoredNames = parseIgnoredNameInput(ctx.options?.ignore);
      const ignoredNames = buildIgnoredNames({
        includeDefaultIgnores: ctx.options?.includeIgnored !== true,
        extraIgnoredNames,
      });

      if (outputDir === undefined) {
        emitUsageError(ctx, COMMAND_NAME, USAGE, "Diff command requires -o or --output.");
      }

      const result = await diffArchiveWithOutput(
        {
          cwd: commandContext.cwd,
          archive,
          outputDir,
          ...(format === undefined ? {} : { format }),
          ignoredNames,
        },
        commandContext,
      );

      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: true,
          command: COMMAND_NAME,
          format: result.format,
          diagnostics: [],
          archiveResolution,
          result,
        });
        return;
      }

      ctx.out?.(formatDiffOutput(result, archiveResolution));
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
