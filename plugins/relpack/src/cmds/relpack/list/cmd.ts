import { defineCommand } from "@reliverse/rempts";

import { listArchive } from "../../../impl/core/commands/list";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import {
  emitUsageError,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  normalizeArgs,
  printEntries,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
} from "../_shared";

const COMMAND_NAME = "list";
const USAGE = "rse relpack list <archive> [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "List archive entries after validating their paths.",
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
      "rse relpack list dist.tar.zst",
      "rse relpack list dist.zip --json",
      "rse relpack list dist.7z --format 7z",
    ],
    text: `List entries in an archive. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    format: {
      type: "string",
      description: `Archive format override: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const [archive] = normalizeArgs(ctx.args);
      const format = toOptionalArchiveFormat(ctx.options?.format);

      if (archive === undefined) {
        emitUsageError(ctx, COMMAND_NAME, USAGE, "List command requires an archive path.");
      }

      const entries = await listArchive(
        {
          cwd: commandContext.cwd,
          archive,
          ...(format === undefined ? {} : { format }),
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
          entries,
        });
      } else {
        printEntries(ctx, entries);
      }
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
