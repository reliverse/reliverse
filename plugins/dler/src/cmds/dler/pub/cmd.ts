import { defineCommand } from "@reliverse/rempts";

import { runNpmPublish } from "../../../impl/pub/npm-publish";
import { isSafeRelativePublishFrom } from "../../../impl/pub/paths";
import { runPrebuildForPackage } from "../../../impl/pub/prebuild";
import { createPublishStaging } from "../../../impl/pub/staging";
import { parseTargetsOption } from "../../../impl/pub/targets";
import { resolvePublishableTargets } from "../../../impl/pub/validation";
import { findUnsafeDependencySpecifiers } from "../../../impl/pub/workspace-deps";
import { createTargetSets, formatSkippedMessages } from "../../../impl/report-helpers";
import { createPublishSummary, formatPublishSummary } from "../../../impl/result-contract";
import { pathIsDirectory, resolveDirectoryTargets } from "../../../impl/shared-targets";

const BUILDER_PLUGIN_NAME = "dler";
const DEFAULT_PUBLISH_FROM = "dist";

function formatPublishResultLine(options: {
  readonly dryRun: boolean;
  readonly durationMs: number;
  readonly label: string;
  readonly packageName: string;
}): string {
  return `${options.dryRun ? "Prepared" : "Published"}: ${options.label} (${options.packageName}) in ${options.durationMs}ms`;
}

function okLabel(ctx: { colors: { stdout: { bold(text: string): string; green(text: string): string } } }, text: string): string {
  return ctx.colors.stdout.green(ctx.colors.stdout.bold(text));
}

function warnLabel(ctx: { colors: { stderr: { bold(text: string): string; yellow(text: string): string } } }, text: string): string {
  return ctx.colors.stderr.yellow(ctx.colors.stderr.bold(text));
}

