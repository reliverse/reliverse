import {
  createBuildProviderRegistry,
  createBuilderRuntime,
  createBunBuildProvider,
  resolveBuildableTargets,
  type BuildTarget,
} from "../../../impl/build";
import { defineCommand } from "@reliverse/rempts";

import { DEFAULT_RSE_BUILD_TARGETS, parseTargetsOption } from "../../../impl/build/targets";
import { createTargetSets, formatSkippedMessages } from "../../../impl/report-helpers";
import { createBuildSummary, formatBuildSummary } from "../../../impl/result-contract";
import { resolveDirectoryTargets } from "../../../impl/shared-targets";

function formatBuildResultLine(result: { durationMs: number; label: string; ok: boolean }): string {
  return `${result.ok ? "Built" : "Failed"}: ${result.label} (${result.durationMs}ms)`;
}

function toBuildTargets(targets: readonly { cwd: string; label: string }[]): BuildTarget[] {
  return targets.map((target) => ({
    cwd: target.cwd,
    label: target.label,
    script: "build",
  }));
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Build selected Reliverse workspaces through the provider-oriented builder runtime",
  },
  agent: {
    notes:
      "Use --dry-run first when you need a preview. Targets are explicit and default to the core RSE dogfooding set.",
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
    text: "The Bun provider runs each target's build script in order and stops on the first failure so the result stays predictable for automation.",
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Preview the build plan without executing target build scripts",
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
      defaultValue: DEFAULT_RSE_BUILD_TARGETS.join(","),
      description: "Comma-separated workspace paths to build in order",
      hint: "Examples: plugins/pm,plugins/dler,apps/cli",
      inputSources: ["flag", "default"],
    },
  },
  async handler(ctx) {
    const providerRegistry = createBuildProviderRegistry({
      providers: [createBunBuildProvider()],
    });
    const provider = ctx.options.provider ?? providerRegistry.defaultProvider;
    const targetLabels = parseTargetsOption(
      ctx.options.targets ?? DEFAULT_RSE_BUILD_TARGETS.join(","),
    );

    if (targetLabels.length === 0) {
      ctx.exit(1, "Missing build targets. Pass --targets path1,path2 or use the default set.");
    }

    if (!providerRegistry.get(provider)) {
      ctx.exit(
        1,
        `Unknown build provider \"${provider}\". Available providers: ${providerRegistry.ids.join(", ")}.`,
      );
    }

    const resolution = await resolveDirectoryTargets(ctx.cwd, targetLabels);
    const validation = await resolveBuildableTargets({
      script: "build",
      targets: resolution.resolved,
    });
    const skippedTargets = [...resolution.skipped, ...validation.skipped];
    const targets = toBuildTargets(validation.buildable);
    const targetSets = createTargetSets({
      plannedTargets: validation.buildable,
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

      ctx.exit(1, "No valid build targets remain after validation.");
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
          cwd: target.cwd,
          label: target.label,
          script: "build",
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
        ctx.out(`Dry run: would run bun run build in ${step.label}`);
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
      plannedTargets: validation.buildable,
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
        `Build failed for ${failedTarget.label}. Re-run with --targets ${failedTarget.label} for a narrower retry.`,
      );
    }
  },
});
