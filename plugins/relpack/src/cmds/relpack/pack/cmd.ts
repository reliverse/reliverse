import { defineCommand } from "@reliverse/rempts";

import { packArchive } from "../../../impl/core/commands/pack";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import {
  emitUsageError,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  isDryRun,
  normalizeArgs,
  printExecuted,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
  toOptionalString,
  toOverwritePolicy,
} from "../_shared";

const COMMAND_NAME = "pack";
const USAGE = "rse relpack pack <input...> -o <archive> [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Create an archive from files or directories.",
  },
  agent: {
    notes:
      "Use --apply when you need this command to create or replace an archive. Without --apply, the command runs as a dry run.",
  },
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.read", "fs.write"],
  },
  help: {
    examples: [
      "rse relpack pack ./dist -o dist.tar.zst",
      "rse relpack pack ./dist -o dist.tar.zst --apply",
      "rse relpack pack ./dist -o dist.zip --format zip --apply",
      "rse relpack pack ./dist ./README.md -o release.tar.gz --overwrite --apply",
      "rse relpack pack ./dist -o dist.tar.zst --dry-run",
      "rse relpack pack ./dist -o dist.tar.zst --json",
    ],
    text: `Create an archive. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description: "Output archive path",
      inputSources: ["flag"],
    },
    format: {
      type: "string",
      description: `Archive format override: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing an existing output archive",
      inputSources: ["flag"],
    },
    dryRun: {
      type: "boolean",
      description: "Print the backend command without creating an archive",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const inputs = normalizeArgs(ctx.args);
      const output = toOptionalString(ctx.options?.output);
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const dryRun = isDryRun(ctx);

      if (inputs.length === 0) {
        emitUsageError(ctx, COMMAND_NAME, USAGE, "Pack command requires at least one input path.");
      }

      if (output === undefined) {
        emitUsageError(ctx, COMMAND_NAME, USAGE, "Pack command requires -o or --output.");
      }

      if (!dryRun) {
        ctx.safety?.assertApplied?.("fs.write");
      }

      const result = await packArchive(
        {
          cwd: commandContext.cwd,
          inputs,
          output,
          ...(format === undefined ? {} : { format }),
          overwrite: toOverwritePolicy(ctx.options?.overwrite),
          dryRun,
        },
        commandContext,
      );

      const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(output));
      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: true,
          command: COMMAND_NAME,
          format: normalizedFormat,
          diagnostics: [],
          executed: [result.command, ...result.args],
        });
      } else if (dryRun) {
        printExecuted(ctx, result.command, result.args);
      } else {
        ctx.out?.(`created: ${output}`);
      }
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
