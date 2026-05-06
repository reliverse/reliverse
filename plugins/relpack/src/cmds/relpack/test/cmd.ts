import { defineCommand } from "@reliverse/rempts";

import { testArchive } from "../../../impl/core/commands/test";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import {
  formatTestOutput,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  printJson,
  RELPACK_FORMATS,
  resolveArchiveArgs,
  REPORTED_USAGE_ERROR,
  toBackendCommand,
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
      "rse relpack test './relpack-*.zip'",
      "rse relpack test dist.7z --format 7z",
    ],
    text: `Test archive readability. Archive globs like ./relpack-*.zip are supported. This command is read-only and does not need --apply. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    format: {
      type: "string",
      description: `Archive format override. Usually inferred from the archive filename. Values: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const archiveResolution = await resolveArchiveArgs(
        ctx,
        COMMAND_NAME,
        USAGE,
        commandContext.cwd,
      );
      const archive = archiveResolution.archive;
      const format = toOptionalArchiveFormat(ctx.options?.format);

      const result = await testArchive(
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
          executed: [result.command, ...result.args],
          archiveResolution,
        });
        return;
      }

      ctx.out?.(
        formatTestOutput({
          archive,
          archiveResolution,
          format: normalizedFormat,
          backendCommand: toBackendCommand(result),
        }),
      );
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
