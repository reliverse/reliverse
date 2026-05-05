import { defineCommand } from "@reliverse/rempts";

import { verifyArchive } from "../../../impl/core/commands/verify";
import {
  formatVerifyOutput,
  getCommandContext,
  handleRelpackError,
  isJsonOutput,
  printJson,
  RELPACK_FORMATS,
  resolveArchiveArgs,
  REPORTED_USAGE_ERROR,
  toOptionalArchiveFormat,
} from "../_shared";

const COMMAND_NAME = "verify";
const USAGE = "rse relpack verify <archive> [flags]";

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Verify a relpack manifest embedded in an archive.",
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
      "rse relpack verify relpack-0.1.0.zip",
      "rse relpack verify './relpack-*.zip'",
      "rse relpack verify dist.tar.zst --format tar.zst",
      "rse relpack verify dist.zip --json",
    ],
    text: `Verify that archive entries match .relpack/manifest.json. Supported formats: ${RELPACK_FORMATS}.`,
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
      const archiveResolution = await resolveArchiveArgs(ctx, COMMAND_NAME, USAGE, commandContext.cwd);
      const archive = archiveResolution.archive;
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const result = await verifyArchive(
        {
          cwd: commandContext.cwd,
          archive,
          ...(format === undefined ? {} : { format }),
        },
        commandContext,
      );

      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: result.ok,
          command: COMMAND_NAME,
          format: result.format,
          diagnostics: [],
          archiveResolution,
          result,
        });
        return;
      }

      ctx.out?.(formatVerifyOutput(result, archiveResolution));
      if (!result.ok) {
        ctx.exit(1);
      }
    } catch (error) {
      if (error === REPORTED_USAGE_ERROR) {
        return;
      }

      handleRelpackError(ctx, COMMAND_NAME, error);
    }
  },
});
