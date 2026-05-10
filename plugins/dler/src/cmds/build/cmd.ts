import { relative } from "node:path";

import { defineCommand } from "@reliverse/rempts";

import {
  createBuildPlan,
  createBuildProviderRegistry,
  createBuilderRuntime,
  createBunBuildProvider,
} from "../../impl/build";
import { resolveConcurrency } from "../../impl/concurrency";
import {
  DLER_BUILD_BUNDLE_STRATEGIES,
  DLER_BUILD_DECLARATION_STRATEGIES,
  DLER_BUILD_DEFAULTS,
  DLER_COMMAND_NAMES,
  DLER_CONCURRENCY_DEFAULTS,
} from "../../impl/constants";
import type { BunBundleStrategy } from "../../impl/build/package-build-command";
import type { DlerDeclarationStrategy } from "../../impl/build/declaration-layer";
import { createTargetSets, formatSkippedMessages } from "../../impl/report-helpers";
import { createBuildSummary, formatBuildSummary } from "../../impl/result-contract";
import { resolveRequestedTargets } from "../../impl/shared-targets";

function formatBuildResultLine(result: { durationMs: number; label: string; ok: boolean }): string {
  return `${result.ok ? "Built" : "Failed"}: ${result.label} (${result.durationMs}ms)`;
}

function formatRelativePath(root: string, path: string): string {
  const relativePath = relative(root, path);

  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : path;
}

function normalizeSkippedReason(reason: string): string {
  const ignoredPackageMatch = /^package (.+) is ignored by workspace policy$/.exec(reason);

  if (ignoredPackageMatch) {
    return `ignored by workspace policy (${ignoredPackageMatch[1]})`;
  }

  return reason;
}

function resolveBundleStrategy(value: string | undefined): BunBundleStrategy {
  const strategy = value?.trim() || DLER_BUILD_DEFAULTS.bundleStrategy;

  if (DLER_BUILD_BUNDLE_STRATEGIES.includes(strategy as BunBundleStrategy)) {
    return strategy as BunBundleStrategy;
  }

  throw new Error(
    `Invalid --bundle-strategy "${strategy}". Expected one of: ${DLER_BUILD_BUNDLE_STRATEGIES.join(", ")}.`,
  );
}

function resolveDeclarationStrategy(value: string | undefined): DlerDeclarationStrategy {
  const strategy = value?.trim() || DLER_BUILD_DEFAULTS.declarationStrategy;

  if (DLER_BUILD_DECLARATION_STRATEGIES.includes(strategy as DlerDeclarationStrategy)) {
    return strategy as DlerDeclarationStrategy;
  }

  throw new Error(
    `Invalid --declaration-strategy "${strategy}". Expected one of: ${DLER_BUILD_DECLARATION_STRATEGIES.join(", ")}.`,
  );
}

type PreviewStyle = (value: unknown) => string;

interface PreviewColors {
  readonly bold: PreviewStyle;
  readonly cyan: PreviewStyle;
  readonly dim: PreviewStyle;
  readonly gray: PreviewStyle;
  readonly green: PreviewStyle;
  readonly magenta: PreviewStyle;
  readonly yellow: PreviewStyle;
}

function formatCount(
  colors: PreviewColors,
  count: number,
  label: string,
  accent: "green" | "yellow",
): string {
  const value = count > 0 ? colors[accent](String(count)) : colors.dim(String(count));

  return `${value} ${label}`;
}

