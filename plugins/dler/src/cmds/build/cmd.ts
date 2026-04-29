import { relative } from "node:path";

import { defineCommand } from "@reliverse/rempts";

import {
  createBuildPlan,
  createBuildProviderRegistry,
  createBuilderRuntime,
  createBunBuildProvider,
} from "../../impl/build";
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

function formatLabelRows(
  rows: ReadonlyArray<{ readonly label: string; readonly detail?: string | undefined }>,
): string[] {
  if (rows.length === 0) {
    return ["  none"];
  }

  const width = Math.max(...rows.map((row) => row.label.length));

  return rows.map((row) => {
    const label = row.label.padEnd(width);

    return row.detail ? `  ${label}  ${row.detail}` : `  ${row.label}`;
  });
}

function formatBuildPreviewText(options: {
  readonly commandDetails: readonly {
    readonly command: string;
    readonly cwd: string;
    readonly label: string;
  }[];
  readonly provider: string;
  readonly root: string;
  readonly skippedTargets: readonly { readonly label: string; readonly reason: string }[];
  readonly showCommands: boolean;
  readonly targets: readonly { readonly cwd: string; readonly label?: string | undefined }[];
}): string[] {
  const lines = [
    "dler build preview",
    "",
    `Provider: ${options.provider}`,
    `Targets: ${options.targets.length} planned, ${options.skippedTargets.length} skipped`,
    "",
    "Planned",
    ...formatLabelRows(
      options.targets.map((target) => {
        const label = target.label ?? target.cwd;
        const relativePath = formatRelativePath(options.root, target.cwd);

        return {
          detail: relativePath === label ? undefined : relativePath,
          label,
        };
      }),
    ),
  ];

  if (options.skippedTargets.length > 0) {
    lines.push(
      "",
      "Skipped",
      ...formatLabelRows(
        options.skippedTargets.map((target) => ({
          detail: normalizeSkippedReason(target.reason),
          label: target.label,
        })),
      ),
    );
  }

  if (options.showCommands) {
    lines.push("", "Generated commands");

    for (const [index, step] of options.commandDetails.entries()) {
      lines.push(
        `  ${index + 1}. ${step.label ?? step.cwd}`,
        `     ${step.command.replaceAll(options.root, ".")}`,
      );
    }
  }

  lines.push(
    "",
    "No changes made. Pass --apply to run the planned builds.",
    options.showCommands
      ? "Use --json for the full machine-readable plan."
      : "Use --show-commands or --json to inspect generated commands.",
  );

  return lines;
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Build selected Reliverse workspaces through generated per-package build commands",
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
      "rse build --show-commands",
    ],
    text: "dler plans a generated build command for each eligible workspace target. Default mode previews the commands for the resolved target scope; pass --apply to execute them through the selected provider.",
  },
  options: {
    provider: {
      type: "string",
      defaultValue: "bun",
      description: "Build provider to use for the selected targets",
      hint: "Only the Bun provider ships in v1, but the runtime is provider-oriented.",
      inputSources: ["flag", "default"],
    },
    targets: {
      type: "string",
      description:
        "Comma-separated workspace paths to build in order (defaults to cwd-derived scope when omitted)",
      hint: "Examples: plugins/pm,plugins/dler,apps/rse",
      inputSources: ["flag"],
    },
    showCommands: {
      type: "boolean",
      description: "Show generated build commands in text preview output",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
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
          "dler build",
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
        })),
        summary,
        targets: targetLabels,
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(preview, "dler build");
        return;
      }

      for (const line of formatBuildPreviewText({
        commandDetails: preview.steps,
        provider,
        root: ctx.cwd,
        skippedTargets,
        showCommands: ctx.options.showCommands === true,
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
            preview: false,
            executedTargets: executedTargetSets.executedTargets,
            skipped: skippedTargets,
            plannedTargets: executedTargetSets.plannedTargets,
            skippedTargets: executedTargetSets.skippedTargets,
            summary,
          },
          "dler build",
        );
        return;
      }

      ctx.output.data({
        ...report,
        apply: true,
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
