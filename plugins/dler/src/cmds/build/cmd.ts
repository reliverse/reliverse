import { resolve } from "node:path";

import {
  createBuilderRuntime,
  createBunBuildProvider,
  type BuildTarget,
} from "../../impl/build";
import { defineCommand } from "@reliverse/rempts";

import { DEFAULT_RSE_BUILD_TARGETS, parseTargetsOption } from "../../impl/build/targets";

function toBuildTargets(cwd: string, targets: readonly string[]): BuildTarget[] {
  return targets.map((target) => ({
    cwd: resolve(cwd, target),
    label: target,
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
    const provider = ctx.options.provider ?? "bun";
    const targetLabels = parseTargetsOption(
      ctx.options.targets ?? DEFAULT_RSE_BUILD_TARGETS.join(","),
    );

    if (targetLabels.length === 0) {
      ctx.exit(1, "Missing build targets. Pass --targets path1,path2 or use the default set.");
    }

    const targets = toBuildTargets(ctx.cwd, targetLabels);

    if (ctx.options.dryRun) {
      const preview = {
        provider,
        steps: targets.map((target) => ({
          cwd: target.cwd,
          label: target.label,
          script: "build",
        })),
        targets: targetLabels,
      };

      if (ctx.output.mode === "json") {
        ctx.output.result(preview, "builder build");
        return;
      }

      ctx.out(`Provider: ${provider}`);
      ctx.out(`Targets: ${targetLabels.join(", ")}`);

      for (const step of preview.steps) {
        ctx.out(`Dry run: would run bun run build in ${step.label}`);
      }

      return;
    }

    const runtime = createBuilderRuntime({
      providers: [createBunBuildProvider()],
    });
    const report = await runtime.run({
      provider,
      targets,
    });

    if (ctx.output.mode === "json") {
      if (report.ok) {
        ctx.output.result(report, "builder build");
        return;
      }

      ctx.output.data({
        ...report,
        ok: false,
        remptsPreview: 1,
      });
    } else {
      ctx.out(`Provider: ${report.provider}`);

      for (const result of report.targets) {
        ctx.out(
          `${result.ok ? "Built" : "Failed"}: ${result.label} (${result.durationMs}ms)`,
        );
      }
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
