import { runDoctor } from "./core/doctor";
import { detectArchiveFormat, normalizeArchiveFormat } from "./core/format";
import { buildIgnoredNames, parseIgnoredNameInput } from "./core/ignore";
import { explainCommand } from "./core/explain";
import { diffArchiveWithOutput } from "./core/commands/diff";
import { listArchive } from "./core/commands/list";
import { packArchive } from "./core/commands/pack";
import { testArchive } from "./core/commands/test";
import { deleteBatchSourceArchives, unpackArchiveBatch } from "./core/commands/unpack-batch";
import { verifyArchive } from "./core/commands/verify";
import {
  looksLikeArchiveInput,
  resolveArchiveInput,
  resolveArchiveInputs,
  type ArchiveInputResolution,
} from "./core/glob";
import type { ArchiveFormat, BatchUnpackItem, CommandContext, RelpackCommandName, UnpackOverwriteMode } from "./core/types";
import {
  buildRelpackCommand,
  formatBatchUnpackOutput,
  formatDiffOutput,
  formatDoctorSummary,
  formatExplainOutput,
  formatListOutput,
  formatPackOutput,
  formatTestOutput,
  formatUnpackOutput,
  formatVerifyOutput,
  printDiagnostics,
  printJson,
  toBackendCommand,
} from "../cmds/relpack/_shared";
import { toDiagnostic } from "./core/error";
import { formatDirectCommandHelp, formatDirectRootHelp } from "./direct-help";

export interface RelpackCliOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

interface ParsedArgv {
  readonly command: RelpackCommandName | "help" | "version";
  readonly args: readonly string[];
  readonly options: Record<string, unknown>;
}

interface UnpackTarget extends BatchUnpackItem {
  readonly archiveResolution: ArchiveInputResolution;
}

const COMMANDS = new Set<RelpackCommandName>([
  "doctor",
  "pack",
  "unpack",
  "list",
  "test",
  "verify",
  "diff",
  "explain",
]);

const VALUE_FLAGS = new Set([
  "format",
  "ignore",
  "maxDepth",
  "output",
  "overwriteMode",
  "postCheckCommand",
]);

export async function runRelpackCli(argv: readonly string[], options: RelpackCliOptions = {}): Promise<number> {
  const io = createIo(options);
  const previousCommandPrefix = process.env.RELPACK_COMMAND_PREFIX;
  process.env.RELPACK_COMMAND_PREFIX = "relpack";

  try {
    const parsed = parseRelpackArgv(argv);
    const ctx: CommandContext = { cwd: options.cwd ?? process.cwd(), env: options.env ?? process.env };

    switch (parsed.command) {
      case "help":
        io.out(formatHelp(parsed.args));
        return 0;
      case "version":
        io.out(await readPackageVersion());
        return 0;
      case "doctor":
        return await runDoctorCommand(ctx, parsed, io);
      case "pack":
        return await runPackCommand(ctx, parsed, io);
      case "unpack":
        return await runUnpackCommand(ctx, parsed, io);
      case "list":
        return await runListCommand(ctx, parsed, io);
      case "test":
        return await runTestCommand(ctx, parsed, io);
      case "verify":
        return await runVerifyCommand(ctx, parsed, io);
      case "diff":
        return await runDiffCommand(ctx, parsed, io);
      case "explain":
        return await runExplainCommand(parsed, io);
    }
  } catch (error) {
    const diagnostic = toDiagnostic(error);
    if (argv.includes("--json")) {
      io.out(JSON.stringify({ ok: false, diagnostics: [diagnostic] }, null, 2));
    } else {
      printDiagnostics({ out: io.err, exit: throwExit } as never, [diagnostic]);
    }
    return 1;
  } finally {
    if (previousCommandPrefix === undefined) {
      delete process.env.RELPACK_COMMAND_PREFIX;
    } else {
      process.env.RELPACK_COMMAND_PREFIX = previousCommandPrefix;
    }
  }
}

