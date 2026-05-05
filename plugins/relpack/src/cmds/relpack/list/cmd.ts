import { defineCommand } from "@reliverse/rempts";

import { listArchive } from "../../../impl/core/commands/list";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import { tryReadManifestFromArchive } from "../../../impl/core/manifest";
import {
  formatListOutput,
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
      "rse relpack list dist.zip --tree --max-depth 3",
      "rse relpack list dist.zip --json",
      "rse relpack list './relpack-*.zip'",
      "rse relpack list dist.7z --format 7z",
    ],
    text: `List entries in an archive with summary stats. Archive globs like ./relpack-*.zip are supported. This command is read-only and does not need --apply. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    format: {
      type: "string",
      description: `Archive format override. Usually inferred from the archive filename. Values: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    tree: {
      type: "boolean",
      description: "Print entries as a compact tree instead of a flat list.",
      inputSources: ["flag"],
    },
    maxDepth: {
      type: "string",
      description: "Limit --tree output depth, e.g. --max-depth 3.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const archiveResolution = await resolveArchiveArgs(ctx, COMMAND_NAME, USAGE, commandContext.cwd);
      const archive = archiveResolution.archive;
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const tree = ctx.options?.tree === true;
      const maxDepthValue = toOptionalString(ctx.options?.maxDepth);
      const maxDepth = maxDepthValue === undefined ? undefined : Number(maxDepthValue);

      if (maxDepthValue !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
        throw new Error("--max-depth must be a positive integer.");
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
      const manifest = await tryReadManifestFromArchive(archive, normalizedFormat, commandContext);

      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: true,
          command: COMMAND_NAME,
          format: normalizedFormat,
          diagnostics: [],
          archiveResolution,
          entries,
          manifest,
        });
        return;
      }

      ctx.out?.(
        formatListOutput({
          archive,
          archiveResolution,
          format: normalizedFormat,
          entries,
          ...(manifest === undefined ? {} : { manifest }),
          tree,
          ...(maxDepth === undefined ? {} : { maxDepth }),
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
