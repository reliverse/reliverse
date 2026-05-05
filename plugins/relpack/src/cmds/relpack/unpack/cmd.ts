import { defineCommand } from "@reliverse/rempts";

import { unpackArchiveBatch, deleteBatchSourceArchives } from "../../../impl/core/commands/unpack-batch";
import { normalizeArchiveFormat } from "../../../impl/core/format";
import {
  looksLikeArchiveInput,
  resolveArchiveInput,
  resolveArchiveInputs,
  type ArchiveInputResolution,
} from "../../../impl/core/glob";
import type { ArchiveFormat, BatchUnpackItem } from "../../../impl/core/types";
import {
  buildRelpackCommand,
  emitUsageError,
  formatBatchUnpackOutput,
  formatUnpackOutput,
  getCommandContext,
  handleRelpackError,
  isDryRun,
  isExplicitDryRun,
  isJsonOutput,
  normalizeArgs,
  overwriteModeToPolicy,
  printJson,
  RELPACK_FORMATS,
  REPORTED_USAGE_ERROR,
  toBackendCommand,
  toOptionalArchiveFormat,
  toOptionalString,
  toUnpackOverwriteMode,
  type RelpackCommandCtx,
} from "../_shared";

const COMMAND_NAME = "unpack";
const USAGE = "rse relpack unpack <archive...> -o <dir...> [flags]";

type UnpackTarget = BatchUnpackItem & {
  readonly archiveResolution: ArchiveInputResolution;
};

