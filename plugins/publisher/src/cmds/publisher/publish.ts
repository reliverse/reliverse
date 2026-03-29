import { access, constants, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { defineCommand } from "@reliverse/rempts";

import { getIneligibilityReason } from "../../lib/eligibility";
import { runNpmPublish } from "../../lib/npm-publish";
import { isSafeRelativePublishFrom } from "../../lib/paths";
import { runPrebuildForPackage } from "../../lib/prebuild";
import { createPublishStaging } from "../../lib/staging";
import { parseTargetsOption } from "../../targets";

const BUILDER_PLUGIN_ID = "builder-rse-plugin";
const DEFAULT_PUBLISH_FROM = "dist";

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export default defineCommand({
  description:
    "Publish selected workspace packages to npm using a staging directory (merged files + build output). Prebuild uses the builder plugin when it is registered on the CLI.",
  agent: {
    notes:
      "Eligible packages: not private, type module, publishConfig.access public. v1 does not rewrite workspace/catalog specifiers — ensure versions are publishable. Requires npm CLI and registry auth for real publishes.",
  },
  conventions: {
    idempotent: false,
    supportsDryRun: true,
  },
  examples: [
    "rse publisher publish --targets packages/foo --dry-run",
    "rse publisher publish --targets packages/foo --no-prebuild --publish-from dist --dry-run",
    "rse publisher publish --targets packages/foo --publish-from dist --tag next --dry-run",
  ],
  help:
    "With default prebuild, the builder-rse-plugin must be loaded by the CLI. Otherwise pass --no-prebuild and --publish-from (relative to each package root). Staging always includes package.json and the publish-from directory; existing package.json `files` entries are merged in.",
  name: "publish",
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
        "Run bun run build before publish when builder-rse-plugin is registered (use --no-prebuild to skip)",
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
      hint: "Example: packages/rempts,plugins/publisher",
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
    const hasBuilder = ctx.cliPluginIds.includes(BUILDER_PLUGIN_ID);

    if (prebuild && !hasBuilder) {
      ctx.exit(
        1,
        "Prebuild is on by default but builder-rse-plugin is not registered on this CLI. Add it to createCLI({ plugins }) or use --no-prebuild with --publish-from after building manually.",
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
    const skipped: { label: string; reason: string }[] = [];
    const results: {
      label: string;
      npm: { exitCode: number; stderr: string; stdout: string };
    }[] = [];

    for (const label of targetLabels) {
      const packageRoot = resolve(ctx.cwd, label);

      if (!(await pathIsDirectory(packageRoot))) {
        skipped.push({ label, reason: `not a directory: ${packageRoot}` });
        continue;
      }

      const manifestPath = resolve(packageRoot, "package.json");
      if (!(await fileExists(manifestPath))) {
        skipped.push({ label, reason: "missing package.json" });
        continue;
      }

      let pkgRecord: Record<string, unknown>;
      try {
        const raw = await readFile(manifestPath, "utf8");
        pkgRecord = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        skipped.push({ label, reason: "invalid package.json" });
        continue;
      }

      const ineligible = getIneligibilityReason(pkgRecord);
      if (ineligible) {
        skipped.push({ label, reason: ineligible });
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

      const artifactDir = resolve(packageRoot, publishFrom);
      if (!(await pathIsDirectory(artifactDir))) {
        ctx.exit(
          1,
          `Missing publish directory for ${label}: ${artifactDir} (after ${prebuild ? "prebuild" : "your build"}).`,
        );
      }

      const staging = await createPublishStaging(packageRoot, publishFrom);
      try {
        const npmResult = await runNpmPublish({
          cwd: staging.stagingDir,
          dryRun,
          env: ctx.env,
          tag: ctx.options.tag,
        });
        results.push({ label, npm: npmResult });

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
      if (ctx.output.mode === "json") {
        ctx.output.result({ dryRun, ok: false, published: [], publishFrom, skipped }, "publisher publish");
        return;
      }

      for (const item of skipped) {
        ctx.err(`Skipped ${item.label}: ${item.reason}`);
      }

      ctx.exit(1, "Nothing to publish.");
    }

    if (ctx.output.mode === "json") {
      ctx.output.result(
        {
          dryRun,
          ok: true,
          publishFrom,
          published: results.map((r) => ({
            exitCode: r.npm.exitCode,
            label: r.label,
            stderr: r.npm.stderr,
            stdout: r.npm.stdout,
          })),
          skipped,
        },
        "publisher publish",
      );
      return;
    }

    for (const item of skipped) {
      ctx.err(`Skipped ${item.label}: ${item.reason}`);
    }

    for (const r of results) {
      ctx.out(`${dryRun ? "Dry run" : "Published"}: ${r.label}`);
    }
  },
});
