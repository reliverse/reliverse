import { defineCommand } from "@reliverse/rempts";

import { testArchive } from "../../../impl/core/commands/test";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import {
  emitUsageError,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  normalizeArgs,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
} from "../_shared";

const COMMAND_NAME = "test";
const USAGE = "rse relpack test <archive> [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Validate that an archive can be read by the selected backend.",
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
      "rse relpack test dist.tar.zst",
      "rse relpack test dist.zip --json",
      "rse relpack test dist.7z --format 7z",
    ],
    text: `Test archive readability. Supported formats: ${RELPACK_FORMATS}.`,
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
        emitUsageError(ctx, COMMAND_NAME, USAGE, "Test command requires an archive path.");
      }

      await testArchive(
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
        });
      } else {
        ctx.out?.(`ok: ${archive}`);
      }
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
