import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { defineCommand } from "@reliverse/rempts";
import { parse as parseJsonc } from "jsonc-parser";

import { mapWithConcurrency, resolveConcurrency } from "../../impl/concurrency";
import {
  DLER_COMMAND_NAMES,
  DLER_CONCURRENCY_DEFAULTS,
  DLER_TSC_BUNX_ARGS,
  DLER_TSC_DEFAULTS,
  DLER_TSC_NO_EMIT_ARGS,
  DLER_TSC_RUNNER_MODES,
} from "../../impl/constants";
import { createTargetSets } from "../../impl/report-helpers";
import {
  fileExists,
  resolveDirectoryTargets,
  resolveRequestedTargets,
  type RequestedTarget,
  type SkippedTarget,
} from "../../impl/shared-targets";

interface TscTarget extends RequestedTarget {
  readonly command: readonly string[];
  readonly displayCommand: string;
}

interface TscConfigValidationError extends SkippedTarget {
  readonly fatal: true;
}

interface ParsedTsconfig {
  readonly compilerOptions?:
    | {
        readonly types?: unknown;
      }
    | undefined;
  readonly extends?: unknown;
}

type TscRunnerMode = (typeof DLER_TSC_RUNNER_MODES)[number];

interface TscExecutionOptions {
  readonly bunx: boolean;
  readonly runnerMode: TscRunnerMode;
}

interface TscResult {
  readonly command: string;
  readonly cwd: string;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly fallbackUsed: boolean;
  readonly label: string;
  readonly ok: boolean;
  readonly runner: string;
  readonly runnerMode: TscRunnerMode;
  readonly stderr: string;
  readonly stdout: string;
}

type PreviewStyle = (value: unknown) => string;

const requireFromHere = createRequire(import.meta.url);

interface TscColors {
  readonly bold: PreviewStyle;
  readonly cyan: PreviewStyle;
  readonly dim: PreviewStyle;
  readonly gray: PreviewStyle;
  readonly green: PreviewStyle;
  readonly magenta: PreviewStyle;
  readonly yellow: PreviewStyle;
}

function formatCount(
  colors: TscColors,
  count: number,
  label: string,
  accent: "green" | "yellow",
): string {
  const value = count > 0 ? colors[accent](String(count)) : colors.dim(String(count));

  return `${value} ${label}`;
}

function formatLabelRows(
  rows: ReadonlyArray<{ readonly label: string; readonly detail?: string | undefined }>,
  colors: TscColors,
): string[] {
  if (rows.length === 0) {
    return [`  ${colors.dim("none")}`];
  }

  const width = Math.max(...rows.map((row) => row.label.length));

  return rows.map((row) => {
    const label = colors.bold(row.label.padEnd(width));

    return row.detail ? `  ${label}  ${colors.gray(row.detail)}` : `  ${colors.bold(row.label)}`;
  });
}

function isMissingRunner(
  result: { readonly exitCode: number; readonly stderr: string },
  runner: string,
): boolean {
  return result.exitCode === 1 && result.stderr.includes(`Script not found "${runner}"`);
}

function isTscRunnerMode(value: string): value is TscRunnerMode {
  return DLER_TSC_RUNNER_MODES.includes(value as TscRunnerMode);
}

function resolveRunnerMode(value: unknown): TscRunnerMode {
  const runnerMode = value ?? DLER_TSC_DEFAULTS.runnerMode;

  if (typeof runnerMode !== "string" || !isTscRunnerMode(runnerMode)) {
    throw new Error(`--runner must be one of: ${DLER_TSC_RUNNER_MODES.join(", ")}.`);
  }

  return runnerMode;
}

function getPrimaryRunnerForMode(runnerMode: TscRunnerMode): string {
  return runnerMode === "tsc" ? DLER_TSC_DEFAULTS.fallbackRunner : DLER_TSC_DEFAULTS.primaryRunner;
}

