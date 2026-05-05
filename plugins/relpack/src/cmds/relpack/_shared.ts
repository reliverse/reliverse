import type { StructuredRemptsError } from "@reliverse/rempts";

import { toDiagnostic } from "../../impl/core/error";
import { resolveArchiveInput, type ArchiveInputResolution } from "../../impl/core/glob";
import { RELPACK_MANIFEST_PATH } from "../../impl/core/manifest";
import { formatCommand, shellQuote } from "../../impl/core/spawn";
import type {
  ArchiveEntry,
  ArchiveFormat,
  BatchUnpackResult,
  CommandContext as CoreCommandContext,
  Diagnostic,
  DiffResult,
  OverwritePolicy,
  PackSkippedEntry,
  ProcessResult,
  RelpackCommandName,
  RelpackJsonReport,
  RelpackManifest,
  UnpackOverwriteMode,
  VerifyResult,
} from "../../impl/core/types";

export interface RelpackCommandCtx {
  readonly args?: unknown;
  readonly options?: Record<string, unknown>;
  readonly safety?: {
    readonly apply?: boolean;
    assertApplied?(effect: string): void;
  };
  readonly output?: {
    problem?(problem: StructuredRemptsError): void;
  };
  readonly colors?: {
    readonly stdout?: unknown;
  };
  readonly globalFlags?: {
    readonly json?: boolean;
  };
  out?(message: string): void;
  exit(code: number, message?: string): never;
}

export const RELPACK_FORMATS = "tar, tar.gz, tar.zst, tar.xz, tar.bz2, zip, 7z";
export const HELP_HINT = `Run "${getRelpackCommandPrefix()} <command> --help" for examples and flag details.`;
export const REPORTED_USAGE_ERROR = Symbol("reported relpack usage error");

export function getCommandContext(): CoreCommandContext {
  return { cwd: process.cwd(), env: process.env };
}

export function normalizeArgs(args: unknown): string[] {
  if (!Array.isArray(args)) {
    return [];
  }

  return args
    .map(String)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

export async function resolveArchiveArgs(
  ctx: RelpackCommandCtx,
  command: RelpackCommandName,
  usage: string,
  cwd: string,
): Promise<ArchiveInputResolution> {
  const args = normalizeArgs(ctx.args);

  try {
    return await resolveArchiveInput(cwd, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitUsageError(ctx, command, usage, message);
  }
}

export function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function toOptionalArchiveFormat(value: unknown): ArchiveFormat | undefined {
  const format = toOptionalString(value);
  return format === undefined ? undefined : (format as ArchiveFormat);
}

export function toOverwritePolicy(value: unknown): OverwritePolicy {
  return value === true ? "files" : "never";
}

export function toUnpackOverwriteMode(options: Record<string, unknown> | undefined): UnpackOverwriteMode {
  const value = toOptionalString(options?.overwriteMode);
  if (value === undefined) {
    return options?.overwrite === true ? "files" : "never";
  }

  if (value === "never" || value === "files" || value === "clean") {
    return value;
  }

  return "never";
}

export function overwriteModeToPolicy(mode: UnpackOverwriteMode): OverwritePolicy {
  return mode === "never" ? "never" : "files";
}

export function shouldWrite(ctx: RelpackCommandCtx): boolean {
  return ctx.safety?.apply === true;
}

export function isJsonOutput(ctx: RelpackCommandCtx): boolean {
  return ctx.globalFlags?.json === true;
}

export function isDryRun(ctx: RelpackCommandCtx): boolean {
  return ctx.options?.dryRun === true || !shouldWrite(ctx);
}

export function isExplicitDryRun(ctx: RelpackCommandCtx): boolean {
  return ctx.options?.dryRun === true;
}

export function emitUsageError(
  ctx: RelpackCommandCtx,
  command: RelpackCommandName,
  usage: string,
  message: string,
): never {
  const problem: StructuredRemptsError = {
    code: "RELPACK_USAGE",
    hint: HELP_HINT,
    kind: "usage",
    message,
    ok: false,
    relatedCommand: command,
    remptsError: 1,
    schemaVersion: 1,
    usage,
  };

  if (ctx.output?.problem) {
    ctx.output.problem(problem);
  } else {
    ctx.out?.(`${message}\n${HELP_HINT}`);
  }

  ctx.exit(1);
  throw REPORTED_USAGE_ERROR;
}

export function out(ctx: RelpackCommandCtx, message: string): void {
  if (ctx.out) {
    ctx.out(message);
    return;
  }

  console.log(message);
}

export function printDiagnostics(ctx: RelpackCommandCtx, diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.severity === "error" ? "error" : diagnostic.severity;
    out(ctx, `${prefix}: ${diagnostic.message}`);
    if (diagnostic.hint) {
      out(ctx, `hint: ${diagnostic.hint}`);
    }
  }
}

export function printJson(
  ctx: RelpackCommandCtx,
  report: RelpackJsonReport | Record<string, unknown>,
): void {
  out(ctx, JSON.stringify(report, null, 2));
}

export function handleRelpackError(
  ctx: RelpackCommandCtx,
  command: RelpackCommandName,
  error: unknown,
): void {
  if (error === REPORTED_USAGE_ERROR) {
    return;
  }

  const diagnostic = toDiagnostic(error);
  if (isJsonOutput(ctx)) {
    printJson(ctx, { ok: false, command, diagnostics: [diagnostic] });
  } else {
    printDiagnostics(ctx, [diagnostic]);
  }

  ctx.exit(1);
}

export function getRelpackCommandPrefix(): string {
  const prefix = process.env.RELPACK_COMMAND_PREFIX?.trim();
  return prefix && prefix.length > 0 ? prefix : "rse relpack";
}

export function buildRelpackCommand(parts: readonly string[]): string {
  return [...getRelpackCommandPrefix().split(/\s+/).filter(Boolean), ...parts].map(shellQuote).join(" ");
}

export function toBackendCommand(result: ProcessResult): string {
  return formatCommand(result.command, compactBackendArgsForHumans(result.command, result.args));
}

function compactBackendArgsForHumans(command: string, args: readonly string[]): readonly string[] {
  if (command === "tar") {
    const excludeArgs = args.filter((arg) => arg.startsWith("--exclude="));
    if (excludeArgs.length === 0) {
      return args;
    }

    return [
      `--exclude=<${excludeArgs.length}-patterns>`,
      ...args.filter((arg) => !arg.startsWith("--exclude=")),
    ];
  }

  if (command === "zip") {
    const excludeFlagIndex = args.indexOf("-x");
    if (excludeFlagIndex === -1) {
      return args;
    }

    const excludedCount = args.length - excludeFlagIndex - 1;
    return [...args.slice(0, excludeFlagIndex), "-x", `<${excludedCount}-patterns>`];
  }

  const sevenZExcludeCount = args.filter((arg) => arg.startsWith("-xr!")).length;
  if (sevenZExcludeCount === 0) {
    return args;
  }

  return [
    ...args.filter((arg) => !arg.startsWith("-xr!")),
    `-xr!<${sevenZExcludeCount}-patterns>`,
  ];
}

interface PrettyReportSection {
  readonly title: string;
  readonly lines: readonly string[];
}

interface PrettyReport {
  readonly title: string;
  readonly status: string;
  readonly sections?: readonly PrettyReportSection[];
}

export function formatPrettyReport(report: PrettyReport): string {
  const lines = [report.title, "", `Status: ${report.status}`];

  for (const section of report.sections ?? []) {
    if (section.lines.length === 0) {
      continue;
    }

    lines.push("", `${section.title}:`);
    for (const line of section.lines) {
      lines.push(`  ${line}`);
    }
  }

  return lines.join("\n");
}

export function formatKeyValues(values: readonly [string, string | number | undefined][]): string[] {
  return values
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);
}

