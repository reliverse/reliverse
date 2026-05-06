import { defineCommand } from "@reliverse/rempts";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { mapWithConcurrency, resolveConcurrency } from "../../impl/concurrency";
import {
  DLER_COMMAND_NAMES,
  DLER_CONCURRENCY_DEFAULTS,
  DLER_PUBLISH_DEFAULTS,
} from "../../impl/constants";
import { runNpmPublish } from "../../impl/pub/npm-publish";
import { isSafeRelativePublishFrom } from "../../impl/pub/paths";
import { createPublishStaging } from "../../impl/pub/staging";
import { resolvePublishableTargets } from "../../impl/pub/validation";
import {
  findUnsafeDependencySpecifiers,
  normalizePublishDependencySpecifiers,
} from "../../impl/pub/workspace-deps";
import { createPublishExecutedTargets, createTargetSets } from "../../impl/report-helpers";
import { createPublishSummary, createPublishSummaryFromResults } from "../../impl/result-contract";
import { pathIsDirectory, resolveRequestedTargets } from "../../impl/shared-targets";

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

interface PublishTextResult {
  readonly durationMs: number;
  readonly label: string;
  readonly npm: { readonly stderr: string; readonly stdout: string };
  readonly packageName: string;
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

function formatNpmCommand(options: {
  readonly preview: boolean;
  readonly tag?: string | undefined;
}): string {
  const parts = ["npm", "publish", "--access", "public"];
  if (options.preview) {
    parts.push("--dry-run");
  }
  if (options.tag && options.tag.trim().length > 0) {
    parts.push("--tag", options.tag.trim());
  }

  return parts.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function findWorkspaceRoot(start: string): Promise<string> {
  let current = resolve(start);

  while (true) {
    try {
      const pkg = JSON.parse(await readFile(resolve(current, "package.json"), "utf8")) as Record<
        string,
        unknown
      >;
      if (isRecord(pkg.workspaces)) return current;
    } catch {
      // Keep walking up until filesystem root.
    }

    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

async function readPublishDependencyResolutionContext(options: {
  readonly cwd: string;
  readonly targets: readonly { readonly cwd: string }[];
}): Promise<{
  readonly catalog: ReadonlyMap<string, string>;
  readonly workspaceVersions: ReadonlyMap<string, string>;
}> {
  const workspaceRoot = await findWorkspaceRoot(options.cwd);
  const workspaceVersions = new Map<string, string>();
  const catalog = new Map<string, string>();
  const workspacePackageDirs = new Set<string>(options.targets.map((target) => target.cwd));

  try {
    const rootPackageJson = JSON.parse(
      await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    const workspaces = rootPackageJson.workspaces;
    const catalogRecord = isRecord(workspaces) && isRecord(workspaces.catalog)
      ? workspaces.catalog
      : undefined;

    if (catalogRecord) {
      for (const [name, version] of Object.entries(catalogRecord)) {
        if (typeof version === "string") catalog.set(name, version);
      }
    }

    const packagePatterns = isRecord(workspaces) && Array.isArray(workspaces.packages)
      ? workspaces.packages
      : [];
    for (const pattern of packagePatterns) {
      if (typeof pattern !== "string" || !pattern.endsWith("/*")) continue;

      const parentDir = resolve(workspaceRoot, pattern.slice(0, -2));
      try {
        const entries = await readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) workspacePackageDirs.add(resolve(parentDir, entry.name));
        }
      } catch {
        // Missing workspace pattern directories are handled by target discovery elsewhere.
      }
    }
  } catch {
    // Missing catalog context is non-fatal; unresolved catalog specifiers remain blocked later.
  }

  await Promise.all(
    [...workspacePackageDirs].map(async (packageDir) => {
      try {
        const pkg = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8")) as Record<
          string,
          unknown
        >;
        if (typeof pkg.name === "string" && typeof pkg.version === "string") {
          workspaceVersions.set(pkg.name, pkg.version);
        }
      } catch {
        // Target validation reports manifest issues later.
      }
    }),
  );

  return { catalog, workspaceVersions };
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a.localeCompare(b);

  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }

  return 0;
}

function nextPatchVersion(version: string): string | undefined {
  const parsed = parseVersion(version);
  if (!parsed) return undefined;

  return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`;
}

async function readNpmLatestVersion(packageName: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const processHandle = Bun.spawn(["npm", "view", packageName, "version", "--json"], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    processHandle.exited,
  ]);

  if (exitCode !== 0) return undefined;

  try {
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return stdout.trim().replace(/^"|"$/g, "") || undefined;
  }
}

async function resolvePublishVersions(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly latestTag: boolean;
  readonly targets: readonly { readonly packageName: string; readonly packageRecord: Record<string, unknown> }[];
}): Promise<ReadonlyMap<string, string>> {
  const versions = new Map<string, string>();

  await Promise.all(
    options.targets.map(async (target) => {
      const sourceVersion = typeof target.packageRecord.version === "string"
        ? target.packageRecord.version
        : undefined;
      if (!sourceVersion) return;

      if (!options.latestTag) {
        versions.set(target.packageName, sourceVersion);
        return;
      }

      const latestVersion = await readNpmLatestVersion(target.packageName, options.env);
      if (!latestVersion || compareVersions(sourceVersion, latestVersion) > 0) {
        versions.set(target.packageName, sourceVersion);
        return;
      }

      versions.set(target.packageName, nextPatchVersion(latestVersion) ?? sourceVersion);
    }),
  );

  return versions;
}

function pushNpmOutput(
  lines: string[],
  colors: PreviewColors,
  label: string,
  stream: "stdout" | "stderr",
  value: string,
): void {
  const text = value.trim();
  if (text.length === 0) {
    return;
  }

  lines.push(
    `  ${colors.bold(label)} ${colors.gray(`npm ${stream}:`)}`,
    ...text.split("\n").map((line) => `     ${colors.gray(line)}`),
  );
}

function formatPublishText(options: {
  readonly apply: boolean;
  readonly colors: PreviewColors;
  readonly concurrency: number;
  readonly publishFrom: string;
  readonly results: readonly PublishTextResult[];
  readonly skipped: readonly { readonly label: string; readonly reason: string }[];
  readonly tag?: string | undefined;
  readonly totalDurationMs: number;
  readonly verbose: boolean;
}): string[] {
  const action = options.apply ? "published" : "prepared";
  const title = options.apply ? DLER_COMMAND_NAMES.pub : `${DLER_COMMAND_NAMES.pub} preview`;
  const lines = [
    options.colors.bold(options.colors.cyan(title)),
    "",
    `${options.colors.bold("Publish from:")} ${options.colors.magenta(options.publishFrom)}`,
    `${options.colors.bold("Concurrency:")} ${options.colors.magenta(options.concurrency)}`,
  ];

  if (options.tag && options.tag.trim().length > 0) {
    lines.push(`${options.colors.bold("Tag:")} ${options.colors.magenta(options.tag.trim())}`);
  }

  lines.push(
    `${options.colors.bold("Targets:")} ${formatCount(options.colors, options.results.length, action, "green")}, ${formatCount(options.colors, options.skipped.length, "skipped", "yellow")}`,
  );

  if (options.results.length > 0) {
    lines.push(
      "",
      options.colors.bold(options.apply ? "Published" : "Prepared"),
      ...formatLabelRows(
        options.results.map((result) => ({
          detail: options.verbose
            ? `${result.packageName} (${result.durationMs}ms)`
            : result.packageName,
          label: result.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.skipped.length > 0) {
    lines.push(
      "",
      options.colors.bold(options.colors.yellow("Skipped")),
      ...formatLabelRows(
        options.skipped.map((target) => ({
          detail: target.reason,
          label: target.label,
        })),
        options.colors,
      ),
    );
  }

  if (options.verbose) {
    if (options.results.length > 0) {
      lines.push(
        "",
        options.colors.bold(options.colors.cyan("Command")),
        `  ${options.colors.gray(formatNpmCommand({ preview: !options.apply, tag: options.tag }))}`,
      );
    }

    lines.push(
      "",
      options.colors.bold(options.colors.cyan("Details")),
      `  Total duration: ${options.colors.bold(`${options.totalDurationMs}ms`)}`,
    );

    for (const result of options.results) {
      pushNpmOutput(lines, options.colors, result.label, "stdout", result.npm.stdout);
      pushNpmOutput(lines, options.colors, result.label, "stderr", result.npm.stderr);
    }
  }

  lines.push(
    "",
    options.apply
      ? `${options.colors.green("Publish complete.")} Use ${options.colors.bold("--json")} for the machine-readable result.`
      : `${options.colors.yellow("No packages published.")} Pass ${options.colors.bold("--apply")} to publish to npm.`,
    options.verbose
      ? `Use ${options.colors.bold("--json")} for the full machine-readable result.`
      : `Use ${options.colors.bold("--verbose")} or ${options.colors.bold("--json")} to inspect npm output and durations.`,
  );

  return lines;
}

export default defineCommand({
  meta: {
    name: "pub",
    description:
      "Publish selected workspace packages to npm using a staging directory that merges package metadata with prepared artifacts.",
  },
  agent: {
    notes:
      "Eligible packages: not private, type module, publishConfig.access public. Default execution prepares an npm publish preview from existing artifacts. Pass --apply for real npm publish. dler build is the recommended artifact producer, but any external build flow is valid if it prepares the selected --publish-from directory. v1 does not rewrite workspace/catalog specifiers — ensure versions are publishable. Requires npm CLI and registry auth for real publishes.",
  },
  interactive: "never",
  conventions: {
    idempotent: false,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["network.publish", "process.exec", "fs.write", "fs.delete"],
  },
  help: {
    examples: [
      "rse pub --targets packages/foo",
      "rse pub --targets packages/foo --publish-from dist",
      "rse pub --targets packages/foo --verbose",
      "rse pub --targets packages/foo --concurrency 2 --apply",
      "rse pub --targets packages/foo --publish-from dist --tag next --apply",
    ],
    text: "Targets come from --targets or from cwd scope when omitted. dler pub stages package.json plus the chosen artifact directory before npm publish. Use dler build when you want the recommended Reliverse build path, or provide artifacts from any other build flow via --publish-from.",
  },
  options: {
    publishFrom: {
      type: "string",
      defaultValue: DLER_PUBLISH_DEFAULTS.publishFrom,
      description: "Directory relative to each package root to copy into the publish tarball",
      inputSources: ["flag", "default"],
    },
    tag: {
      type: "string",
      description: "npm dist-tag (npm publish --tag)",
      inputSources: ["flag"],
    },
    targets: {
      type: "string",
      description:
        "Comma-separated workspace paths (relative to --cwd) to publish in order (defaults to cwd-derived scope when omitted)",
      hint: "Example: packages/rempts,plugins/pub",
      inputSources: ["flag"],
    },
    concurrency: {
      type: "number",
      defaultValue: DLER_CONCURRENCY_DEFAULTS.pub,
      description: "Maximum number of publish targets to process at once",
      inputSources: ["flag", "default"],
    },
    verbose: {
      type: "boolean",
      description: "Show verbose text output, including npm output and durations",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const concurrency = resolveConcurrency(ctx.options.concurrency, {
      defaultValue: DLER_CONCURRENCY_DEFAULTS.pub,
      label: "--concurrency",
    });
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
        "No publish targets resolved. Pass --targets path1,path2 or run from a workspace root/package directory.",
      );
    }

    const publishFrom = ctx.options.publishFrom?.trim() || DLER_PUBLISH_DEFAULTS.publishFrom;

    if (!isSafeRelativePublishFrom(publishFrom)) {
      ctx.exit(1, "Invalid --publish-from: use a relative path without .. segments.");
    }

    const apply = ctx.safety.apply;
    const preview = !apply;
    const startedAt = performance.now();
    const validation = await resolvePublishableTargets({
      requireArtifactDir: true,
      publishFrom,
      targets: requestedTargets.resolution.resolved,
    });
    const skipped: { label: string; reason: string }[] = [
      ...requestedTargets.resolution.skipped,
      ...validation.skipped,
    ];
    const dependencyResolutionContext = await readPublishDependencyResolutionContext({
      cwd: ctx.cwd,
      targets: requestedTargets.resolution.resolved,
    });
    const publishVersions = await resolvePublishVersions({
      env: ctx.env,
      latestTag: ctx.options.tag === "latest",
      targets: validation.publishable,
    });
    const workspaceVersions = new Map(dependencyResolutionContext.workspaceVersions);
    for (const [name, version] of publishVersions) {
      workspaceVersions.set(name, version);
    }

    type PublishResult = {
      cwd: string;
      durationMs: number;
      label: string;
      npm: { exitCode: number; stderr: string; stdout: string };
      packageName: string;
    };

    const outcomes = await mapWithConcurrency(
      validation.publishable,
      concurrency,
      async (target) => {
        const label = target.label;
        const packageRoot = target.cwd;
        const pkgRecord = normalizePublishDependencySpecifiers(
          {
            ...target.packageRecord,
            version: publishVersions.get(target.packageName) ?? target.packageRecord.version,
          },
          { ...dependencyResolutionContext, workspaceVersions },
        );

        const unsafeSpecifiers = findUnsafeDependencySpecifiers(pkgRecord);
        if (unsafeSpecifiers.length > 0) {
          return {
            skipped: {
              label,
              reason: `unsafe dependency specifiers for publish: ${unsafeSpecifiers.map((dep) => `${dep.name}@${dep.specifier}`).join(", ")}`,
            },
          };
        }

        if (!(await pathIsDirectory(target.artifactDir))) {
          return {
            skipped: {
              label,
              reason: `missing publish directory: ${target.artifactDir}`,
            },
          };
        }

        if (apply) {
          ctx.safety.assertApplied("fs.write");
        }
        const staging = await createPublishStaging(packageRoot, publishFrom, pkgRecord);
        try {
          const publishStartedAt = performance.now();
          if (apply) {
            ctx.safety.assertApplied("network.publish");
          }
          const npmResult = await runNpmPublish({
            cwd: staging.stagingDir,
            preview,
            env: ctx.env,
            tag: ctx.options.tag,
          });
          const result = {
            cwd: packageRoot,
            durationMs: Math.round(performance.now() - publishStartedAt),
            label,
            npm: npmResult,
            packageName: target.packageName,
          } satisfies PublishResult;

          if (npmResult.exitCode !== 0) {
            if (ctx.output.mode !== "json") {
              if (npmResult.stdout.trim()) ctx.out(npmResult.stdout.trim());
              if (npmResult.stderr.trim()) ctx.err(npmResult.stderr.trim());
            }

            ctx.exit(
              1,
              `npm publish failed for ${label} during staging publish (exit ${npmResult.exitCode}).`,
            );
          }

          return { result };
        } finally {
          await staging.cleanup();
        }
      },
    );

    const results = outcomes.flatMap((outcome) => ("result" in outcome ? [outcome.result] : []));
    skipped.push(...outcomes.flatMap((outcome) => ("skipped" in outcome ? [outcome.skipped] : [])));

    if (results.length === 0) {
      const summary = createPublishSummary({
        planned: requestedTargets.resolution.resolved.length,
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
            apply,
            concurrency,
            preview,
            executedTargets: targetSets.executedTargets,
            ok: false,
            plannedTargets: targetSets.plannedTargets,
            publishFrom,
            published: [],
            skipped,
            skippedTargets: targetSets.skippedTargets,
            summary,
          },
          DLER_COMMAND_NAMES.pub,
        );
        return;
      }

      const totalDurationMs = Math.round(performance.now() - startedAt);
      for (const line of formatPublishText({
        apply,
        colors: ctx.colors.stdout,
        concurrency,
        publishFrom,
        results,
        skipped,
        tag: ctx.options.tag,
        totalDurationMs,
        verbose: ctx.options.verbose === true,
      })) {
        ctx.out(line);
      }

      ctx.exit(1, "No publishable workspace targets remain after validation and artifact checks.");
    }

    if (ctx.output.mode === "json") {
      const summary = createPublishSummaryFromResults({
        planned: requestedTargets.resolution.resolved.length,
        resultsCount: results.length,
        skipped,
      });
      const targetSets = createTargetSets({
        executedTargets: createPublishExecutedTargets(results),
        plannedTargets: validation.publishable,
        skippedTargets: skipped,
      });

      ctx.output.result(
        {
          apply,
          concurrency,
          preview,
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
        DLER_COMMAND_NAMES.pub,
      );
      return;
    }

    const totalDurationMs = Math.round(performance.now() - startedAt);
    for (const line of formatPublishText({
      apply,
      colors: ctx.colors.stdout,
      concurrency,
      publishFrom,
      results,
      skipped,
      tag: ctx.options.tag,
      totalDurationMs,
      verbose: ctx.options.verbose === true,
    })) {
      ctx.out(line);
    }
  },
});
