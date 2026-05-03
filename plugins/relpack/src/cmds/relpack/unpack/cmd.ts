import { defineCommand } from "@reliverse/rempts";

import { unpackArchive } from "../../../impl/core/commands/unpack";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import {
  emitUsageError,
  getCommandContext,
  handleRelpackError,
  isDryRun,
  isJsonOutput,
  normalizeArgs,
  printExecuted,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
  toOptionalString,
  toOverwritePolicy,
} from "../_shared";

const COMMAND_NAME = "unpack";
const USAGE = "rse relpack unpack <archive> [-o <dir>] [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Safely extract an archive into an output directory.",
  },
  agent: {
    notes:
      "Use --apply when you need this command to extract files. Without --apply, the command validates and prints the backend command only.",
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
      "rse relpack unpack dist.tar.zst -o ./out",
      "rse relpack unpack dist.tar.zst -o ./out --apply",
      "rse relpack unpack dist.zip -o ./out --overwrite --apply",
      "rse relpack unpack dist.7z --format 7z -o ./out --apply",
      "rse relpack unpack dist.tar.zst -o ./out --dry-run",
      "rse relpack unpack dist.tar.zst -o ./out --json",
    ],
    text: `Extract an archive after validating archive entry paths. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description: "Output directory path",
      inputSources: ["flag"],
    },
    format: {
      type: "string",
      description: `Archive format override: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing existing files during extraction",
      inputSources: ["flag"],
    },
    dryRun: {
      type: "boolean",
      description: "Print the backend command without extracting files",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const [archive] = normalizeArgs(ctx.args);
      const outputDir = toOptionalString(ctx.options?.output) ?? ".";
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const dryRun = isDryRun(ctx);

      if (archive === undefined) {
        emitUsageError(ctx, COMMAND_NAME, USAGE, "Unpack command requires an archive path.");
      }

      if (!dryRun) {
        ctx.safety?.assertApplied?.("fs.write");
      }

      const result = await unpackArchive(
        {
          cwd: commandContext.cwd,
          archive,
          outputDir,
          ...(format === undefined ? {} : { format }),
          overwrite: toOverwritePolicy(ctx.options?.overwrite),
          dryRun,
        },
        commandContext,
      );

      const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(archive));
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
        ctx.out?.(`extracted: ${archive}`);
      }
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
