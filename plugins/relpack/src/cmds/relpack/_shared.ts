import type { StructuredRemptsError } from "@reliverse/rempts";

import { toDiagnostic } from "../../impl/core/error";
import { formatCommand } from "../../impl/core/spawn";
import type {
  ArchiveEntry,
  ArchiveFormat,
  CommandContext as CoreCommandContext,
  Diagnostic,
  OverwritePolicy,
  RelpackCommandName,
  RelpackJsonReport,
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
export const HELP_HINT = 'Run "rse relpack <command> --help" for examples and flag details.';
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
  return value === true ? "always" : "never";
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

export function assertWriteAllowed(ctx: RelpackCommandCtx, effect: string): void {
  if (isDryRun(ctx)) {
    return;
  }

  ctx.safety?.assertApplied?.(effect);
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

export function printEntries(ctx: RelpackCommandCtx, entries: readonly ArchiveEntry[]): void {
  out(ctx, entries.map((entry) => entry.path).join("\n"));
}

export function printExecuted(
  ctx: RelpackCommandCtx,
  command: string,
  args: readonly string[],
): void {
  out(ctx, formatCommand(command, args));
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

export function formatDoctorSummary(
  backends: readonly {
    readonly id: string;
    readonly available: boolean;
    readonly formats: readonly string[];
  }[],
): string {
  return backends
    .map((backend) => {
      const status = backend.available ? "available" : "missing";
      return `${status}: ${backend.id} (${backend.formats.join(", ")})`;
    })
    .join("\n");
}
