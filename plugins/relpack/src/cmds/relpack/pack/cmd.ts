import { defineCommand } from "@reliverse/rempts";

import { packArchive } from "../../../impl/core/commands/pack";
import { detectArchiveFormat, normalizeArchiveFormat } from "../../../impl/core/format";
import { buildIgnoredNames, parseIgnoredNameInput } from "../../../impl/core/ignore";
import {
  buildRelpackCommand,
  emitUsageError,
  formatPackOutput,
  getCommandContext,
  handleRelpackError,
  isDryRun,
  isExplicitDryRun,
  isJsonOutput,
  normalizeArgs,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toBackendCommand,
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
      "rse relpack pack . -o repo.zip --show-skipped",
      "rse relpack pack ./dist -o dist.zip --no-manifest --apply",
    ],
    text: `Create an archive. Preview is the default; pass --apply to write. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description: "Output archive path. Required for pack.",
      inputSources: ["flag"],
    },
    format: {
      type: "string",
      description: `Archive format override. Usually inferred from -o. Values: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Allow replacing an existing output archive. Still requires --apply to write.",
      inputSources: ["flag"],
    },
    dryRun: {
      type: "boolean",
      description: "Force preview mode and print what would happen without creating an archive.",
      inputSources: ["flag"],
    },
    ignore: {
      type: "string",
      description: "Comma-separated extra file or directory names to skip while packing.",
      inputSources: ["flag"],
    },
    includeIgnored: {
      type: "boolean",
      description: "Disable relpack's default junk/secret ignore list and include ignored names intentionally.",
      inputSources: ["flag"],
    },
    showSkipped: {
      type: "boolean",
      description: "Print skipped path examples from default/custom ignore rules.",
      inputSources: ["flag"],
    },
    noManifest: {
      type: "boolean",
      description: "Do not embed .relpack/manifest.json into the archive.",
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
      const overwrite = ctx.options?.overwrite === true;
      const includeIgnored = ctx.options?.includeIgnored === true;
      const showSkipped = ctx.options?.showSkipped === true;
      const manifestEnabled = ctx.options?.noManifest !== true;
      const extraIgnoredNames = parseIgnoredNameInput(ctx.options?.ignore);
      const ignoredNames = buildIgnoredNames({
        includeDefaultIgnores: !includeIgnored,
        extraIgnoredNames,
      });

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
          ignoredNames,
          manifest: manifestEnabled,
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
          dryRun,
          skipped: result.skipped,
          manifest: result.manifest,
        });
        return;
      }

      const formatFlag = format === undefined ? [] : ["--format", format];
      const overwriteFlag = overwrite ? ["--overwrite"] : [];
      const ignoreFlag = extraIgnoredNames.length > 0 ? ["--ignore", extraIgnoredNames.join(",")] : [];
      const includeIgnoredFlag = includeIgnored ? ["--include-ignored"] : [];
      const showSkippedFlag = showSkipped ? ["--show-skipped"] : [];
      const noManifestFlag = manifestEnabled ? [] : ["--no-manifest"];
      const baseParts = [
        "pack",
        ...inputs,
        "-o",
        output,
        ...formatFlag,
        ...overwriteFlag,
        ...ignoreFlag,
        ...includeIgnoredFlag,
        ...showSkippedFlag,
        ...noManifestFlag,
      ];
      const applyCommand = buildRelpackCommand([...baseParts, "--apply"]);
      const overwriteApplyCommand = buildRelpackCommand([
        "pack",
        ...inputs,
        "-o",
        output,
        ...formatFlag,
        ...ignoreFlag,
        ...includeIgnoredFlag,
        ...showSkippedFlag,
        ...noManifestFlag,
        "--overwrite",
        "--apply",
      ]);

      ctx.out?.(
        formatPackOutput({
          inputs,
          output,
          format: normalizedFormat,
          overwrite,
          dryRun,
          explicitDryRun: isExplicitDryRun(ctx),
          backendCommand: toBackendCommand(result),
          ignoredNames,
          includeDefaultIgnores: !includeIgnored,
          extraIgnoredNames,
          applyCommand,
          overwriteApplyCommand,
          skipped: result.skipped,
          showSkipped,
          manifest: result.manifest,
          manifestEnabled,
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