export default defineCommand({
  meta: {
    name: "pub",
    description:
      "Publish selected workspace packages to npm using a staging directory (merged files + build output). Prebuild uses the builder plugin when it is registered on the CLI.",
  },
  agent: {
    notes:
      "Eligible packages: not private, type module, publishConfig.access public. v1 does not rewrite workspace/catalog specifiers — ensure versions are publishable. Requires npm CLI and registry auth for real publishes.",
  },
  interactive: "never",
  conventions: {
    idempotent: false,
    supportsDryRun: true,
  },
  help: {
    examples: [
      "rse dler pub --targets packages/foo --dry-run",
      "rse dler pub --targets packages/foo --no-prebuild --publish-from dist --dry-run",
      "rse dler pub --targets packages/foo --publish-from dist --tag next --dry-run",
    ],
    text: "With default prebuild, the dler must be loaded by the CLI. Otherwise pass --no-prebuild and --publish-from (relative to each package root). Staging always includes package.json and the publish-from directory; existing package.json `files` entries are merged in.",
  },
  options: {
    dryRun: {
      type: "boolean",
      description: "Run npm publish --dry-run (no upload)",
      inputSources: ["flag"],
    },
    prebuild: {
      type: "boolean",
      defaultValue: true,
      description:
        "Run bun run build before publish when dler is registered (use --no-prebuild to skip)",
      inputSources: ["flag", "default"],
    },
    publishFrom: {
      type: "string",
      description:
        "Directory relative to each package root to copy into the publish tarball (required with --no-prebuild; default dist when using prebuild)",
      inputSources: ["flag"],
    },
    tag: {
      type: "string",
      description: "npm dist-tag (npm publish --tag)",
      inputSources: ["flag"],
    },
    targets: {
      type: "string",
      description: "Comma-separated workspace paths (relative to --cwd) to publish in order",
      hint: "Example: packages/rempts,plugins/pub",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const targetsRaw = ctx.options.targets?.trim() ?? "";
    const targetLabels = parseTargetsOption(targetsRaw);

    if (targetLabels.length === 0) {
      ctx.exit(1, 'Missing targets. Pass --targets path1,path2 (comma-separated, relative to cwd).');
    }

    const prebuild = ctx.options.prebuild ?? true;
    const hasBuilder = ctx.cliPluginNames.includes(BUILDER_PLUGIN_NAME);

    if (prebuild && !hasBuilder) {
      ctx.exit(
        1,
        "Prebuild is on by default but dler is not registered on this CLI. Install it and ensure it matches plugins.allowedPatterns (or pass it via createCLI({ plugins: { explicit: [...] } })). Alternatively use --no-prebuild with --publish-from after building manually.",
      );
    }

    let publishFrom = ctx.options.publishFrom?.trim() ?? "";
    if (!prebuild) {
      if (publishFrom.length === 0) {
        ctx.exit(1, "With --no-prebuild you must pass --publish-from (e.g. dist) relative to each package.");
      }
    } else {
      publishFrom = publishFrom.length > 0 ? publishFrom : DEFAULT_PUBLISH_FROM;
    }

    if (!isSafeRelativePublishFrom(publishFrom)) {
      ctx.exit(1, "Invalid --publish-from: use a relative path without .. segments.");
    }

    const dryRun = Boolean(ctx.options.dryRun);
    const startedAt = performance.now();
    const resolution = await resolveDirectoryTargets(ctx.cwd, targetLabels);
    const validation = await resolvePublishableTargets({
      requireArtifactDir: !prebuild,
      publishFrom,
      targets: resolution.resolved,
    });
    const skipped: { label: string; reason: string }[] = [...resolution.skipped, ...validation.skipped];
    const results: {
      cwd: string;
      durationMs: number;
      label: string;
      npm: { exitCode: number; stderr: string; stdout: string };
      packageName: string;
    }[] = [];

    for (const target of validation.publishable) {
      const label = target.label;
      const packageRoot = target.cwd;
      const pkgRecord = target.packageRecord;

      const unsafeSpecifiers = findUnsafeDependencySpecifiers(pkgRecord);
      if (unsafeSpecifiers.length > 0) {
        skipped.push({
          label,
          reason: `unsafe dependency specifiers for publish: ${unsafeSpecifiers.map((dep) => `${dep.name}@${dep.specifier}`).join(", ")}`,
        });
        continue;
      }

      if (prebuild) {
        const report = await runPrebuildForPackage(packageRoot, label);
        if (!report.ok) {
          const failed = report.targets.find((t) => !t.ok);
          if (ctx.output.mode !== "json" && failed) {
            if (failed.stdout.trim()) ctx.out(failed.stdout.trim());
            if (failed.stderr.trim()) ctx.err(failed.stderr.trim());
          }

          ctx.exit(
            1,
            failed
              ? `Prebuild failed for ${label} (exit ${failed.exitCode}). Fix the build or use --no-prebuild.`
              : `Prebuild failed for ${label}.`,
          );
        }
      }

      if (!(await pathIsDirectory(target.artifactDir))) {
        skipped.push({
          label,
          reason: `missing publish directory: ${target.artifactDir}`,
        });
        continue;
      }

      const staging = await createPublishStaging(packageRoot, publishFrom);
      try {
        const publishStartedAt = performance.now();
        const npmResult = await runNpmPublish({
          cwd: staging.stagingDir,
          dryRun,
          env: ctx.env,
          tag: ctx.options.tag,
        });
        results.push({
          cwd: packageRoot,
          durationMs: Math.round(performance.now() - publishStartedAt),
          label,
          npm: npmResult,
          packageName: target.packageName,
        });

        if (npmResult.exitCode !== 0) {
          if (ctx.output.mode !== "json") {
            if (npmResult.stdout.trim()) ctx.out(npmResult.stdout.trim());
            if (npmResult.stderr.trim()) ctx.err(npmResult.stderr.trim());
          }

          ctx.exit(1, `npm publish failed for ${label} (exit ${npmResult.exitCode}).`);
        }
      } finally {
        await staging.cleanup();
      }
    }

    if (results.length === 0) {
      const summary = createPublishSummary({
        planned: resolution.resolved.length,
        published: 0,
        skipped,
      });
      const targetSets = createTargetSets({
        plannedTargets: validation.publishable,
        skippedTargets: skipped,
      });

      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            dryRun,
            executedTargets: targetSets.executedTargets,
            ok: false,
            plannedTargets: targetSets.plannedTargets,
            publishFrom,
            published: [],
            skipped,
            skippedTargets: targetSets.skippedTargets,
            summary,
          },
          "dler pub",
        );
        return;
      }

      for (const message of formatSkippedMessages(skipped)) {
        ctx.err(message.replace("Skipped:", warnLabel(ctx, "Skipped:")));
      }

      ctx.exit(1, "Nothing to publish.");
    }

    if (ctx.output.mode === "json") {
      const summary = createPublishSummary({
        planned: resolution.resolved.length,
        published: results.length,
        skipped,
      });
      const targetSets = createTargetSets({
        executedTargets: results.map((result) => ({
          cwd: result.cwd,
          exitCode: result.npm.exitCode,
          label: result.label,
          ok: result.npm.exitCode === 0,
        })),
        plannedTargets: validation.publishable,
        skippedTargets: skipped,
      });

      ctx.output.result(
        {
          dryRun,
          executedTargets: targetSets.executedTargets,
          ok: true,
          plannedTargets: targetSets.plannedTargets,
          publishFrom,
          published: results.map((r) => ({
            exitCode: r.npm.exitCode,
            label: r.label,
            packageName: r.packageName,
            durationMs: r.durationMs,
            stderr: r.npm.stderr,
            stdout: r.npm.stdout,
          })),
          skipped,
          skippedTargets: targetSets.skippedTargets,
          summary,
          totalDurationMs: Math.round(performance.now() - startedAt),
        },
        "dler pub",
      );
      return;
    }

    ctx.out(`Publish from: ${publishFrom}`);

    for (const message of formatSkippedMessages(skipped)) {
      ctx.err(message.replace("Skipped:", warnLabel(ctx, "Skipped:")));
    }

    for (const r of results) {
      ctx.out(okLabel(ctx, formatPublishResultLine({
        dryRun,
        durationMs: r.durationMs,
        label: r.label,
        packageName: r.packageName,
      })));
    }

    ctx.out(`Total duration: ${Math.round(performance.now() - startedAt)}ms`);
    ctx.out(formatPublishSummary(createPublishSummary({ planned: resolution.resolved.length, published: results.length, skipped }), dryRun));
  },
});