function parseRelpackArgv(argv: readonly string[]): ParsedArgv {
  const input = [...argv];

  if (input[0] === "relpack") {
    input.shift();
  }

  if (input.length === 0 || input[0] === "--help" || input[0] === "-h") {
    return { command: "help", args: [], options: {} };
  }

  if (input[0] === "help") {
    const helpCommand = input[1];
    return isRelpackCommand(helpCommand)
      ? { command: "help", args: [helpCommand], options: {} }
      : { command: "help", args: [], options: {} };
  }

  if (input[0] === "--version" || input[0] === "-v" || input[0] === "version") {
    return { command: "version", args: [], options: {} };
  }

  const command = input.shift();
  if (!isRelpackCommand(command)) {
    throw new Error(`Unknown relpack command: ${command ?? "<empty>"}`);
  }

  if (input.some(isHelpFlag)) {
    return { command: "help", args: [command], options: {} };
  }

  const options: Record<string, unknown> = {};
  const args: string[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index]!;

    if (arg === "--") {
      args.push(...input.slice(index + 1));
      break;
    }

    if (arg === "-o") {
      index = consumeValueFlag(input, index, "output", options);
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const name = toCamelFlagName(rawName ?? "");

      if (VALUE_FLAGS.has(name)) {
        if (inlineValue !== undefined) {
          addOptionValue(options, name, inlineValue);
          continue;
        }

        index = consumeValueFlag(input, index, name, options);
        continue;
      }

      options[name] = true;
      continue;
    }

    args.push(arg);
  }

  return { command, args, options };
}

