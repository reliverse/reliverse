import {
  createBuildPlan,
  createBuildProviderRegistry,
  createBuilderRuntime,
  createBunBuildProvider,
} from "../../impl/build";
import { defineCommand } from "@reliverse/rempts";

import { createTargetSets, formatSkippedMessages } from "../../impl/report-helpers";
import { createBuildSummary, formatBuildSummary } from "../../impl/result-contract";
import { resolveRequestedTargets } from "../../impl/shared-targets";

function formatBuildResultLine(result: { durationMs: number; label: string; ok: boolean }): string {
  return `${result.ok ? "Built" : "Failed"}: ${result.label} (${result.durationMs}ms)`;
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Build selected Reliverse workspaces through generated per-package build commands",
  },
  agent: {
    notes:
      "Use --dry-run first when you need a preview. When --targets is omitted, dler derives targets from cwd: the current workspace package or all workspace packages from the monorepo root.",
  },
  conventions: {
    idempotent: true,
    supportsDryRun: true,
  },
  help: {
    examples: [
      "rse dler build --dry-run",
      "rse dler build --targets plugins/pm,plugins/dler,apps/cli",
      "rse dler build --targets plugins/dler --provider bun --json",
    ],
    text: "dler plans a generated build command for each eligible workspace target, then executes those commands in order through the selected provider. Dry-run shows the commands that would be executed for the resolved target scope.",
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview resolved targets and generated build commands without executing them",
      inputSources: ["flag"],
    },
    provider: {
      type: "string",
      defaultValue: "bun",
      description: "Build provider to use for the selected targets",
      hint: "Only the Bun provider ships in v1, but the runtime is provider-oriented.",
      inputSources: ["flag", "default"],
    },
    targets: {
      type: "string",
      description: "Comma-separated workspace paths to build in order (defaults to cwd-derived scope when omitted)",
      hint: "Examples: plugins/pm,plugins/dler,apps/cli",
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
      ctx.exit(1, "No build targets resolved. Pass --targets path1,path2 or run from a workspace root/package directory.");
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
            dryRun: Boolean(ctx.options.dryRun),
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

    if (ctx.options.dryRun) {
      const summary = createBuildSummary({
        planned: targets.length,
        skipped: skippedTargets,
        targets: [],
      });
      const preview = {
        dryRun: true,
        executedTargets: targetSets.executedTargets,
        ok: true,
        plannedTargets: targetSets.plannedTargets,
        provider,
        skipped: skippedTargets,
        skippedTargets: targetSets.skippedTargets,
        steps: targets.map((target) => ({
          command: target.displayCommand ?? target.command.join(" "),
          cwd: target.cwd,
          label: target.label,
          packageCommand: plan.plannedTargets.find((plannedTarget) => plannedTarget.label === target.label)?.packageCommand.display,
        })),
        summary,
        targets: targetLabels,
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(preview, "dler build");
        return;
      }

      ctx.out(`Provider: ${provider}`);
      ctx.out(`Targets: ${targets.map((target) => target.label).join(", ")}`);

      for (const message of formatSkippedMessages(skippedTargets)) {
        ctx.err(message);
      }

      for (const step of preview.steps) {
        ctx.out(`Dry run: would run ${step.command} in ${step.label}`);
      }

      return;
    }

    const runtime = createBuilderRuntime({
      defaultProvider: providerRegistry.defaultProvider,
      providers: [createBunBuildProvider()],
    });
    const report = await runtime.run({
      provider,
      targets,
    }).catch((error: unknown) => {
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
            dryRun: false,
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
        dryRun: false,
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