export default defineCommand({
  meta: {
    name: COMMAND_NAME,
    description: "Safely extract one or more archives into output directories.",
  },
  agent: {
    notes:
      "Use --apply when you need this command to extract files. Without --apply, the command validates and prints a preview only. For multi-archive updates, pair archive inputs and output directories in order.",
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
      "rse relpack unpack './relpack-*.zip' -o ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --apply",
      "rse relpack unpack './rse-*.zip' './relpack-*.zip' -o ./apps/rse ./plugins/relpack --overwrite-mode clean --backup --rollback-on-fail --post-check-command 'bun test apps/rse plugins/relpack' --delete-archive --apply",
      "rse relpack unpack dist.7z --format 7z -o ./out --apply",
      "rse relpack unpack dist.tar.zst -o ./out --dry-run",
      "rse relpack unpack dist.tar.zst -o ./out --json",
    ],
    text: `Extract archives after validating archive entry paths. Archive globs like ./relpack-*.zip are supported. Batch mode maps archive inputs to output directories in order. Preview is the default; pass --apply to write. Use --overwrite-mode never|files|clean to control collisions. Use --backup + --rollback-on-fail for safe updates. Supported formats: ${RELPACK_FORMATS}.`,
  },
  options: {
    output: {
      type: "string",
      short: "o",
      description:
        "Output directory path. In batch mode, pass one output per archive; additional output dirs may follow the first -o value positionally.",
      inputSources: ["flag"],
    },
    format: {
      type: "string",
      description: `Archive format override. Usually inferred from the archive filename. Values: ${RELPACK_FORMATS}`,
      inputSources: ["flag"],
    },
    overwrite: {
      type: "boolean",
      description: "Shorthand for --overwrite-mode files. Still requires --apply to write.",
      inputSources: ["flag"],
    },
    overwriteMode: {
      type: "string",
      description: "Collision mode: never, files, or clean. clean deletes explicit -o/--output before extraction.",
      inputSources: ["flag"],
    },
    dryRun: {
      type: "boolean",
      description: "Force preview mode and print what would happen without extracting files.",
      inputSources: ["flag"],
    },
    deleteArchive: {
      type: "boolean",
      description: "Delete source archive(s) after successful extraction and post-check. Only runs with --apply.",
      inputSources: ["flag"],
    },
    cleanOutput: {
      type: "boolean",
      description:
        "Delete the explicit -o/--output directory before extraction. Equivalent to --overwrite-mode clean.",
      inputSources: ["flag"],
    },
    backup: {
      type: "boolean",
      description: "Create sibling .relpack-backup-* copies of output directories before extraction.",
      inputSources: ["flag"],
    },
    rollbackOnFail: {
      type: "boolean",
      description: "Restore backups if extraction or post-check fails. Requires --backup.",
      inputSources: ["flag"],
    },
    postCheckCommand: {
      type: "string",
      description:
        "Shell command to run after extraction and before --delete-archive, e.g. 'bun test apps/rse plugins/relpack'. In batch mode it runs once after all archives extract.",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    try {
      const commandContext = getCommandContext();
      const format = toOptionalArchiveFormat(ctx.options?.format);
      const dryRun = isDryRun(ctx);
      const deleteArchive = ctx.options?.deleteArchive === true;
      const overwriteMode = toUnpackOverwriteMode(ctx.options);
      const cleanOutput = ctx.options?.cleanOutput === true || overwriteMode === "clean";
      const backup = ctx.options?.backup === true;
      const rollbackOnFail = ctx.options?.rollbackOnFail === true;
      const postCheckCommand = toOptionalString(ctx.options?.postCheckCommand);
      const targets = await resolveUnpackTargets(ctx, commandContext.cwd, format);

      validateUnpackOptions(ctx, {
        cleanOutput,
        overwriteMode,
        backup,
        rollbackOnFail,
        hasExplicitOutput: targets.every((target) => target.outputDir !== "."),
        batch: targets.length > 1,
        format,
      });

      if (!dryRun) {
        ctx.safety?.assertApplied?.("fs.write");
      }

      const result = await unpackArchiveBatch(
        {
          cwd: commandContext.cwd,
          items: targets.map(({ archive, outputDir, format }) => ({
            archive,
            outputDir,
            ...(format === undefined ? {} : { format }),
          })),
          overwrite: overwriteModeToPolicy(cleanOutput ? "clean" : overwriteMode),
          dryRun,
          cleanOutput,
          backup,
          rollbackOnFail,
          ...(postCheckCommand === undefined ? {} : { postCheckCommand }),
        },
        commandContext,
      );

      const deletedArchivePaths = deleteArchive && !dryRun
        ? await deleteBatchSourceArchives(result.items, commandContext.cwd)
        : [];

      if (targets.length === 1) {
        const [target] = targets;
        const [itemResult] = result.items;
        if (!target || !itemResult) {
          emitUsageError(ctx, COMMAND_NAME, USAGE, "Unpack command could not resolve an archive target.");
        }

        if (isJsonOutput(ctx)) {
          printJson(ctx, {
            ok: true,
            command: COMMAND_NAME,
            format: itemResult.format,
            diagnostics: [],
            executed: [itemResult.result.command, ...itemResult.result.args],
            archiveResolution: target.archiveResolution,
            dryRun,
            deleteArchive,
            cleanOutput,
            overwriteMode,
            backup,
            rollbackOnFail,
            backups: result.backups,
            postCheck: result.postCheck,
            deletedArchivePaths,
          });
          return;
        }

        const applyCommand = buildSingleApplyCommand(target, {
          format,
          overwriteMode,
          deleteArchive,
          cleanOutput: ctx.options?.cleanOutput === true,
          backup,
          rollbackOnFail,
          postCheckCommand,
        });
        const overwriteApplyCommand = buildSingleApplyCommand(target, {
          format,
          overwriteMode: "files",
          deleteArchive,
          cleanOutput: false,
          backup,
          rollbackOnFail,
          postCheckCommand,
        });

        ctx.out?.(
          formatUnpackOutput({
            archive: target.archive,
            archiveResolution: target.archiveResolution,
            outputDir: target.outputDir,
            format: itemResult.format,
            overwriteMode: cleanOutput ? "clean" : overwriteMode,
            deleteArchive,
            cleanOutput,
            backup,
            rollbackOnFail,
            ...(postCheckCommand === undefined ? {} : { postCheckCommand }),
            deletedArchivePath: deletedArchivePaths[0],
            backupPath: result.backups[0]?.backupPath,
            backupCreated: result.backupCreated,
            backupSkippedReason: result.backups[0]?.skippedReason,
            rolledBack: result.rolledBack,
            dryRun,
            explicitDryRun: isExplicitDryRun(ctx),
            backendCommand: toBackendCommand(itemResult.result),
            applyCommand,
            overwriteApplyCommand,
          }),
        );
        return;
      }

      if (isJsonOutput(ctx)) {
        printJson(ctx, {
          ok: true,
          command: COMMAND_NAME,
          diagnostics: [],
          dryRun,
          deleteArchive,
          cleanOutput,
          overwriteMode,
          backup,
          rollbackOnFail,
          targets,
          items: result.items,
          backups: result.backups,
          postCheck: result.postCheck,
          deletedArchivePaths,
        });
        return;
      }

      const applyCommand = buildBatchApplyCommand(targets, {
        format,
        overwriteMode,
        deleteArchive,
        cleanOutput: ctx.options?.cleanOutput === true,
        backup,
        rollbackOnFail,
        postCheckCommand,
      });

      ctx.out?.(
        formatBatchUnpackOutput({
          targets: result.items.map((item, index) => ({
            archive: item.archive,
            archiveResolution: targets[index]?.archiveResolution,
            outputDir: item.outputDir,
            format: item.format,
            backendCommand: toBackendCommand(item.result),
          })),
          overwriteMode: cleanOutput ? "clean" : overwriteMode,
          deleteArchive,
          cleanOutput,
          backup,
          rollbackOnFail,
          ...(postCheckCommand === undefined ? {} : { postCheckCommand }),
          deletedArchivePaths,
          dryRun,
          explicitDryRun: isExplicitDryRun(ctx),
          result,
          applyCommand,
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

interface UnpackCliOptions {
  readonly format?: ArchiveFormat;
  readonly overwriteMode: "never" | "files" | "clean";
  readonly deleteArchive: boolean;
  readonly cleanOutput: boolean;
  readonly backup: boolean;
  readonly rollbackOnFail: boolean;
  readonly postCheckCommand?: string;
}

async function resolveUnpackTargets(
  ctx: RelpackCommandCtx,
  cwd: string,
  format: ArchiveFormat | undefined,
): Promise<readonly UnpackTarget[]> {
  const rawArgs = normalizeArgs(ctx.args);
  const explicitOutputs = normalizeStringList(ctx.options?.output);

  if (rawArgs.length === 0) {
    emitUsageError(ctx, COMMAND_NAME, USAGE, "Archive path is required.");
  }

  if (explicitOutputs.length === 0) {
    const resolution = await resolveArchiveInputOrUsage(ctx, cwd, rawArgs);
    return [{ archive: resolution.archive, outputDir: ".", ...(format === undefined ? {} : { format }), archiveResolution: resolution }];
  }

  const archiveInputs: string[] = [];
  const positionalOutputs: string[] = [];

  for (const arg of rawArgs) {
    if (looksLikeArchiveInput(arg)) {
      archiveInputs.push(arg);
      continue;
    }

    positionalOutputs.push(arg);
  }

  if (archiveInputs.length === 0) {
    emitUsageError(ctx, COMMAND_NAME, USAGE, "At least one archive path is required before output directories.");
  }

  const outputs = [...explicitOutputs, ...positionalOutputs];
  const archiveList = await resolveArchiveInputsOrUsage(ctx, cwd, archiveInputs);

  if (archiveList.archives.length !== outputs.length) {
    emitUsageError(
      ctx,
      COMMAND_NAME,
      USAGE,
      `Batch unpack needs one output directory per resolved archive. Resolved ${archiveList.archives.length} archive(s) but received ${outputs.length} output director${outputs.length === 1 ? "y" : "ies"}.`,
    );
  }

  return archiveList.archives.map((resolution, index) => ({
    archive: resolution.archive,
    outputDir: outputs[index]!,
    ...(format === undefined ? {} : { format }),
    archiveResolution: resolution,
  }));
}

function validateUnpackOptions(
  ctx: RelpackCommandCtx,
  options: {
    readonly cleanOutput: boolean;
    readonly overwriteMode: "never" | "files" | "clean";
    readonly backup: boolean;
    readonly rollbackOnFail: boolean;
    readonly hasExplicitOutput: boolean;
    readonly batch: boolean;
    readonly format?: ArchiveFormat;
  },
): void {
  if (toOptionalString(ctx.options?.overwriteMode) !== undefined && !["never", "files", "clean"].includes(String(ctx.options?.overwriteMode))) {
    emitUsageError(ctx, COMMAND_NAME, USAGE, "--overwrite-mode must be one of: never, files, clean.");
  }

  if (options.format !== undefined && normalizeArchiveFormat(options.format) === "unknown") {
    emitUsageError(ctx, COMMAND_NAME, USAGE, `Unsupported --format value: ${options.format}`);
  }

  if (options.cleanOutput && !options.hasExplicitOutput) {
    emitUsageError(
      ctx,
      COMMAND_NAME,
      USAGE,
      "--clean-output / --overwrite-mode clean requires explicit -o/--output directories so relpack knows exactly what to delete.",
    );
  }

  if (options.cleanOutput && options.overwriteMode === "never") {
    emitUsageError(
      ctx,
      COMMAND_NAME,
      USAGE,
      "--clean-output requires --overwrite or --overwrite-mode clean because it intentionally deletes output directories before extraction.",
    );
  }

  if (options.backup && !options.hasExplicitOutput) {
    emitUsageError(ctx, COMMAND_NAME, USAGE, "--backup requires explicit -o/--output directories.");
  }

  if (options.rollbackOnFail && !options.backup) {
    emitUsageError(ctx, COMMAND_NAME, USAGE, "--rollback-on-fail requires --backup.");
  }
}

async function resolveArchiveInputOrUsage(
  ctx: RelpackCommandCtx,
  cwd: string,
  args: readonly string[],
): Promise<ArchiveInputResolution> {
  try {
    return await resolveArchiveInput(cwd, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitUsageError(ctx, COMMAND_NAME, USAGE, message);
  }
}

async function resolveArchiveInputsOrUsage(
  ctx: RelpackCommandCtx,
  cwd: string,
  args: readonly string[],
) {
  try {
    return await resolveArchiveInputs(cwd, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitUsageError(ctx, COMMAND_NAME, USAGE, message);
  }
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringList(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string" || typeof value === "number") {
    const item = String(value).trim();
    return item.length > 0 ? [item] : [];
  }

  return [];
}

function buildSingleApplyCommand(target: UnpackTarget, options: UnpackCliOptions): string {
  return buildRelpackCommand([...buildSingleCommandParts(target, options), "--apply"]);
}

function buildBatchApplyCommand(targets: readonly UnpackTarget[], options: UnpackCliOptions): string {
  const [firstOutput, ...remainingOutputs] = targets.map((target) => target.outputDir);
  return buildRelpackCommand([
    "unpack",
    ...targets.map((target) => target.archive),
    "-o",
    firstOutput ?? ".",
    ...remainingOutputs,
    ...buildOptionParts(options),
    "--apply",
  ]);
}

function buildSingleCommandParts(target: UnpackTarget, options: UnpackCliOptions): string[] {
  return ["unpack", target.archive, "-o", target.outputDir, ...buildOptionParts(options)];
}

function buildOptionParts(options: UnpackCliOptions): string[] {
  const parts: string[] = [];
  if (options.format !== undefined) parts.push("--format", options.format);
  if (options.overwriteMode !== "never") parts.push("--overwrite-mode", options.overwriteMode);
  if (options.deleteArchive) parts.push("--delete-archive");
  if (options.cleanOutput) parts.push("--clean-output");
  if (options.backup) parts.push("--backup");
  if (options.rollbackOnFail) parts.push("--rollback-on-fail");
  if (options.postCheckCommand !== undefined) parts.push("--post-check-command", options.postCheckCommand);
  return parts;
}