function formatTscCommand(
  runner: string,
  options?: { readonly bunx?: boolean | undefined },
): string {
  return [
    options?.bunx ? "bunx" : runner,
    ...(options?.bunx ? DLER_TSC_BUNX_ARGS : []),
    options?.bunx ? runner : undefined,
    ...DLER_TSC_NO_EMIT_ARGS,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function createTscCommandInvocation(
  runner: string,
  options: { readonly bunx: boolean },
): {
  readonly argv: readonly string[];
  readonly display: string;
} {
  return options.bunx
    ? {
        argv: ["bunx", ...DLER_TSC_BUNX_ARGS, runner, ...DLER_TSC_NO_EMIT_ARGS],
        display: formatTscCommand(runner, { bunx: true }),
      }
    : {
        argv: ["bun", "run", "--silent", runner, ...DLER_TSC_NO_EMIT_ARGS],
        display: formatTscCommand(runner),
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readTsconfig(path: string): Promise<ParsedTsconfig> {
  const text = await readFile(path, "utf8");
  const parsed = parseJsonc(text);

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }

  const compilerOptions = isRecord(parsed.compilerOptions)
    ? { types: parsed.compilerOptions.types }
    : undefined;

  return {
    compilerOptions,
    extends: parsed.extends,
  };
}

function resolveRelativeTsconfigPath(baseDirectory: string, value: string): string {
  const resolved = resolve(baseDirectory, value);

  if (extname(resolved)) {
    return resolved;
  }

  return `${resolved}.json`;
}

function resolveExtendsTsconfigPath(baseDirectory: string, value: string): string {
  if (value.startsWith("./") || value.startsWith("../")) {
    return resolveRelativeTsconfigPath(baseDirectory, value);
  }

  if (isAbsolute(value)) {
    return extname(value) ? value : `${value}.json`;
  }

  return requireFromHere.resolve(value, { paths: [baseDirectory] });
}

function hasBunCompilerTypes(config: ParsedTsconfig): boolean {
  const types = config.compilerOptions?.types;

  return Array.isArray(types) && types.includes("bun");
}

async function tsconfigChainIncludesBunTypes(
  tsconfigPath: string,
  seen = new Set<string>(),
): Promise<boolean> {
  const normalizedPath = resolve(tsconfigPath);

  if (seen.has(normalizedPath)) {
    throw new Error(`circular tsconfig extends chain at ${normalizedPath}`);
  }

  seen.add(normalizedPath);

  const config = await readTsconfig(normalizedPath);

  if (hasBunCompilerTypes(config)) {
    return true;
  }

  if (typeof config.extends !== "string" || config.extends.trim().length === 0) {
    return false;
  }

  const extendedPath = resolveExtendsTsconfigPath(dirname(normalizedPath), config.extends);

  return tsconfigChainIncludesBunTypes(extendedPath, seen);
}

async function validateTscConfig(
  target: RequestedTarget,
): Promise<TscConfigValidationError | null> {
  const tsconfigPath = join(target.cwd, DLER_TSC_DEFAULTS.tsconfigFileName);

  try {
    const hasBunTypes = await tsconfigChainIncludesBunTypes(tsconfigPath);

    if (hasBunTypes) {
      return null;
    }

    return {
      fatal: true,
      label: target.label,
      reason: `${DLER_TSC_DEFAULTS.tsconfigFileName} must include compilerOptions.types with "bun" directly or through extends`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      fatal: true,
      label: target.label,
      reason: `invalid ${DLER_TSC_DEFAULTS.tsconfigFileName}: ${message}`,
    };
  }
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return new Response(stream).text();
}

async function runCommand(
  cwd: string,
  runner: string,
  options: { readonly bunx: boolean },
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const invocation = createTscCommandInvocation(runner, options);
  const processHandle = Bun.spawn([...invocation.argv], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessStream(processHandle.stdout),
    readProcessStream(processHandle.stderr),
    processHandle.exited,
  ]);

  return { exitCode, stderr, stdout };
}

async function runTscTarget(target: TscTarget, options: TscExecutionOptions): Promise<TscResult> {
  const startedAt = performance.now();
  const primaryRunner = getPrimaryRunnerForMode(options.runnerMode);
  const primary = await runCommand(target.cwd, primaryRunner, { bunx: options.bunx });

  if (options.runnerMode !== "auto" || !isMissingRunner(primary, primaryRunner)) {
    return {
      command: createTscCommandInvocation(primaryRunner, { bunx: options.bunx }).display,
      cwd: target.cwd,
      durationMs: Math.round(performance.now() - startedAt),
      exitCode: primary.exitCode,
      fallbackUsed: false,
      label: target.label,
      ok: primary.exitCode === 0,
      runner: primaryRunner,
      runnerMode: options.runnerMode,
      stderr: primary.stderr,
      stdout: primary.stdout,
    };
  }

  const fallback = await runCommand(target.cwd, DLER_TSC_DEFAULTS.fallbackRunner, {
    bunx: options.bunx,
  });

  return {
    command: createTscCommandInvocation(DLER_TSC_DEFAULTS.fallbackRunner, {
      bunx: options.bunx,
    }).display,
    cwd: target.cwd,
    durationMs: Math.round(performance.now() - startedAt),
    exitCode: fallback.exitCode,
    fallbackUsed: true,
    label: target.label,
    ok: fallback.exitCode === 0,
    runner: DLER_TSC_DEFAULTS.fallbackRunner,
    runnerMode: options.runnerMode,
    stderr: fallback.stderr,
    stdout: fallback.stdout,
  };
}

async function resolveTscRequestedTargets(options: {
  readonly cwd: string;
  readonly rawTargets: string | undefined;
}): Promise<{
  readonly labels: readonly string[];
  readonly resolution: {
    readonly resolved: readonly RequestedTarget[];
    readonly skipped: readonly SkippedTarget[];
  };
}> {
  const explicitTargets = options.rawTargets?.trim();
  if (explicitTargets && explicitTargets.length > 0) {
    const labels = explicitTargets
      .split(",")
      .map((target) => target.trim())
      .filter((target, index, targets) => target.length > 0 && targets.indexOf(target) === index);

    return {
      labels,
      resolution: await resolveDirectoryTargets(options.cwd, labels),
    };
  }

  try {
    return await resolveRequestedTargets({ cwd: options.cwd, rawTargets: undefined });
  } catch {
    return {
      labels: ["."],
      resolution: {
        resolved: [{ cwd: options.cwd, label: basename(options.cwd) || "." }],
        skipped: [],
      },
    };
  }
}

async function createTscPlan(options: {
  readonly bunx: boolean;
  readonly runnerMode: TscRunnerMode;
  readonly targets: readonly RequestedTarget[];
}): Promise<{
  readonly invalidTargets: readonly TscConfigValidationError[];
  readonly plannedTargets: readonly TscTarget[];
  readonly skippedTargets: readonly SkippedTarget[];
}> {
  const invalidTargets: TscConfigValidationError[] = [];
  const plannedTargets: TscTarget[] = [];
  const skippedTargets: SkippedTarget[] = [];

  for (const target of options.targets) {
    if (!(await fileExists(`${target.cwd}/${DLER_TSC_DEFAULTS.tsconfigFileName}`))) {
      skippedTargets.push({
        label: target.label,
        reason: `missing ${DLER_TSC_DEFAULTS.tsconfigFileName}`,
      });
      continue;
    }

    const configError = await validateTscConfig(target);

    if (configError) {
      invalidTargets.push(configError);
      continue;
    }

    const runner = getPrimaryRunnerForMode(options.runnerMode);
    const invocation = createTscCommandInvocation(runner, { bunx: options.bunx });

    plannedTargets.push({
      command: invocation.argv,
      cwd: target.cwd,
      displayCommand: invocation.display,
      label: target.label,
    });
  }

  return { invalidTargets, plannedTargets, skippedTargets };
}

function pushProcessOutput(
  lines: string[],
  colors: TscColors,
  label: string,
  stream: "stdout" | "stderr",
  value: string,
): void {
  const text = value.trim();
  if (text.length === 0) {
    return;
  }

  lines.push(
    `  ${colors.bold(label)} ${colors.gray(`${stream}:`)}`,
    ...text.split("\n").map((line) => `     ${colors.gray(line)}`),
  );
}

function formatTscPreviewText(options: {
  readonly bunx: boolean;
  readonly colors: TscColors;
  readonly concurrency: number;
  readonly runnerMode: TscRunnerMode;
  readonly skippedTargets: readonly SkippedTarget[];
  readonly targets: readonly TscTarget[];
  readonly verbose: boolean;
}): string[] {
  const primaryRunner = getPrimaryRunnerForMode(options.runnerMode);
  const fallbackText =
    options.runnerMode === "auto"
      ? ` ${options.colors.gray(`fallback: ${formatTscCommand(DLER_TSC_DEFAULTS.fallbackRunner, { bunx: options.bunx })}`)}`
      : "";
  const lines = [
    options.colors.bold(options.colors.cyan(`${DLER_COMMAND_NAMES.tsc} preview`)),
    "",
    `${options.colors.bold("Runner:")} ${options.colors.magenta(formatTscCommand(primaryRunner, { bunx: options.bunx }))}${fallbackText}`,
    `${options.colors.bold("Mode:")} ${options.colors.magenta(options.bunx ? "bunx" : "local")}`,
    `${options.colors.bold("Concurrency:")} ${options.colors.magenta(options.concurrency)}`,
    `${options.colors.bold("Targets:")} ${formatCount(options.colors, options.targets.length, "planned", "green")}, ${formatCount(options.colors, options.skippedTargets.length, "skipped", "yellow")}`,
  ];

  if (options.targets.length > 0) {
    lines.push(
      "",
      options.colors.bold("Planned"),
      ...formatLabelRows(
        options.targets.map((target) => ({
          detail: options.verbose ? target.displayCommand : undefined,
          label: target.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.skippedTargets.length > 0) {
    lines.push(
      "",
      options.colors.bold(options.colors.yellow("Skipped")),
      ...formatLabelRows(
        options.skippedTargets.map((target) => ({
          detail: target.reason,
          label: target.label,
        })),
        options.colors,
      ),
    );
  }

  lines.push(
    "",
    `${options.colors.yellow("No typecheck executed.")} Pass ${options.colors.bold("--apply")} to run the planned checks.`,
    options.verbose
      ? `Use ${options.colors.bold("--json")} for the full machine-readable plan.`
      : `Use ${options.colors.bold("--verbose")} or ${options.colors.bold("--json")} to inspect generated commands.`,
  );

  return lines;
}

function formatTscResultText(options: {
  readonly bunx: boolean;
  readonly colors: TscColors;
  readonly concurrency: number;
  readonly results: readonly TscResult[];
  readonly runnerMode: TscRunnerMode;
  readonly skippedTargets: readonly SkippedTarget[];
  readonly totalDurationMs: number;
  readonly verbose: boolean;
}): string[] {
  const failed = options.results.filter((result) => !result.ok);
  const passed = options.results.filter((result) => result.ok);
  const lines = [
    options.colors.bold(options.colors.cyan(DLER_COMMAND_NAMES.tsc)),
    "",
    `${options.colors.bold("Mode:")} ${options.colors.magenta(options.bunx ? "bunx" : "local")}`,
    `${options.colors.bold("Concurrency:")} ${options.colors.magenta(options.concurrency)}`,
    `${options.colors.bold("Targets:")} ${formatCount(options.colors, passed.length, "passed", "green")}, ${formatCount(options.colors, failed.length, "failed", "yellow")}, ${formatCount(options.colors, options.skippedTargets.length, "skipped", "yellow")}`,
  ];

  if (options.results.length > 0) {
    lines.push(
      "",
      options.colors.bold("Checked"),
      ...formatLabelRows(
        options.results.map((result) => ({
          detail: options.verbose
            ? `${formatTscCommand(result.runner, { bunx: options.bunx })} (${result.durationMs}ms${result.fallbackUsed ? ", fallback" : ""})`
            : result.ok
              ? result.runner
              : `${result.runner} failed`,
          label: result.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.skippedTargets.length > 0) {
    lines.push(
      "",
      options.colors.bold(options.colors.yellow("Skipped")),
      ...formatLabelRows(
        options.skippedTargets.map((target) => ({
          detail: target.reason,
          label: target.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.verbose) {
    lines.push(
      "",
      options.colors.bold(options.colors.cyan("Details")),
      `  Total duration: ${options.colors.bold(`${options.totalDurationMs}ms`)}`,
    );

    for (const result of options.results) {
      pushProcessOutput(lines, options.colors, result.label, "stdout", result.stdout);
      pushProcessOutput(lines, options.colors, result.label, "stderr", result.stderr);
    }
  } else {
    for (const result of failed) {
      pushProcessOutput(lines, options.colors, result.label, "stdout", result.stdout);
      pushProcessOutput(lines, options.colors, result.label, "stderr", result.stderr);
    }
  }

  lines.push(
    "",
    failed.length > 0
      ? `${options.colors.yellow("Typecheck failed.")} Re-run with ${options.colors.bold("--verbose")} for durations and command details.`
      : options.verbose
        ? `${options.colors.green("Typecheck passed.")} Use ${options.colors.bold("--json")} for the full machine-readable result.`
        : `${options.colors.green("Typecheck passed.")} Use ${options.colors.bold("--verbose")} for durations and process output.`,
  );

  return lines;
}

export default defineCommand({
  meta: {
    name: "tsc",
    description:
      "Typecheck selected workspace packages with tsgo --noEmit and fallback to tsc --noEmit",
  },
  agent: {
    notes:
      "Default execution is preview-only. Pass --apply to run tsgo --noEmit for each target. If tsgo is unavailable for a target, dler falls back to tsc --noEmit. Each target tsconfig chain must include compilerOptions.types with bun. When --targets is omitted, dler derives targets from cwd: the current workspace package, all workspace packages from the monorepo root, or the current directory outside a monorepo.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["process.exec"],
  },
  help: {
    examples: [
      "rse tsc",
      "rse tsc --targets packages/rempts,plugins/dler",
      "rse tsc --targets plugins/dler --apply",
      "rse tsc --runner tsc --apply",
      "rse tsc --runner tsc --bunx --apply",
      "rse tsc --concurrency 5 --apply",
      "rse tsc --verbose",
    ],
    text: "Targets come from --targets or cwd scope when omitted. Every target tsconfig chain must include compilerOptions.types with bun. Default mode previews the resolved typecheck plan; pass --apply to execute tsgo --noEmit with tsc --noEmit as an unavailable-runner fallback.",
  },
  options: {
    targets: {
      type: "string",
      description:
        "Comma-separated workspace paths to typecheck in order (defaults to cwd-derived scope when omitted)",
      hint: "Examples: packages/rempts,plugins/dler,apps/rse",
      inputSources: ["flag"],
    },
    concurrency: {
      type: "number",
      defaultValue: DLER_CONCURRENCY_DEFAULTS.tsc,
      description: "Maximum number of TypeScript targets to check at once",
      inputSources: ["flag", "default"],
    },
    runner: {
      type: "string",
      defaultValue: DLER_TSC_DEFAULTS.runnerMode,
      description: "TypeScript runner mode: auto, tsgo, or tsc",
      hint: "auto runs tsgo first and falls back to tsc only when tsgo is unavailable",
      inputSources: ["flag", "default"],
    },
    bunx: {
      type: "boolean",
      defaultValue: false,
      description: "Run the selected TypeScript runner through bunx instead of local bun run",
      inputSources: ["flag", "default"],
    },
    verbose: {
      type: "boolean",
      description:
        "Show verbose text output, including generated commands, durations, and process output",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const concurrency = resolveConcurrency(ctx.options.concurrency, {
      defaultValue: DLER_CONCURRENCY_DEFAULTS.tsc,
      label: "--concurrency",
    });
    const runnerMode = resolveRunnerMode(ctx.options.runner);
    const bunx = ctx.options.bunx === true;
    const requestedTargets = await resolveTscRequestedTargets({
      cwd: ctx.cwd,
      rawTargets: ctx.options.targets,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return ctx.exit(1, `Target discovery failed: ${message}`);
    });
    const plan = await createTscPlan({
      bunx,
      runnerMode,
      targets: requestedTargets.resolution.resolved,
    });
    const skippedTargets = [
      ...requestedTargets.resolution.skipped,
      ...plan.skippedTargets,
      ...plan.invalidTargets,
    ];
    const hasInvalidTargets = plan.invalidTargets.length > 0;
    const targetSets = createTargetSets({
      plannedTargets: plan.plannedTargets,
      skippedTargets,
    });

    if (plan.plannedTargets.length === 0) {
      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            apply: ctx.safety.apply,
            bunx,
            concurrency,
            executedTargets: targetSets.executedTargets,
            ok: false,
            plannedTargets: targetSets.plannedTargets,
            preview: !ctx.safety.apply,
            runnerMode,
            runner: getPrimaryRunnerForMode(runnerMode),
            fallbackRunner: DLER_TSC_DEFAULTS.fallbackRunner,
            skipped: skippedTargets,
            skippedTargets: targetSets.skippedTargets,
            targets: requestedTargets.labels,
          },
          DLER_COMMAND_NAMES.tsc,
        );
        return;
      }

      for (const line of formatTscPreviewText({
        bunx,
        colors: ctx.colors.stdout,
        concurrency,
        runnerMode,
        skippedTargets,
        targets: plan.plannedTargets,
        verbose: ctx.options.verbose === true,
      })) {
        ctx.out(line);
      }

      ctx.exit(1, "No TypeScript targets remain after validation.");
    }

    if (!ctx.safety.apply) {
      const preview = {
        apply: false,
        bunx,
        concurrency,
        executedTargets: targetSets.executedTargets,
        ok: !hasInvalidTargets,
        plannedTargets: targetSets.plannedTargets,
        preview: true,
        runnerMode,
        runner: getPrimaryRunnerForMode(runnerMode),
        fallbackRunner: DLER_TSC_DEFAULTS.fallbackRunner,
        skipped: skippedTargets,
        skippedTargets: targetSets.skippedTargets,
        steps: plan.plannedTargets.map((target) => ({
          command: target.displayCommand,
          cwd: target.cwd,
          label: target.label,
        })),
        targets: requestedTargets.labels,
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(preview, DLER_COMMAND_NAMES.tsc);
        if (hasInvalidTargets) {
          ctx.exit(1, "TypeScript config validation failed.");
        }
        return;
      }

      for (const line of formatTscPreviewText({
        bunx,
        colors: ctx.colors.stdout,
        concurrency,
        runnerMode,
        skippedTargets,
        targets: plan.plannedTargets,
        verbose: ctx.options.verbose === true,
      })) {
        ctx.out(line);
      }

      if (hasInvalidTargets) {
        ctx.exit(1, "TypeScript config validation failed.");
      }

      return;
    }

    if (hasInvalidTargets) {
      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            apply: true,
            bunx,
            concurrency,
            executedTargets: targetSets.executedTargets,
            ok: false,
            plannedTargets: targetSets.plannedTargets,
            preview: false,
            runnerMode,
            runner: getPrimaryRunnerForMode(runnerMode),
            fallbackRunner: DLER_TSC_DEFAULTS.fallbackRunner,
            skipped: skippedTargets,
            skippedTargets: targetSets.skippedTargets,
            targets: requestedTargets.labels,
          },
          DLER_COMMAND_NAMES.tsc,
        );
      } else {
        for (const line of formatTscPreviewText({
          bunx,
          colors: ctx.colors.stdout,
          concurrency,
          runnerMode,
          skippedTargets,
          targets: plan.plannedTargets,
          verbose: ctx.options.verbose === true,
        })) {
          ctx.out(line);
        }
      }

      ctx.exit(1, "TypeScript config validation failed.");
    }

    ctx.safety.assertApplied("process.exec");

    const startedAt = performance.now();
    const results = await mapWithConcurrency(plan.plannedTargets, concurrency, async (target) =>
      runTscTarget(target, { bunx, runnerMode }),
    );

    const totalDurationMs = Math.round(performance.now() - startedAt);
    const executedTargetSets = createTargetSets({
      executedTargets: results,
      plannedTargets: plan.plannedTargets,
      skippedTargets,
    });
    const ok = results.every((result) => result.ok);
    const resultPayload = {
      apply: true,
      bunx,
      concurrency,
      executedTargets: executedTargetSets.executedTargets,
      ok,
      plannedTargets: executedTargetSets.plannedTargets,
      preview: false,
      results: results.map((result) => ({
        command: result.command,
        cwd: result.cwd,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        fallbackUsed: result.fallbackUsed,
        label: result.label,
        ok: result.ok,
        runner: result.runner,
        runnerMode: result.runnerMode,
        stderr: result.stderr,
        stdout: result.stdout,
      })),
      runnerMode,
      runner: getPrimaryRunnerForMode(runnerMode),
      fallbackRunner: DLER_TSC_DEFAULTS.fallbackRunner,
      skipped: skippedTargets,
      skippedTargets: executedTargetSets.skippedTargets,
      totalDurationMs,
    };

    if (ctx.output.mode === "json") {
      if (ok) {
        ctx.output.result(resultPayload, DLER_COMMAND_NAMES.tsc);
        return;
      }

      ctx.output.data(resultPayload);
    } else {
      for (const line of formatTscResultText({
        bunx,
        colors: ctx.colors.stdout,
        concurrency,
        results,
        runnerMode,
        skippedTargets,
        totalDurationMs,
        verbose: ctx.options.verbose === true,
      })) {
        ctx.out(line);
      }
    }

    if (!ok) {
      const failedTarget = results.find((result) => !result.ok);
      ctx.exit(
        1,
        failedTarget
          ? `Typecheck failed for ${failedTarget.label} with ${formatTscCommand(failedTarget.runner, { bunx })} (exit ${failedTarget.exitCode}).`
          : "Typecheck failed.",
      );
    }
  },
});