export function formatBullets(values: readonly string[]): string[] {
  if (values.length === 0) {
    return ["<none>"];
  }

  return values.map((value) => `- ${value}`);
}

export function formatNumbered(values: readonly string[]): string[] {
  return values.map((value, index) => `${index + 1}. ${value}`);
}

function formatByteSize(size: number | undefined): string | undefined {
  if (size === undefined) return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function formatArchiveResolutionLines(resolution: ArchiveInputResolution | undefined): string[] {
  if (resolution === undefined || !resolution.usedGlob) {
    return ["exact archive path was used — no glob expansion was needed."];
  }

  const lines = [
    `requested: ${resolution.requested.join(" ")}`,
    `selected: ${resolution.archive}`,
    `selection: ${formatArchiveSelectionReason(resolution.selectedBy)}`,
    `matches: ${resolution.matches.length}`,
  ];

  const previewLimit = 8;
  const preview = resolution.matches.slice(0, previewLimit);
  for (const match of preview) {
    lines.push(`- ${match}`);
  }

  const remaining = resolution.matches.length - preview.length;
  if (remaining > 0) {
    lines.push(`… +${remaining} more`);
  }

  return lines;
}

function formatArchiveSelectionReason(reason: ArchiveInputResolution["selectedBy"]): string {
  if (reason === "exact") return "exact path";
  if (reason === "single-match") return "single match";
  if (reason === "highest-version") return "highest semantic version-like filename";
  if (reason === "newest-mtime") return "newest modified file";
  return "lexicographic fallback";
}

interface PackOutputOptions {
  readonly inputs: readonly string[];
  readonly output: string;
  readonly format: ArchiveFormat;
  readonly overwrite: boolean;
  readonly dryRun: boolean;
  readonly explicitDryRun: boolean;
  readonly backendCommand: string;
  readonly ignoredNames: readonly string[];
  readonly includeDefaultIgnores: boolean;
  readonly extraIgnoredNames: readonly string[];
  readonly applyCommand: string;
  readonly overwriteApplyCommand: string;
  readonly skipped?: readonly PackSkippedEntry[];
  readonly showSkipped?: boolean;
  readonly manifest?: RelpackManifest;
  readonly manifestEnabled?: boolean;
}

export function formatPackOutput(options: PackOutputOptions): string {
  const status = options.dryRun
    ? options.explicitDryRun
      ? "dry run complete — no archive was created."
      : "preview ready — no archive was created because --apply was not passed."
    : "archive created.";

  const nextSteps = options.dryRun
    ? [
        `Create the archive: ${options.applyCommand}`,
        options.overwrite
          ? "You already passed --overwrite, so an existing output archive may be replaced when you add --apply."
          : `Replace an existing output archive intentionally: ${options.overwriteApplyCommand}`,
        `Inspect available backends if the command fails: ${buildRelpackCommand(["doctor"])}`,
      ]
    : [
        `Verify archive manifest: ${buildRelpackCommand(["verify", options.output])}`,
        `Compare archive with a target folder: ${buildRelpackCommand(["diff", options.output, "-o", "./out"])}`,
        `List archive entries: ${buildRelpackCommand(["list", options.output])}`,
      ];

  return formatPrettyReport({
    title: options.dryRun ? "Relpack pack preview" : "Relpack pack complete",
    status,
    sections: [
      {
        title: "Archive",
        lines: formatKeyValues([
          ["output", options.output],
          ["format", options.format],
          ["overwrite", options.overwrite ? "archive replacement allowed" : "blocked by default"],
          ["manifest", options.manifestEnabled === false ? "disabled" : "enabled"],
          ["manifest entries", options.manifest?.entries.length],
        ]),
      },
      { title: "Inputs", lines: formatBullets([...options.inputs]) },
      {
        title: "Default ignore policy",
        lines: formatIgnorePolicyLines({
          ignoredNames: options.ignoredNames,
          includeDefaultIgnores: options.includeDefaultIgnores,
          extraIgnoredNames: options.extraIgnoredNames,
        }),
      },
      { title: "Skipped while packing", lines: formatSkippedLines(options.skipped, options.showSkipped === true) },
      { title: "Backend command", lines: [options.backendCommand] },
      {
        title: "Flags explained",
        lines: [
          "--apply writes the archive. Without it, relpack only previews the backend command.",
          "--overwrite allows replacing an existing output archive.",
          "--show-skipped prints skipped files/dirs from default and custom ignore rules.",
          "--no-manifest disables embedding .relpack/manifest.json.",
          "--dry-run always stays preview-only, even if your command runner supports apply mode.",
          "--ignore adds comma-separated file or directory names to skip while packing.",
          "--include-ignored disables relpack's default junk/secret ignore list intentionally.",
        ],
      },
      { title: "What to do next", lines: formatNumbered(nextSteps) },
    ],
  });
}

interface IgnorePolicyOutputOptions {
  readonly ignoredNames: readonly string[];
  readonly includeDefaultIgnores: boolean;
  readonly extraIgnoredNames: readonly string[];
}

function formatIgnorePolicyLines(options: IgnorePolicyOutputOptions): string[] {
  if (options.ignoredNames.length === 0) {
    return [
      "disabled — relpack will pass every selected input path to the backend.",
      "This usually means --include-ignored was passed without extra --ignore names.",
    ];
  }

  const previewLimit = 16;
  const preview = options.ignoredNames.slice(0, previewLimit);
  const remaining = options.ignoredNames.length - preview.length;
  const lines = [
    options.includeDefaultIgnores
      ? `enabled — ${options.ignoredNames.length} ignored name(s) are blocked before packing.`
      : `custom only — ${options.ignoredNames.length} ignored name(s) are blocked before packing.`,
    `active names: ${preview.join(", ")}${remaining > 0 ? `, … +${remaining} more` : ""}`,
  ];

  if (options.extraIgnoredNames.length > 0) {
    lines.push(`extra names from --ignore: ${options.extraIgnoredNames.join(", ")}`);
  }

  if (options.includeDefaultIgnores) {
    lines.push(
      "default junk examples: .git, node_modules, dist, build, .next, .turbo, coverage, tmp, logs, .env",
    );
    lines.push("pass --include-ignored only when you intentionally want those paths inside the archive.");
  } else {
    lines.push("default ignores are disabled because --include-ignored was passed.");
  }

  return lines;
}

function formatSkippedLines(skipped: readonly PackSkippedEntry[] | undefined, showSkipped: boolean): string[] {
  skipped = skipped ?? [];
  if (skipped.length === 0) return ["nothing skipped."];

  const byReason = new Map<string, number>();
  for (const entry of skipped) {
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
  }

  const lines = [`${skipped.length} path(s) skipped.`];
  for (const [reason, count] of [...byReason.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${reason}: ${count}`);
  }

  if (!showSkipped) {
    lines.push("pass --show-skipped to print skipped path examples.");
    return lines;
  }

  for (const entry of skipped.slice(0, 30)) {
    const match = entry.matchedName ? ` (${entry.matchedName})` : "";
    lines.push(`- ${entry.path} — ${entry.reason}${match}`);
  }
  if (skipped.length > 30) lines.push(`… +${skipped.length - 30} more`);
  return lines;
}

interface UnpackOutputOptions {
  readonly archive: string;
  readonly archiveResolution?: ArchiveInputResolution;
  readonly outputDir: string;
  readonly format: ArchiveFormat;
  readonly overwrite?: boolean;
  readonly overwriteMode?: UnpackOverwriteMode;
  readonly deleteArchive: boolean;
  readonly cleanOutput: boolean;
  readonly backup?: boolean;
  readonly rollbackOnFail?: boolean;
  readonly postCheckCommand?: string;
  readonly deletedArchivePath?: string | undefined;
  readonly backupPath?: string | undefined;
  readonly backupCreated?: boolean;
  readonly backupSkippedReason?: string | undefined;
  readonly rolledBack?: boolean;
  readonly dryRun: boolean;
  readonly explicitDryRun: boolean;
  readonly backendCommand: string;
  readonly applyCommand: string;
  readonly overwriteApplyCommand: string;
}

export function formatUnpackOutput(options: UnpackOutputOptions): string {
  const overwriteMode = options.overwriteMode ?? (options.cleanOutput ? "clean" : options.overwrite ? "files" : "never");
  const backup = options.backup === true;
  const rollbackOnFail = options.rollbackOnFail === true;
  const backupCreated = options.backupCreated === true;
  const status = options.dryRun
    ? options.explicitDryRun
      ? "dry run complete — no archive entries were extracted."
      : "preview ready — no archive entries were extracted because --apply was not passed."
    : formatUnpackSuccessStatus(options);

  const nextSteps = options.dryRun
    ? [
        `Extract files: ${options.applyCommand}`,
        overwriteMode !== "never"
          ? `Overwrite mode is already ${overwriteMode}; it will take effect when you add --apply.`
          : `Replace existing files intentionally: ${options.overwriteApplyCommand}`,
        options.deleteArchive
          ? "When you add --apply, the source archive will be deleted only after extraction succeeds."
          : `Delete archive after successful extraction: ${options.applyCommand.replace(" --apply", " --delete-archive --apply")}`,
        options.cleanOutput
          ? "When you add --apply, the output directory will be deleted first, then recreated for extraction."
          : `Clean output directory before extracting: ${options.overwriteApplyCommand.replace(" --apply", " --clean-output --apply")}`,
        backup
          ? "When you add --apply, relpack will backup the output directory before extraction."
          : `Backup before extracting: ${options.applyCommand.replace(" --apply", " --backup --rollback-on-fail --apply")}`,
        options.postCheckCommand
          ? "When you add --apply, post-check runs after extraction and before source archive deletion."
          : `Run a smoke check after extraction: ${options.applyCommand.replace(" --apply", " --post-check-command 'bun test plugins/relpack' --apply")}`,
        `List entries before extracting: ${buildRelpackCommand(["list", options.archive])}`,
      ]
    : [
        backupCreated
          ? `Backup created: ${options.backupPath}`
          : backup
            ? `Backup skipped: ${options.backupSkippedReason ?? "no backup was needed"}`
            : `Review extracted files in: ${options.outputDir}`,
        options.deleteArchive
          ? `Source archive deleted: ${options.deletedArchivePath ?? options.archive}`
          : `Verify source archive manifest: ${buildRelpackCommand(["verify", options.archive])}`,
      ];

  return formatPrettyReport({
    title: options.dryRun ? "Relpack unpack preview" : "Relpack unpack complete",
    status,
    sections: [
      {
        title: "Archive",
        lines: formatKeyValues([
          ["input", options.archive],
          ["format", options.format],
          ["output directory", options.outputDir],
          ["overwrite mode", overwriteMode],
          ["delete source archive", options.deleteArchive ? "after successful extraction" : "disabled"],
          ["clean output directory", options.cleanOutput ? "before extraction" : "disabled"],
          ["backup", backup ? "enabled" : "disabled"],
          ["rollback on fail", rollbackOnFail ? "enabled" : "disabled"],
          ["post-check", options.postCheckCommand],
        ]),
      },
      { title: "Archive pattern resolution", lines: formatArchiveResolutionLines(options.archiveResolution) },
      {
        title: "Safety checks",
        lines: [
          "Archive entry paths are validated before extraction.",
          "Existing destination files are refused unless overwrite mode is files or clean.",
          "--overwrite-mode files replaces colliding files without deleting the output directory.",
          "--overwrite-mode clean / --clean-output deletes the explicit -o/--output directory before extraction.",
          "--backup copies the output directory before extraction; --rollback-on-fail restores it if extraction or post-check fails.",
          "Source archive deletion is skipped unless extraction and post-check succeed.",
        ],
      },
      { title: "Backend command", lines: [options.backendCommand] },
      {
        title: "Flags explained",
        lines: [
          "--apply extracts files. Without it, relpack only previews and validates.",
          "--overwrite is shorthand for --overwrite-mode files.",
          "--overwrite-mode never|files|clean chooses collision behavior explicitly.",
          "--backup creates a sibling .relpack-backup-* folder before extraction.",
          "--rollback-on-fail requires --backup and restores that backup after failed extraction/post-check.",
          "--delete-archive deletes the source archive only after extraction succeeds.",
          "--post-check-command runs after extraction and before --delete-archive.",
        ],
      },
      { title: "What to do next", lines: formatNumbered(nextSteps) },
    ],
  });
}

interface BatchUnpackTargetOutput {
  readonly archive: string;
  readonly archiveResolution?: ArchiveInputResolution;
  readonly outputDir: string;
  readonly format: ArchiveFormat;
  readonly backendCommand: string;
}

interface BatchUnpackOutputOptions {
  readonly targets: readonly BatchUnpackTargetOutput[];
  readonly overwriteMode: UnpackOverwriteMode;
  readonly deleteArchive: boolean;
  readonly cleanOutput: boolean;
  readonly backup: boolean;
  readonly rollbackOnFail: boolean;
  readonly postCheckCommand?: string;
  readonly deletedArchivePaths?: readonly string[];
  readonly dryRun: boolean;
  readonly explicitDryRun: boolean;
  readonly result?: BatchUnpackResult;
  readonly applyCommand: string;
}

export function formatBatchUnpackOutput(options: BatchUnpackOutputOptions): string {
  const status = options.dryRun
    ? options.explicitDryRun
      ? "dry run complete — no archive entries were extracted."
      : "preview ready — no archive entries were extracted because --apply was not passed."
    : formatBatchUnpackSuccessStatus(options);

  const targetLines = options.targets.flatMap((target, index) => [
    `${index + 1}. ${target.archive} → ${target.outputDir}`,
    `   format: ${target.format}`,
  ]);

  const resolutionLines = options.targets.flatMap((target, index) => [
    `${index + 1}. ${target.archive}`,
    ...formatArchiveResolutionLines(target.archiveResolution).map((line) => `   ${line}`),
  ]);

  const backendLines = options.targets.map((target, index) => `${index + 1}. ${target.backendCommand}`);
  const backupLines = options.result?.backups.length
    ? options.result.backups.map((backup) =>
        backup.backupPath
          ? `${backup.outputDir} → ${backup.backupPath}`
          : `${backup.outputDir} skipped: ${backup.skippedReason ?? "no backup was needed"}`,
      )
    : [options.backup ? "backup will be created for each existing output directory when --apply is passed." : "disabled"];

  const nextSteps = options.dryRun
    ? [
        `Run batch extraction: ${options.applyCommand}`,
        options.cleanOutput
          ? "With --apply, each explicit output directory is cleaned before its matching archive is extracted."
          : "Use --overwrite-mode clean to replace output directories from a clean state.",
        options.backup
          ? "Backups are already enabled and will be used by --rollback-on-fail."
          : `Add rollback safety: ${options.applyCommand.replace(" --apply", " --backup --rollback-on-fail --apply")}`,
        options.postCheckCommand
          ? "Post-check will run once after all archives are extracted and before source archive deletion."
          : `Run one smoke check after the whole batch: ${options.applyCommand.replace(" --apply", " --post-check-command 'bun test apps/rse plugins/relpack' --apply")}`,
      ]
    : [
        options.result?.rolledBack ? "Rollback was executed; inspect the failure above." : "Batch extraction completed successfully.",
        options.deletedArchivePaths?.length
          ? `Deleted source archives: ${options.deletedArchivePaths.join(", ")}`
          : "Source archives were kept. Add --delete-archive to remove them after a successful batch.",
      ];

  return formatPrettyReport({
    title: options.dryRun ? "Relpack batch unpack preview" : "Relpack batch unpack complete",
    status,
    sections: [
      { title: "Targets", lines: targetLines },
      { title: "Archive pattern resolution", lines: resolutionLines },
      {
        title: "Batch safety",
        lines: formatKeyValues([
          ["overwrite mode", options.overwriteMode],
          ["clean output directories", options.cleanOutput ? "before extraction" : "disabled"],
          ["backup", options.backup ? "enabled" : "disabled"],
          ["rollback on fail", options.rollbackOnFail ? "enabled" : "disabled"],
          ["post-check", options.postCheckCommand],
          ["delete source archives", options.deleteArchive ? "after successful batch" : "disabled"],
        ]),
      },
      { title: "Backups", lines: backupLines },
      { title: "Backend commands", lines: backendLines },
      {
        title: "Flags explained",
        lines: [
          "Batch mode maps archive inputs to output directories in order.",
          "If your shell expands globs into several versioned archives, relpack groups them by package-like filename and chooses the highest version in each group.",
          "--post-check-command runs once after all archives are extracted, not once per archive.",
          "--delete-archive deletes source archives only after extraction and post-check both succeed.",
        ],
      },
      { title: "What to do next", lines: formatNumbered(nextSteps) },
    ],
  });
}

function formatBatchUnpackSuccessStatus(options: BatchUnpackOutputOptions): string {
  const parts: string[] = [];
  if (options.result?.backupCreated) parts.push("backup created");
  if (options.cleanOutput) parts.push("output directories cleaned");
  parts.push(`${options.targets.length} archive(s) extracted`);
  if (options.postCheckCommand) parts.push("post-check passed");
  if (options.deleteArchive) parts.push("source archives deleted");
  return `${parts.join("; ")}.`;
}

function formatUnpackSuccessStatus(options: UnpackOutputOptions): string {
  const parts: string[] = [];
  if (options.backupCreated === true) parts.push("backup created");
  if (options.cleanOutput) parts.push("output directory cleaned");
  parts.push("archive extracted");
  if (options.postCheckCommand) parts.push("post-check passed");
  if (options.deleteArchive) parts.push("source archive deleted");
  return `${parts.join("; ")}.`;
}

interface ListOutputOptions {
  readonly archive: string;
  readonly archiveResolution?: ArchiveInputResolution;
  readonly format: ArchiveFormat;
  readonly entries: readonly ArchiveEntry[];
  readonly manifest?: RelpackManifest;
  readonly tree?: boolean;
  readonly maxDepth?: number;
}

export function formatListOutput(options: ListOutputOptions): string {
  const files = options.entries.filter((entry) => entry.kind === "file" || entry.kind === "unknown");
  const dirs = options.entries.filter((entry) => entry.kind === "directory");
  const totalSize = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const largest = [...files]
    .filter((entry) => entry.size !== undefined)
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, 8);
  const important = options.entries
    .map((entry) => entry.path)
    .filter((entryPath) => ["package.json", "README.md", "tsconfig.json", RELPACK_MANIFEST_PATH].includes(entryPath));

  return formatPrettyReport({
    title: "Relpack list",
    status: `archive read successfully — ${options.entries.length} entr${options.entries.length === 1 ? "y" : "ies"} found.`,
    sections: [
      {
        title: "Archive",
        lines: formatKeyValues([
          ["input", options.archive],
          ["format", options.format],
          ["files", files.length],
          ["directories", dirs.length],
          ["known unpacked size", formatByteSize(totalSize)],
          ["manifest", options.manifest ? "present" : "not found"],
          ["package", options.manifest?.packageName],
          ["version", options.manifest?.version],
        ]),
      },
      { title: "Archive pattern resolution", lines: formatArchiveResolutionLines(options.archiveResolution) },
      { title: "Important files", lines: formatBullets(important) },
      {
        title: "Largest files",
        lines: largest.length === 0 ? ["size data unavailable for this backend."] : largest.map((entry) => `${formatByteSize(entry.size) ?? "?"}  ${entry.path}`),
      },
      { title: options.tree === true ? "Tree" : "Entries", lines: options.tree === true ? formatTree(options.entries, options.maxDepth) : formatEntriesForHumans(options.entries) },
      {
        title: "What to do next",
        lines: formatNumbered([
          `Verify archive manifest: ${buildRelpackCommand(["verify", options.archive])}`,
          `Preview extraction: ${buildRelpackCommand(["unpack", options.archive, "-o", "./out"])}`,
          `Diff against a folder: ${buildRelpackCommand(["diff", options.archive, "-o", "./out"])}`,
        ]),
      },
    ],
  });
}

export function formatEntriesForHumans(entries: readonly ArchiveEntry[]): string[] {
  if (entries.length === 0) return ["<archive is empty>"];
  return entries.map((entry) => {
    const suffix = [entry.kind !== "unknown" ? entry.kind : undefined, formatByteSize(entry.size)]
      .filter(Boolean)
      .join(", ");
    return `- ${entry.path}${suffix ? ` (${suffix})` : ""}`;
  });
}

function formatTree(entries: readonly ArchiveEntry[], maxDepth: number | undefined): string[] {
  if (entries.length === 0) return ["<archive is empty>"];
  const lines: string[] = [];
  for (const entry of entries) {
    const depth = entry.path.split("/").filter(Boolean).length;
    if (maxDepth !== undefined && depth > maxDepth) continue;
    const indent = "  ".repeat(Math.max(0, depth - 1));
    const marker = entry.kind === "directory" ? "/" : "";
    lines.push(`${indent}- ${entry.path.split("/").at(-1) ?? entry.path}${marker}`);
  }
  return lines.length > 0 ? lines : ["<no entries within selected depth>"];
}

interface TestOutputOptions {
  readonly archive: string;
  readonly archiveResolution?: ArchiveInputResolution;
  readonly format: ArchiveFormat;
  readonly backendCommand: string;
}

export function formatTestOutput(options: TestOutputOptions): string {
  return formatPrettyReport({
    title: "Relpack test",
    status: "archive is readable by the selected backend.",
    sections: [
      {
        title: "Archive",
        lines: formatKeyValues([
          ["input", options.archive],
          ["format", options.format],
        ]),
      },
      { title: "Archive pattern resolution", lines: formatArchiveResolutionLines(options.archiveResolution) },
      { title: "Backend command", lines: [options.backendCommand] },
      {
        title: "What to do next",
        lines: formatNumbered([
          `Verify manifest: ${buildRelpackCommand(["verify", options.archive])}`,
          `List entries: ${buildRelpackCommand(["list", options.archive])}`,
          `Preview extraction: ${buildRelpackCommand(["unpack", options.archive, "-o", "./out"])}`,
        ]),
      },
    ],
  });
}

export function formatVerifyOutput(result: VerifyResult, archiveResolution?: ArchiveInputResolution): string {
  return formatPrettyReport({
    title: "Relpack verify",
    status: result.ok
      ? `manifest verified — ${result.checkedEntries} entr${result.checkedEntries === 1 ? "y" : "ies"} checked.`
      : `manifest verification failed — ${result.mismatches.length} mismatch(es) found.`,
    sections: [
      {
        title: "Archive",
        lines: formatKeyValues([
          ["input", result.archive],
          ["format", result.format],
          ["package", result.manifest.packageName],
          ["version", result.manifest.version],
          ["created at", result.manifest.createdAt],
        ]),
      },
      { title: "Archive pattern resolution", lines: formatArchiveResolutionLines(archiveResolution) },
      {
        title: "Mismatches",
        lines: result.mismatches.length === 0
          ? ["none"]
          : result.mismatches.slice(0, 30).map((mismatch) => `- ${mismatch.path} — ${mismatch.reason}${mismatch.expected !== undefined ? ` expected=${mismatch.expected}` : ""}${mismatch.actual !== undefined ? ` actual=${mismatch.actual}` : ""}`),
      },
      {
        title: "What to do next",
        lines: formatNumbered(
          result.ok
            ? [`List entries: ${buildRelpackCommand(["list", result.archive])}`, `Preview extraction: ${buildRelpackCommand(["unpack", result.archive, "-o", "./out"])}`]
            : ["Recreate the archive from trusted source files.", `Inspect entries: ${buildRelpackCommand(["list", result.archive])}`],
        ),
      },
    ],
  });
}

export function formatDiffOutput(result: DiffResult, archiveResolution?: ArchiveInputResolution): string {
  return formatPrettyReport({
    title: "Relpack diff",
    status: formatDiffStatus(result),
    sections: [
      {
        title: "Archive vs output",
        lines: formatKeyValues([
          ["archive", result.archive],
          ["format", result.format],
          ["output directory", result.outputDir],
          ["manifest", result.manifest ? "present" : "not found; falling back to path/size heuristics"],
        ]),
      },
      { title: "Archive pattern resolution", lines: formatArchiveResolutionLines(archiveResolution) },
      { title: "Added by archive", lines: formatLimitedBullets(result.added) },
      { title: "Changed", lines: formatLimitedBullets(result.changed) },
      { title: "Removed from archive but still in output", lines: formatLimitedBullets(result.removed) },
      {
        title: "What to do next",
        lines: formatNumbered([
          `Preview extraction: ${buildRelpackCommand(["unpack", result.archive, "-o", result.outputDir])}`,
          `Safe replace with backup: ${buildRelpackCommand(["unpack", result.archive, "-o", result.outputDir, "--overwrite-mode", "clean", "--backup", "--rollback-on-fail", "--apply"])}`,
        ]),
      },
    ],
  });
}

function formatDiffStatus(result: DiffResult): string {
  const changes = result.added.length + result.changed.length + result.removed.length;
  if (changes === 0) return `no differences found — ${result.unchanged.length} archive path(s) already match output.`;
  return `${changes} difference(s): ${result.added.length} added, ${result.changed.length} changed, ${result.removed.length} removed.`;
}

function formatLimitedBullets(values: readonly string[]): string[] {
  if (values.length === 0) return ["none"];
  const limit = 30;
  const lines = values.slice(0, limit).map((value) => `- ${value}`);
  if (values.length > limit) lines.push(`… +${values.length - limit} more`);
  return lines;
}

export function formatExplainOutput(summary: string, notes: readonly string[]): string {
  return formatPrettyReport({
    title: "Relpack explain",
    status: "explanation only — no backend command was executed.",
    sections: [
      { title: "Summary", lines: [summary] },
      { title: "Details", lines: notes.length > 0 ? formatBullets([...notes]) : ["No extra notes."] },
      {
        title: "What to do next",
        lines: formatNumbered([
          "Run the command without --apply first to preview write operations.",
          "Add --apply only after the preview looks correct.",
          `Use ${buildRelpackCommand(["doctor"])} if a format backend is missing.`,
        ]),
      },
    ],
  });
}

export function formatDoctorSummary(
  backends: readonly {
    readonly id: string;
    readonly available: boolean;
    readonly formats: readonly string[];
  }[],
): string {
  const available = backends.filter((backend) => backend.available);
  const missing = backends.filter((backend) => !backend.available);
  const hasCoreBackend = available.some(
    (backend) => backend.id === "system-tar" || backend.id === "system-zip",
  );
  const missingFormats = unique(missing.flatMap((backend) => backend.formats));

  const lines = [
    "Relpack doctor",
    "",
    `Status: ${formatDoctorStatus(available.length, missing.length, hasCoreBackend)}`,
    "",
  ];

  if (available.length > 0) {
    lines.push("Working now:");
    for (const backend of available) {
      lines.push(`  ✓ ${backend.id}`);
      lines.push(`    formats: ${backend.formats.join(", ")}`);
    }
    lines.push("");
  }

  if (missing.length > 0) {
    lines.push("Needs attention:");
    for (const backend of missing) {
      lines.push(`  ! ${backend.id}`);
      lines.push(`    formats affected: ${backend.formats.join(", ")}`);
      lines.push(`    impact: ${getBackendImpact(backend.id, backend.formats)}`);
      lines.push("    install hints:");
      for (const hint of getBackendInstallHints(backend.id)) {
        lines.push(`      - ${hint}`);
      }
    }
    lines.push("");
  }

  lines.push("What to do next:");
  if (missing.length === 0) {
    lines.push("  1. You are good to go: all configured relpack backends are available.");
    lines.push(`  2. Try a safe preview: ${buildRelpackCommand(["pack", "./dist", "-o", "dist.tar.zst"])}`);
    lines.push(`  3. Actually write the archive: ${buildRelpackCommand(["pack", "./dist", "-o", "dist.tar.zst", "--apply"])}`);
  } else if (hasCoreBackend) {
    lines.push("  1. You can continue now with the formats listed under Working now.");
    if (missingFormats.length > 0) {
      lines.push(`  2. Install the missing backend only if you need: ${missingFormats.join(", ")}.`);
      lines.push(`  3. After installing, rerun: ${buildRelpackCommand(["doctor"])}`);
      lines.push(`  4. Try a safe preview: ${buildRelpackCommand(["pack", "./dist", "-o", "dist.tar.zst"])}`);
      lines.push(`  5. Actually write the archive: ${buildRelpackCommand(["pack", "./dist", "-o", "dist.tar.zst", "--apply"])}`);
    }
  } else {
    lines.push("  1. Install at least one backend from Needs attention before using relpack.");
    lines.push("  2. Recommended first install on Ubuntu/Debian: sudo apt update && sudo apt install tar zip unzip");
    lines.push(`  3. Rerun: ${buildRelpackCommand(["doctor"])}`);
  }

  lines.push("", "Notes:");
  lines.push("  - Commands that write files stay in preview mode until you pass --apply.");
  lines.push("  - 7z support is optional unless you need to pack/unpack/list/test .7z archives.");

  return lines.join("\n");
}

function formatDoctorStatus(
  availableCount: number,
  missingCount: number,
  hasCoreBackend: boolean,
): string {
  if (missingCount === 0) return "ready — all configured archive backends are available.";
  if (hasCoreBackend) return `usable with warnings — ${availableCount} backend(s) available, ${missingCount} backend(s) missing.`;
  return "blocked — no tar/zip backend is available yet.";
}

function getBackendImpact(backendId: string, formats: readonly string[]): string {
  if (backendId === "system-7z") return "Only .7z support is unavailable. tar and zip workflows are unaffected.";
  if (backendId === "system-zip") return ".zip pack/unpack/list/test support is unavailable until both zip and unzip are installed.";
  if (backendId === "system-tar") return `tar-family formats are unavailable: ${formats.join(", ")}.`;
  return `Formats unavailable through this backend: ${formats.join(", ")}.`;
}

function getBackendInstallHints(backendId: string): readonly string[] {
  if (backendId === "system-7z") {
    return [
      "Ubuntu/Debian: sudo apt update && sudo apt install 7zip",
      "Older Ubuntu/Debian: sudo apt install p7zip-full",
      "macOS: brew install sevenzip",
      "Windows: winget install 7zip.7zip",
    ];
  }

  if (backendId === "system-zip") {
    return [
      "Ubuntu/Debian: sudo apt update && sudo apt install zip unzip",
      "macOS: zip/unzip are usually preinstalled; otherwise install Info-ZIP via your package manager",
      "Windows: use WSL, Git Bash, MSYS2, or a future native Rust relpack backend",
    ];
  }

  if (backendId === "system-tar") {
    return [
      "Ubuntu/Debian: sudo apt update && sudo apt install tar",
      "macOS: tar is usually preinstalled",
      "Windows: use WSL, Git Bash, MSYS2, or a future native Rust relpack backend",
    ];
  }

  return [`Install the executable for this backend and rerun: ${buildRelpackCommand(["doctor"])}`];
}