function formatLabelRows(
  rows: ReadonlyArray<{ readonly label: string; readonly detail?: string | undefined }>,
  colors: PreviewColors,
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

function formatBuildPreviewText(options: {
  readonly colors: PreviewColors;
  readonly concurrency: number;
  readonly commandDetails: readonly {
    readonly command: string;
    readonly cwd: string;
    readonly label: string;
  }[];
  readonly provider: string;
  readonly bundleStrategy: BunBundleStrategy;
  readonly declarationStrategy: DlerDeclarationStrategy;
  readonly root: string;
  readonly skippedTargets: readonly { readonly label: string; readonly reason: string }[];
  readonly verbose: boolean;
  readonly targets: readonly { readonly cwd: string; readonly label?: string | undefined }[];
}): string[] {
  const lines = [
    options.colors.bold(options.colors.cyan(`${DLER_COMMAND_NAMES.build} preview`)),
    "",
    `${options.colors.bold("Provider:")} ${options.colors.magenta(options.provider)}`,
    `${options.colors.bold("Bundle strategy:")} ${options.colors.magenta(options.bundleStrategy)}`,
    `${options.colors.bold("Declaration strategy:")} ${options.colors.magenta(options.declarationStrategy)}`,
    `${options.colors.bold("Concurrency:")} ${options.colors.magenta(options.concurrency)}`,
    `${options.colors.bold("Targets:")} ${formatCount(options.colors, options.targets.length, "planned", "green")}, ${formatCount(options.colors, options.skippedTargets.length, "skipped", "yellow")}`,
    "",
    options.colors.bold("Planned"),
    ...formatLabelRows(
      options.targets.map((target) => {
        const label = target.label ?? target.cwd;
        const relativePath = formatRelativePath(options.root, target.cwd);

        return {
          detail: relativePath === label ? undefined : relativePath,
          label,
        };
      }),
      options.colors,
    ),
  ];

  if (options.skippedTargets.length > 0) {
    lines.push(
      "",
      options.colors.bold(options.colors.yellow("Skipped")),
      ...formatLabelRows(
        options.skippedTargets.map((target) => ({
          detail: normalizeSkippedReason(target.reason),
          label: target.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.verbose) {
    lines.push("", options.colors.bold(options.colors.cyan("Generated commands")));

    for (const [index, step] of options.commandDetails.entries()) {
      lines.push(
        `  ${options.colors.magenta(`${index + 1}.`)} ${options.colors.bold(step.label ?? step.cwd)}`,
        `     ${options.colors.gray(step.command.replaceAll(options.root, "."))}`,
      );
    }
  }

  lines.push(
    "",
    `${options.colors.yellow("No changes made.")} Pass ${options.colors.bold("--apply")} to run the planned builds.`,
    options.verbose
      ? `Use ${options.colors.bold("--json")} for the full machine-readable plan.`
      : `Use ${options.colors.bold("--verbose")} or ${options.colors.bold("--json")} to inspect generated commands.`,
  );

  return lines;
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Build selected Bun workspaces through generated per-package build commands",
  },
  agent: {
    notes:
      "Default execution is preview-only. Pass --apply to execute generated build commands. When --targets is omitted, dler derives targets from cwd: the current workspace package or all workspace packages from the monorepo root.",
  },
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["process.exec", "fs.write"],
  },
  help: {
    examples: [
      "rse build",
      "rse build --targets plugins/pm,plugins/dler,apps/rse --apply",
      "rse build --targets plugins/dler --provider bun --apply --json",
      "rse build --verbose",
      "rse build --concurrency 2 --apply",
    ],
    text: "dler plans a generated build command for each eligible workspace target. Default mode previews the commands for the resolved target scope; pass --apply to execute them through the selected provider.",
  },
  options: {
    provider: {
      type: "string",
      defaultValue: DLER_BUILD_DEFAULTS.provider,
      description: "Build provider to use for the selected targets",
      hint: "Only the Bun provider ships in v0, but the runtime is provider-oriented.",
      inputSources: ["flag", "default"],
    },
    targets: {
      type: "string",
      description:
        "Comma-separated workspace paths to build in order (defaults to cwd-derived scope when omitted)",
      hint: "Examples: plugins/pm,plugins/dler,apps/rse",
      inputSources: ["flag"],
    },
    concurrency: {
      type: "number",
      defaultValue: DLER_CONCURRENCY_DEFAULTS.build,
      description: "Maximum number of build targets to run at once",
      inputSources: ["flag", "default"],
    },
    verbose: {
      type: "boolean",
      description: "Show verbose text preview details, including generated build commands",
      inputSources: ["flag"],
    },
    bundleStrategy: {
      type: "string",
      defaultValue: DLER_BUILD_DEFAULTS.bundleStrategy,
      description:
        "Bun runtime output strategy: auto, single (one dist/index.js), or split (one output per entrypoint)",
      hint: "auto | single | split",
      inputSources: ["flag", "default"],
    },
    declarationStrategy: {
      type: "string",
      defaultValue: DLER_BUILD_DEFAULTS.declarationStrategy,
      description: "Declar declaration strategy: emit, fast, rollup, or off",
      hint: "emit | fast | rollup | off",
      inputSources: ["flag", "default"],
    },
  },
  async handler(ctx) {
    const concurrency = resolveConcurrency(ctx.options.concurrency, {
      defaultValue: DLER_CONCURRENCY_DEFAULTS.build,
      label: "--concurrency",
    });
    const bundleStrategy = (() => {
      try {
        return resolveBundleStrategy(ctx.options.bundleStrategy);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return ctx.exit(1, message);
      }
    })();
    const declarationStrategy = (() => {
      try {
        return resolveDeclarationStrategy(ctx.options.declarationStrategy);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return ctx.exit(1, message);
      }
    })();
    const providerRegistry = createBuildProviderRegistry({
      providers: [createBunBuildProvider()],
    });
    const provider = ctx.options.provider ?? providerRegistry.defaultProvider;
    const explicitTargets = ctx.options.targets?.trim();
    const requestedTargets = await resolveRequestedTargets({
      cwd: ctx.cwd,
      rawTargets: ctx.options.targets,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return ctx.exit(1, `Target discovery failed: ${message}`);
    });
    const targetLabels = requestedTargets.labels;

    if (targetLabels.length === 0) {
      ctx.exit(
        1,
        "No build targets resolved. Pass --targets path1,path2 or run from a workspace root/package directory.",
      );
    }

    if (!providerRegistry.get(provider)) {
      ctx.exit(
        1,
        `Unknown build provider \"${provider}\". Available providers: ${providerRegistry.ids.join(", ")}.`,
      );
    }

    const plan = await createBuildPlan({
      bundleStrategy,
      declarationStrategy,
      provider,
      targets: requestedTargets.resolution.resolved,
    });
    const skippedTargets = [...requestedTargets.resolution.skipped, ...plan.skippedTargets];
    const targets = plan.executionTargets;
    const targetSets = createTargetSets({
      plannedTargets: plan.plannedTargets,
      skippedTargets,
    });

    if (targets.length === 0) {
      const summary = createBuildSummary({
        planned: 0,
        skipped: skippedTargets,
        targets: [],
      });

      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            apply: ctx.safety.apply,
            bundleStrategy,
            declarationStrategy,
            preview: !ctx.safety.apply,
            executedTargets: targetSets.executedTargets,
            ok: false,
            plannedTargets: targetSets.plannedTargets,
            provider,
            skipped: skippedTargets,
            skippedTargets: targetSets.skippedTargets,
            summary,
            targets: [],
          },
          DLER_COMMAND_NAMES.build,
        );
        return;
      }

      for (const message of formatSkippedMessages(skippedTargets)) {
        ctx.err(message);
      }

      ctx.exit(1, "No buildable workspace targets remain after validation.");
    }

    if (!ctx.safety.apply) {
      const summary = createBuildSummary({
        planned: targets.length,
        skipped: skippedTargets,
        targets: [],
      });
      const preview = {
        apply: false,
        bundleStrategy,
        concurrency,
        declarationStrategy,
        preview: true,
        executedTargets: targetSets.executedTargets,
        ok: true,
        plannedTargets: targetSets.plannedTargets,
        provider,
        skipped: skippedTargets,
        skippedTargets: targetSets.skippedTargets,
        steps: targets.map((target) => ({
          command: target.displayCommand ?? target.command.join(" "),
          cwd: target.cwd,
          label: target.label ?? target.cwd,
          packageCommand: plan.plannedTargets.find(
            (plannedTarget) => plannedTarget.label === target.label,
          )?.packageCommand.display,
          resolvedBundleStrategy: plan.plannedTargets.find(
            (plannedTarget) => plannedTarget.label === target.label,
          )?.packageCommand.bundleStrategy,
          declarationStrategy: target.declarationStrategy,
        })),
        summary,
        targets: targetLabels,
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(preview, DLER_COMMAND_NAMES.build);
        return;
      }

      for (const line of formatBuildPreviewText({
        colors: ctx.colors.stdout,
        concurrency,
        commandDetails: preview.steps,
        bundleStrategy,
        declarationStrategy,
        provider,
        root: ctx.cwd,
        skippedTargets,
        verbose: ctx.options.verbose === true,
        targets,
      })) {
        ctx.out(line);
      }

      return;
    }

    ctx.safety.assertApplied("process.exec");

    const runtime = createBuilderRuntime({
      defaultProvider: providerRegistry.defaultProvider,
      providers: [createBunBuildProvider()],
    });
    const report = await runtime
      .run({
        concurrency,
        provider,
        targets,
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return ctx.exit(1, `Build setup failed: ${message}`);
      });
    const summary = createBuildSummary({
      planned: targets.length,
      skipped: skippedTargets,
      targets: report.targets,
    });
    const executedTargetSets = createTargetSets({
      executedTargets: report.targets,
      plannedTargets: plan.plannedTargets,
      skippedTargets,
    });

    if (ctx.output.mode === "json") {
      if (report.ok) {
        ctx.output.result(
          {
            ...report,
            apply: true,
            bundleStrategy,
            concurrency,
            declarationStrategy,
            preview: false,
            executedTargets: executedTargetSets.executedTargets,
            skipped: skippedTargets,
            plannedTargets: executedTargetSets.plannedTargets,
            skippedTargets: executedTargetSets.skippedTargets,
            summary,
          },
          DLER_COMMAND_NAMES.build,
        );
        return;
      }

      ctx.output.data({
        ...report,
        apply: true,
        bundleStrategy,
        concurrency,
        declarationStrategy,
        preview: false,
        executedTargets: executedTargetSets.executedTargets,
        ok: false,
        plannedTargets: executedTargetSets.plannedTargets,
        skipped: skippedTargets,
        skippedTargets: executedTargetSets.skippedTargets,
        remptsPreview: 1,
        summary,
      });
    } else {
      ctx.out(`Provider: ${report.provider}`);
      ctx.out(`Bundle strategy: ${bundleStrategy}`);
      ctx.out(`Declaration strategy: ${declarationStrategy}`);

      for (const message of formatSkippedMessages(skippedTargets)) {
        ctx.err(message);
      }

      for (const result of report.targets) {
        ctx.out(formatBuildResultLine(result));
      }

      ctx.out(`Total duration: ${report.totalDurationMs}ms`);
      ctx.out(formatBuildSummary(summary));
    }

    if (!report.ok) {
      const failedTarget =
        report.targets.find((target) => !target.ok) ?? ctx.exit(1, "Build failed.");

      if (ctx.output.mode !== "json") {
        if (failedTarget.stdout.trim().length > 0) {
          ctx.out(failedTarget.stdout.trim());
        }

        if (failedTarget.stderr.trim().length > 0) {
          ctx.err(failedTarget.stderr.trim());
        }
      }

      ctx.exit(
        1,
        `Build failed for ${failedTarget.label} during generated command execution (exit ${failedTarget.exitCode}). Re-run with --targets ${failedTarget.label} for a narrower retry.`,
      );
    }
  },
});