function consumeValueFlag(
  input: readonly string[],
  index: number,
  name: string,
  options: Record<string, unknown>,
): number {
  const value = input[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${toKebabFlagName(name)} expects a value.`);
  }

  addOptionValue(options, name, value);
  return index + 1;
}

function addOptionValue(options: Record<string, unknown>, name: string, value: string): void {
  const existing = options[name];
  if (existing === undefined) {
    options[name] = value;
    return;
  }

  options[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
}

function toCamelFlagName(name: string): string {
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toKebabFlagName(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function isRelpackCommand(command: string | undefined): command is RelpackCommandName {
  return command !== undefined && COMMANDS.has(command as RelpackCommandName);
}

async function runDoctorCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const doctor = await runDoctor(ctx);

  if (isJson(parsed)) {
    printJson({ out: io.out } as never, {
      ok: doctor.backends.some((backend) => backend.available),
      command: "doctor",
      diagnostics: doctor.diagnostics,
      backends: doctor.backends,
    });
    return 0;
  }

  io.out(formatDoctorSummary(doctor.backends));
  return 0;
}

async function runPackCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const inputs = parsed.args;
  const output = toOptionalString(parsed.options.output);
  const format = toOptionalArchiveFormat(parsed.options.format);
  const dryRun = isDryRun(parsed.options);
  const overwrite = parsed.options.overwrite === true;
  const includeIgnored = parsed.options.includeIgnored === true;
  const showSkipped = parsed.options.showSkipped === true;
  const manifestEnabled = parsed.options.noManifest !== true;
  const extraIgnoredNames = parseIgnoredNameInput(parsed.options.ignore);
  const ignoredNames = buildIgnoredNames({ includeDefaultIgnores: !includeIgnored, extraIgnoredNames });

  if (inputs.length === 0) throw new Error("Pack command requires at least one input path.");
  if (output === undefined) throw new Error("Pack command requires -o or --output.");

  const result = await packArchive(
    {
      cwd: ctx.cwd,
      inputs,
      output,
      ...(format === undefined ? {} : { format }),
      overwrite: overwrite ? "files" : "never",
      dryRun,
      ignoredNames,
      manifest: manifestEnabled,
    },
    ctx,
  );

  const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(output));
  if (isJson(parsed)) {
    printJson({ out: io.out } as never, {
      ok: true,
      command: "pack",
      format: normalizedFormat,
      diagnostics: [],
      executed: [result.command, ...result.args],
      dryRun,
      skipped: result.skipped,
      manifest: result.manifest,
    });
    return 0;
  }

  const baseParts = buildPackCommandParts(inputs, output, {
    format,
    overwrite,
    extraIgnoredNames,
    includeIgnored,
    showSkipped,
    manifestEnabled,
  });

  io.out(
    formatPackOutput({
      inputs,
      output,
      format: normalizedFormat,
      overwrite,
      dryRun,
      explicitDryRun: parsed.options.dryRun === true,
      backendCommand: toBackendCommand(result),
      ignoredNames,
      includeDefaultIgnores: !includeIgnored,
      extraIgnoredNames,
      applyCommand: buildRelpackCommand([...baseParts, "--apply"]),
      overwriteApplyCommand: buildRelpackCommand([
        "pack",
        ...inputs,
        "-o",
        output,
        ...(format === undefined ? [] : ["--format", format]),
        ...(extraIgnoredNames.length === 0 ? [] : ["--ignore", extraIgnoredNames.join(",")]),
        ...(includeIgnored ? ["--include-ignored"] : []),
        ...(showSkipped ? ["--show-skipped"] : []),
        ...(manifestEnabled ? [] : ["--no-manifest"]),
        "--overwrite",
        "--apply",
      ]),
      skipped: result.skipped,
      showSkipped,
      manifest: result.manifest,
      manifestEnabled,
    }),
  );

  return 0;
}

async function runUnpackCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const format = toOptionalArchiveFormat(parsed.options.format);
  const dryRun = isDryRun(parsed.options);
  const deleteArchive = parsed.options.deleteArchive === true;
  const overwriteMode = toUnpackOverwriteMode(parsed.options);
  const cleanOutput = parsed.options.cleanOutput === true || overwriteMode === "clean";
  const backup = parsed.options.backup === true;
  const rollbackOnFail = parsed.options.rollbackOnFail === true;
  const postCheckCommand = toOptionalString(parsed.options.postCheckCommand);
  const targets = await resolveUnpackTargets(parsed, ctx.cwd, format);

  validateUnpackOptions({ cleanOutput, overwriteMode, backup, rollbackOnFail, hasExplicitOutput: targets.every((target) => target.outputDir !== "."), format });

  const result = await unpackArchiveBatch(
    {
      cwd: ctx.cwd,
      items: targets.map(({ archive, outputDir, format }) => ({ archive, outputDir, ...(format === undefined ? {} : { format }) })),
      overwrite: cleanOutput || overwriteMode === "files" ? "files" : "never",
      dryRun,
      cleanOutput,
      backup,
      rollbackOnFail,
      ...(postCheckCommand === undefined ? {} : { postCheckCommand }),
    },
    ctx,
  );

  const deletedArchivePaths = deleteArchive && !dryRun ? await deleteBatchSourceArchives(result.items, ctx.cwd) : [];

  if (isJson(parsed)) {
    printJson({ out: io.out } as never, {
      ok: true,
      command: "unpack",
      diagnostics: [],
      dryRun,
      deleteArchive,
      cleanOutput,
      overwriteMode,
      backup,
      rollbackOnFail,
      targets,
      result,
      deletedArchivePaths,
    });
    return 0;
  }

  if (targets.length === 1) {
    const target = targets[0]!;
    const itemResult = result.items[0]!;
    const applyCommand = buildRelpackCommand([...buildSingleUnpackCommandParts(target, { format, overwriteMode, deleteArchive, cleanOutput: parsed.options.cleanOutput === true, backup, rollbackOnFail, postCheckCommand }), "--apply"]);
    const overwriteApplyCommand = buildRelpackCommand([...buildSingleUnpackCommandParts(target, { format, overwriteMode: "files", deleteArchive, cleanOutput: false, backup, rollbackOnFail, postCheckCommand }), "--apply"]);

    io.out(
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
        explicitDryRun: parsed.options.dryRun === true,
        backendCommand: toBackendCommand(itemResult.result),
        applyCommand,
        overwriteApplyCommand,
      }),
    );

    return 0;
  }

  io.out(
    formatBatchUnpackOutput({
      targets: targets.map((target, index) => ({
        archive: target.archive,
        outputDir: target.outputDir,
        format: result.items[index]?.format ?? normalizeArchiveFormat(format ?? detectArchiveFormat(target.archive)),
        archiveResolution: target.archiveResolution,
        backendCommand: toBackendCommand(result.items[index]!.result),
      })),
      overwriteMode: cleanOutput ? "clean" : overwriteMode,
      deleteArchive,
      cleanOutput,
      backup,
      rollbackOnFail,
      ...(postCheckCommand === undefined ? {} : { postCheckCommand }),
      deletedArchivePaths,
      dryRun,
      explicitDryRun: parsed.options.dryRun === true,
      result,
      applyCommand: buildRelpackCommand([...buildBatchUnpackCommandParts(targets, { format, overwriteMode, deleteArchive, cleanOutput: parsed.options.cleanOutput === true, backup, rollbackOnFail, postCheckCommand }), "--apply"]),
    }),
  );

  return 0;
}

async function runListCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const archiveResolution = await resolveArchiveInput(ctx.cwd, parsed.args);
  const archive = archiveResolution.archive;
  const format = toOptionalArchiveFormat(parsed.options.format);
  const tree = parsed.options.tree === true;
  const maxDepthValue = toOptionalString(parsed.options.maxDepth);
  const maxDepth = maxDepthValue === undefined ? undefined : Number(maxDepthValue);
  if (maxDepthValue !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
    throw new Error("--max-depth must be a positive integer.");
  }

  const entries = await listArchive({ cwd: ctx.cwd, archive, ...(format === undefined ? {} : { format }) }, ctx);
  const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(archive));
  const { tryReadManifestFromArchive } = await import("./core/manifest");
  const manifest = await tryReadManifestFromArchive(archive, normalizedFormat, ctx);

  if (isJson(parsed)) {
    printJson({ out: io.out } as never, { ok: true, command: "list", format: normalizedFormat, diagnostics: [], archiveResolution, entries, manifest });
    return 0;
  }

  io.out(formatListOutput({ archive, archiveResolution, format: normalizedFormat, entries, ...(manifest === undefined ? {} : { manifest }), tree, ...(maxDepth === undefined ? {} : { maxDepth }) }));
  return 0;
}

async function runTestCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const archiveResolution = await resolveArchiveInput(ctx.cwd, parsed.args);
  const archive = archiveResolution.archive;
  const format = toOptionalArchiveFormat(parsed.options.format);
  const result = await testArchive({ cwd: ctx.cwd, archive, ...(format === undefined ? {} : { format }) }, ctx);
  const normalizedFormat = normalizeArchiveFormat(format ?? detectArchiveFormat(archive));

  if (isJson(parsed)) {
    printJson({ out: io.out } as never, { ok: true, command: "test", format: normalizedFormat, diagnostics: [], executed: [result.command, ...result.args], archiveResolution });
    return 0;
  }

  io.out(formatTestOutput({ archive, archiveResolution, format: normalizedFormat, backendCommand: toBackendCommand(result) }));
  return 0;
}

async function runVerifyCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const archiveResolution = await resolveArchiveInput(ctx.cwd, parsed.args);
  const archive = archiveResolution.archive;
  const format = toOptionalArchiveFormat(parsed.options.format);
  const result = await verifyArchive({ cwd: ctx.cwd, archive, ...(format === undefined ? {} : { format }) }, ctx);

  if (isJson(parsed)) {
    printJson({ out: io.out } as never, { ok: result.ok, command: "verify", format: result.format, diagnostics: [], archiveResolution, result });
  } else {
    io.out(formatVerifyOutput(result, archiveResolution));
  }

  return result.ok ? 0 : 1;
}

async function runDiffCommand(ctx: CommandContext, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const archiveResolution = await resolveArchiveInput(ctx.cwd, parsed.args);
  const archive = archiveResolution.archive;
  const outputDir = toOptionalString(parsed.options.output);
  const format = toOptionalArchiveFormat(parsed.options.format);
  const extraIgnoredNames = parseIgnoredNameInput(parsed.options.ignore);
  const ignoredNames = buildIgnoredNames({ includeDefaultIgnores: parsed.options.includeIgnored !== true, extraIgnoredNames });
  if (outputDir === undefined) throw new Error("Diff command requires -o or --output.");

  const result = await diffArchiveWithOutput({ cwd: ctx.cwd, archive, outputDir, ...(format === undefined ? {} : { format }), ignoredNames }, ctx);
  if (isJson(parsed)) {
    printJson({ out: io.out } as never, { ok: true, command: "diff", format: result.format, diagnostics: [], archiveResolution, result });
    return 0;
  }

  io.out(formatDiffOutput(result, archiveResolution));
  return 0;
}

async function runExplainCommand(parsed: ParsedArgv, io: CliIo): Promise<number> {
  const explanation = explainCommand(parsed.args);
  if (isJson(parsed)) {
    printJson({ out: io.out } as never, { ok: true, command: "explain", explanation });
  } else {
    io.out(formatExplainOutput(explanation.summary, explanation.notes));
  }
  return 0;
}

async function resolveUnpackTargets(parsed: ParsedArgv, cwd: string, format: ArchiveFormat | undefined): Promise<readonly UnpackTarget[]> {
  const rawArgs = parsed.args;
  const explicitOutputs = normalizeStringList(parsed.options.output);

  if (rawArgs.length === 0) throw new Error("Archive path is required.");

  if (explicitOutputs.length === 0) {
    const resolution = await resolveArchiveInput(cwd, rawArgs);
    return [{ archive: resolution.archive, outputDir: ".", ...(format === undefined ? {} : { format }), archiveResolution: resolution }];
  }

  const archiveInputs: string[] = [];
  const positionalOutputs: string[] = [];

  for (const arg of rawArgs) {
    if (looksLikeArchiveInput(arg)) {
      archiveInputs.push(arg);
    } else {
      positionalOutputs.push(arg);
    }
  }

  if (archiveInputs.length === 0) throw new Error("At least one archive path is required before output directories.");

  const outputs = [...explicitOutputs, ...positionalOutputs];
  const archiveList = await resolveArchiveInputs(cwd, archiveInputs);

  if (archiveList.archives.length !== outputs.length) {
    throw new Error(`Batch unpack needs one output directory per resolved archive. Resolved ${archiveList.archives.length} archive(s) but received ${outputs.length} output director${outputs.length === 1 ? "y" : "ies"}.`);
  }

  return archiveList.archives.map((resolution, index) => ({
    archive: resolution.archive,
    outputDir: outputs[index]!,
    ...(format === undefined ? {} : { format }),
    archiveResolution: resolution,
  }));
}

function validateUnpackOptions(options: {
  readonly cleanOutput: boolean;
  readonly overwriteMode: UnpackOverwriteMode;
  readonly backup: boolean;
  readonly rollbackOnFail: boolean;
  readonly hasExplicitOutput: boolean;
  readonly format?: ArchiveFormat;
}): void {
  if (options.format !== undefined && normalizeArchiveFormat(options.format) === "unknown") {
    throw new Error(`Unsupported --format value: ${options.format}`);
  }

  if (options.cleanOutput && !options.hasExplicitOutput) {
    throw new Error("--clean-output / --overwrite-mode clean requires explicit -o/--output directories so relpack knows exactly what to delete.");
  }

  if (options.cleanOutput && options.overwriteMode === "never") {
    throw new Error("--clean-output requires --overwrite or --overwrite-mode clean because it intentionally deletes output directories before extraction.");
  }

  if (options.backup && !options.hasExplicitOutput) {
    throw new Error("--backup requires explicit -o/--output directories.");
  }

  if (options.rollbackOnFail && !options.backup) {
    throw new Error("--rollback-on-fail requires --backup.");
  }
}

function toUnpackOverwriteMode(options: Record<string, unknown>): UnpackOverwriteMode {
  const value = toOptionalString(options.overwriteMode);
  if (value === undefined) return options.overwrite === true ? "files" : "never";
  if (value === "never" || value === "files" || value === "clean") return value;
  throw new Error("--overwrite-mode must be one of: never, files, clean.");
}

function buildPackCommandParts(
  inputs: readonly string[],
  output: string,
  options: {
    readonly format?: ArchiveFormat;
    readonly overwrite: boolean;
    readonly extraIgnoredNames: readonly string[];
    readonly includeIgnored: boolean;
    readonly showSkipped: boolean;
    readonly manifestEnabled: boolean;
  },
): string[] {
  return [
    "pack",
    ...inputs,
    "-o",
    output,
    ...(options.format === undefined ? [] : ["--format", options.format]),
    ...(options.overwrite ? ["--overwrite"] : []),
    ...(options.extraIgnoredNames.length === 0 ? [] : ["--ignore", options.extraIgnoredNames.join(",")]),
    ...(options.includeIgnored ? ["--include-ignored"] : []),
    ...(options.showSkipped ? ["--show-skipped"] : []),
    ...(options.manifestEnabled ? [] : ["--no-manifest"]),
  ];
}

function buildSingleUnpackCommandParts(target: UnpackTarget, options: UnpackCliOptions): string[] {
  return ["unpack", target.archive, "-o", target.outputDir, ...buildUnpackOptionParts(options)];
}

function buildBatchUnpackCommandParts(targets: readonly UnpackTarget[], options: UnpackCliOptions): string[] {
  const [firstOutput, ...remainingOutputs] = targets.map((target) => target.outputDir);
  return ["unpack", ...targets.map((target) => target.archive), "-o", firstOutput ?? ".", ...remainingOutputs, ...buildUnpackOptionParts(options)];
}

function buildUnpackOptionParts(options: UnpackCliOptions): string[] {
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

interface UnpackCliOptions {
  readonly format?: ArchiveFormat;
  readonly overwriteMode: UnpackOverwriteMode;
  readonly deleteArchive: boolean;
  readonly cleanOutput: boolean;
  readonly backup: boolean;
  readonly rollbackOnFail: boolean;
  readonly postCheckCommand?: string;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function toOptionalArchiveFormat(value: unknown): ArchiveFormat | undefined {
  const format = toOptionalString(value);
  return format === undefined ? undefined : (format as ArchiveFormat);
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeStringList(item)).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string" || typeof value === "number") {
    const item = String(value).trim();
    return item.length > 0 ? [item] : [];
  }

  return [];
}

function isJson(parsed: ParsedArgv): boolean {
  return parsed.options.json === true;
}

function isDryRun(options: Record<string, unknown>): boolean {
  return options.dryRun === true || options.apply !== true;
}

function formatHelp(args: readonly string[]): string {
  const command = args[0];
  return isRelpackCommand(command) ? formatDirectCommandHelp(command) : formatDirectRootHelp();
}

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJsonUrl = new URL("../../package.json", import.meta.url);
    const packageJson = await Bun.file(packageJsonUrl).json();
    return String(packageJson.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

interface CliIo {
  readonly out: (message: string) => void;
  readonly err: (message: string) => void;
}

function createIo(options: RelpackCliOptions): CliIo {
  return {
    out: options.stdout ?? ((message) => console.log(message)),
    err: options.stderr ?? ((message) => console.error(message)),
  };
}

function throwExit(): never {
  throw new Error("Unexpected exit call in standalone relpack CLI.");
}
