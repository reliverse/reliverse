import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

import {
  assertSupportedBunLockfileProject,
  canRewriteSpecifier,
  cloneManifest,
  collectSnapshots,
  createUpdatedSpecifier,
  type DependencySection,
  findCatalogEntry,
  findDependencyLocation,
  getBunLockfilePath,
  isCatalogProtocol,
  isWorkspaceProtocol,
  listManifestTargets,
  listTargetDependencies,
  parseCatalogProtocol,
  parsePackageInput,
  type PackageInput,
  type ManifestTarget,
  type SafeVersionDecision,
  resolveSafeLatestVersion,
  resolveUpdateVersion,
  resolveTargetContext,
  restoreSnapshots,
  runBunInstall,
  setCatalogEntry,
  setDependency,
  writeManifest,
} from "../../lib";

interface UpdateAction {
  readonly action: "missing" | "noop" | "skipped" | "updated";
  readonly catalogName?: string | undefined;
  readonly nextSpecifier?: string | undefined;
  readonly packageName: string;
  readonly previousSpecifier?: string | undefined;
  readonly reason?: string | undefined;
  readonly resolutionStrategy?: string | undefined;
  readonly safeDecision?: SafeVersionDecision | undefined;
  readonly section?: string | undefined;
  readonly source: "catalog" | "target";
  readonly targetLabel?: string | undefined;
}

interface PendingUpdate {
  readonly catalogName?: string | undefined;
  readonly currentSpecifier: string;
  readonly packageName: string;
  readonly section?: DependencySection | undefined;
  readonly source: "catalog" | "target";
  readonly targetLabel?: string | undefined;
  readonly targetManifestPath?: string | undefined;
}

function parseDurationDays(input: unknown, defaultDays: number): number {
  if (input === undefined || input === null || input === "") {
    return defaultDays;
  }

  const value = String(input).trim();
  const match = /^(?<amount>\d+)(?<unit>d|day|days)?$/i.exec(value);

  if (!match?.groups?.amount) {
    throw new Error(`Invalid --age value "${value}". Use a day value like 7d.`);
  }

  return Number(match.groups.amount);
}

function parseListOption(value: unknown): readonly string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function describeStrategy(options: { readonly latest: boolean; readonly smart: boolean }): {
  label: string;
  text: string;
} {
  if (options.smart && options.latest) {
    return {
      label: "smart-latest-stable",
      text: "newest stable overall (smart)",
    };
  }

  if (options.smart && !options.latest) {
    return {
      label: "smart-range",
      text: "current semver/prerelease line (smart)",
    };
  }

  if (!options.smart && options.latest) {
    return {
      label: "latest",
      text: "dist-tags.latest",
    };
  }

  return {
    label: "range",
    text: "current semver range",
  };
}

function formatActionTarget(action: UpdateAction, fallbackLabel: string): string {
  const location = action.targetLabel ?? fallbackLabel;

  if (action.source === "catalog") {
    return action.catalogName
      ? `${location} (catalog:${action.catalogName})`
      : `${location} (catalog)`;
  }

  return action.section ? `${location} (${action.section})` : location;
}

function buildInstallCommand(): string {
  return "bun install";
}

function createActionSummary(actions: readonly UpdateAction[]) {
  return {
    missing: actions.filter((action) => action.action === "missing").length,
    noop: actions.filter((action) => action.action === "noop").length,
    skipped: actions.filter((action) => action.action === "skipped").length,
    updated: actions.filter((action) => action.action === "updated").length,
  };
}

function groupUpdatedActions(actions: readonly UpdateAction[], fallbackLabel: string) {
  const grouped = new Map<string, UpdateAction[]>();

  for (const action of actions) {
    if (action.action !== "updated") {
      continue;
    }

    const key = formatActionTarget(action, fallbackLabel);
    const bucket = grouped.get(key);

    if (bucket) {
      bucket.push(action);
      continue;
    }

    grouped.set(key, [action]);
  }

  return grouped;
}

function groupNoteActions(actions: readonly UpdateAction[]) {
  const grouped = new Map<string, { count: number; action: UpdateAction["action"] }>();

  for (const action of actions) {
    if (action.action !== "skipped" && action.action !== "missing") {
      continue;
    }

    const reason = action.reason ?? "no reason provided";
    const key = `${action.action}:${reason}`;
    const existing = grouped.get(key);

    grouped.set(key, {
      action: action.action,
      count: (existing?.count ?? 0) + 1,
    });
  }

  return [...grouped.entries()].map(([key, value]) => ({
    ...value,
    reason: key.slice(key.indexOf(":") + 1),
  }));
}

function emitUpdateNotes(
  ctx: {
    colors: {
      stdout: {
        bold(text: string): string;
        magenta(text: string): string;
        yellow(text: string): string;
      };
    };
    out(...values: unknown[]): void;
  },
  options: {
    readonly actions: readonly UpdateAction[];
    readonly fallbackLabel: string;
    readonly verbose: boolean;
  },
): void {
  const noteActions = options.actions.filter(
    (action) => action.action === "skipped" || action.action === "missing",
  );

  if (noteActions.length === 0) {
    return;
  }

  ctx.out(warnLabel(ctx, options.verbose ? "Notes:" : "Notes summary:"));

  if (!options.verbose) {
    for (const note of groupNoteActions(noteActions)) {
      ctx.out(`${ctx.colors.stdout.magenta("-")} ${note.count} ${note.action}: ${note.reason}`);
    }
    ctx.out(
      `  Use ${ctx.colors.stdout.bold("--verbose")} to show every skipped/missing dependency.`,
    );
    return;
  }

  for (const action of noteActions) {
    ctx.out(
      `${ctx.colors.stdout.magenta("-")} ${formatActionTarget(action, options.fallbackLabel)} :: ${ctx.colors.stdout.bold(action.packageName)} :: ${action.reason}`,
    );
  }
}

function emitSafeLatestDecisions(
  ctx: {
    colors: {
      stdout: {
        bold(text: string): string;
        green(text: string): string;
        magenta(text: string): string;
        yellow(text: string): string;
      };
    };
    out(...values: unknown[]): void;
  },
  options: {
    readonly actions: readonly UpdateAction[];
    readonly enabled: boolean;
    readonly explain: boolean;
  },
): void {
  if (!options.enabled) {
    return;
  }

  const decisions = options.actions
    .map((action) => action.safeDecision)
    .filter((decision): decision is SafeVersionDecision => decision !== undefined);

  if (decisions.length === 0) {
    return;
  }

  ctx.out(warnLabel(ctx, options.explain ? "Safe-latest decisions:" : "Safe-latest summary:"));

  for (const decision of decisions) {
    const selected = decision.selected
      ? ctx.colors.stdout.green(decision.selected)
      : ctx.colors.stdout.yellow("none");
    ctx.out(
      `${ctx.colors.stdout.magenta("-")} ${ctx.colors.stdout.bold(decision.packageName)}: npm latest ${decision.npmLatest}, selected ${selected}`,
    );

    if (!options.explain) {
      continue;
    }

    for (const skipped of decision.skipped.slice(0, 5)) {
      ctx.out(`  skipped ${skipped.version}: ${skipped.reasons.join(", ")}`);
    }

    if (decision.accepted) {
      ctx.out(`  accepted ${decision.accepted.version}: ${decision.accepted.reasons.join(", ")}`);
    }
  }

  if (!options.explain) {
    ctx.out(`  Use ${ctx.colors.stdout.bold("--explain")} to show skipped candidate reasons.`);
  }
}

function infoLabel(
  ctx: {
    colors: {
      stdout: { bold(text: string): string; cyan(text: string): string };
    };
  },
  text: string,
): string {
  return ctx.colors.stdout.cyan(ctx.colors.stdout.bold(text));
}

function okLabel(
  ctx: {
    colors: {
      stdout: { bold(text: string): string; green(text: string): string };
    };
  },
  text: string,
): string {
  return ctx.colors.stdout.green(ctx.colors.stdout.bold(text));
}

function warnLabel(
  ctx: {
    colors: {
      stdout: { bold(text: string): string; yellow(text: string): string };
    };
  },
  text: string,
): string {
  return ctx.colors.stdout.yellow(ctx.colors.stdout.bold(text));
}

export default defineCommand({
  meta: {
    name: "update",
    description:
      "Update dependency versions in a repo or workspace package with Bun-aware package.json changes",
  },
  agent: {
    notes:
      "Pass package names to update a focused subset, or omit args to update all direct dependencies of the target package. By default the command updates to the newest stable version and uses smart behavior for prereleases. With `latest=true` (default), smart picks the newest stable overall. With `latest=false`, smart prefers the current prerelease release line and promotes to matching stable when it appears. Pass `--no-smart` to disable this behavior. When the target is a monorepo root, workspace manifests are swept recursively by default; pass `--no-recursive` to stay on the root manifest only.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsApply: true,
  },
  safety: {
    defaultMode: "preview",
    requiresApply: true,
    effects: ["fs.write", "package.install"],
  },
  help: {
    examples: [
      "rse update --cwd .",
      "rse update typescript @types/bun --target packages/rempts",
      "rse update --target apps/rse --json",
      "rse update zod --target packages/rempts --apply --json",
      "rse update --target . --apply --json",
      "rse update --target . --no-recursive --json",
      "rse update typescript --json",
      "rse update typescript --no-latest --json",
      "rse update vite --no-smart --json",
      "rse update react --safe-latest --age 7d --explain",
      "rse update --cwd /path/to/project --target /path/to/project --apply --json",
      "rse update --apply",
    ],
    text: "By default this command previews updates to the newest stable version. Smart mode is enabled by default: with `latest=true` it selects the newest stable overall, and with `latest=false` it follows the current prerelease release line and promotes to matching stable when available. Pass `--safe-latest` to select the newest stable version that passes Rse's npm metadata policy: release age, deprecated package, and install-script gates. Pass `--no-smart` to disable smart version selection. Pass `--no-latest` to stay within the current semver range. When the target is a monorepo root, workspace manifests are swept recursively by default; use `--no-recursive` to limit the run to the root manifest. Pass `--apply` to write pm-controlled manifest/catalog changes and then run `bun install`. Preview output shows grouped specifier diffs and the final install command that would run. Catalog-backed dependencies are updated through the Bun catalog in the repo root.",
  },
  options: {
    autoinstall: {
      type: "boolean",
      defaultValue: true,
      description:
        "Run bun install after applying manifest/catalog changes; pass --no-autoinstall to skip",
      inputSources: ["flag", "default"],
    },
    cwd: {
      type: "string",
      defaultValue: ".",
      description: "Base directory used to resolve the repo and target package",
      inputSources: ["flag", "default"],
    },
    latest: {
      type: "boolean",
      description:
        "Enabled by default; pass --no-latest to stay within the current semver range instead of jumping to the newest published version",
      inputSources: ["flag"],
    },
    safeLatest: {
      type: "boolean",
      description:
        "Select the newest stable version that passes Rse's safe-latest npm metadata policy",
      inputSources: ["flag"],
    },
    age: {
      type: "string",
      defaultValue: "7d",
      description: "Minimum package release age for --safe-latest, for example 7d",
      inputSources: ["flag", "default"],
    },
    freshScope: {
      type: "string",
      defaultValue: "@reliverse/*",
      description:
        "Comma-separated package names/scopes allowed to bypass the --safe-latest age gate",
      inputSources: ["flag", "default"],
    },
    maxFallbackDepth: {
      type: "number",
      defaultValue: 20,
      description: "Maximum older stable versions checked by --safe-latest",
      inputSources: ["flag", "default"],
    },
    explain: {
      type: "boolean",
      description: "Show per-package safe-latest decision details in text output",
      inputSources: ["flag"],
    },
    recursive: {
      type: "boolean",
      description:
        "Enabled by default for monorepo root targets; pass --no-recursive to limit the update to the root manifest only",
      inputSources: ["flag"],
    },
    smart: {
      type: "boolean",
      description:
        "Enabled by default; with latest=true pick newest stable overall, with latest=false prefer current prerelease branch and promote to matching stable",
      inputSources: ["flag"],
    },
    verbose: {
      type: "boolean",
      description: "Show every skipped or missing dependency note",
      inputSources: ["flag"],
    },
    target: {
      type: "string",
      description: "Workspace path or package name to update relative to --cwd",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const requestedInputs: PackageInput[] = (ctx.args as string[]).map(parsePackageInput);

    for (const input of requestedInputs) {
      if (input.requestedSpecifier) {
        ctx.exit(
          1,
          `Explicit version specifiers are not supported in \`pm update\` (${input.name}@${input.requestedSpecifier}). Pass only package names.`,
        );
      }
    }

    const requestedPackages = [...new Set(requestedInputs.map((input) => input.name))];
    const context = await resolveTargetContext({
      cwd: ctx.options.cwd,
      target: ctx.options.target,
    });
    await assertSupportedBunLockfileProject(context.installCwd);

    const safeLatest = ctx.options.safeLatest === true;
    const safeLatestAgeDays = parseDurationDays(ctx.options.age, 7);
    const safeLatestFreshScopes = parseListOption(ctx.options.freshScope);

    if (safeLatest && ctx.options.latest === false) {
      ctx.exit(
        1,
        "Choose either --safe-latest or --no-latest; safe-latest is a latest-mode resolver.",
      );
    }

    const smartByDefault = ctx.options.smart !== false;
    const latestByDefault = ctx.options.latest !== false;
    const executionRequested = ctx.safety.apply;
    const apply = executionRequested;
    const preview = !apply;
    const autoinstall = ctx.options.autoinstall !== false;
    const verbose = ctx.options.verbose === true;
    const strategy = safeLatest
      ? {
          label: "safe-latest",
          text: "newest stable version passing Rse safe-latest policy",
        }
      : describeStrategy({
          latest: latestByDefault,
          smart: smartByDefault,
        });
    const recursiveByDefault = context.usesWorkspaces && context.targetDir === context.repoRootDir;
    const updateAllWorkspaceManifests = recursiveByDefault && ctx.options.recursive !== false;
    const manifestTargets: readonly ManifestTarget[] = await listManifestTargets(context, {
      includeWorkspacePackages: updateAllWorkspaceManifests,
    });
    const nextManifests = new Map(
      manifestTargets.map((target) => [target.manifestPath, cloneManifest(target.manifest)]),
    );
    let nextRootManifest = cloneManifest(context.repoRootManifest);
    const processedCatalogKeys = new Set<string>();
    const foundRequestedPackages = new Set<string>();
    const targetPackages =
      requestedPackages.length > 0
        ? requestedPackages
        : manifestTargets.flatMap((target) => listTargetDependencies(target.manifest));
    const installCommand = buildInstallCommand();

    if (targetPackages.length === 0) {
      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            actions: [],
            apply,
            preview,
            install: {
              command: installCommand,
              cwd: context.installCwd,
              executed: false,
            },
            latest: latestByDefault,
            recursive: updateAllWorkspaceManifests,
            smart: smartByDefault,
            strategy,
            summary: createActionSummary([]),
            target: {
              cwd: context.targetDir,
              label: context.targetLabel,
              manifestPath: context.targetManifestPath,
            },
          },
          "pm update",
        );
        return;
      }

      ctx.out(`${warnLabel(ctx, "No direct dependencies:")} ${context.targetLabel}.`);
      return;
    }

    const actions: UpdateAction[] = [];
    const pendingUpdates: PendingUpdate[] = [];

    for (const manifestTarget of manifestTargets) {
      const nextTargetManifest = nextManifests.get(manifestTarget.manifestPath);

      if (!nextTargetManifest) {
        continue;
      }

      const manifestPackages =
        requestedPackages.length > 0
          ? requestedPackages
          : [...listTargetDependencies(nextTargetManifest)];

      for (const packageName of manifestPackages) {
        const targetLocation = findDependencyLocation(nextTargetManifest, packageName);

        if (targetLocation) {
          foundRequestedPackages.add(packageName);
        }

        if (!targetLocation && requestedPackages.length > 0) {
          const catalogEntry = findCatalogEntry(nextRootManifest, packageName);

          if (!catalogEntry) {
            continue;
          }

          const catalogKey = `${catalogEntry.catalogName ?? "<default>"}::${packageName}`;

          if (processedCatalogKeys.has(catalogKey)) {
            continue;
          }

          processedCatalogKeys.add(catalogKey);
          foundRequestedPackages.add(packageName);

          pendingUpdates.push({
            catalogName: catalogEntry.catalogName,
            currentSpecifier: catalogEntry.specifier,
            packageName,
            source: "catalog",
            targetLabel: manifestTarget.label,
          });
          continue;
        }

        if (!targetLocation) {
          continue;
        }

        if (isWorkspaceProtocol(targetLocation.specifier)) {
          actions.push({
            action: "skipped",
            packageName,
            previousSpecifier: targetLocation.specifier,
            reason: "workspace dependencies are managed separately",
            resolutionStrategy: strategy.label,
            section: targetLocation.section,
            source: "target",
            targetLabel: manifestTarget.label,
          });
          continue;
        }

        if (isCatalogProtocol(targetLocation.specifier)) {
          const catalogName = parseCatalogProtocol(targetLocation.specifier) ?? undefined;
          const catalogEntry = findCatalogEntry(nextRootManifest, packageName, catalogName);

          if (!catalogEntry) {
            actions.push({
              action: "missing",
              catalogName,
              packageName,
              previousSpecifier: targetLocation.specifier,
              reason: "catalog entry is missing from the repo root",
              resolutionStrategy: strategy.label,
              section: targetLocation.section,
              source: "catalog",
              targetLabel: manifestTarget.label,
            });
            continue;
          }

          const catalogKey = `${catalogName ?? "<default>"}::${packageName}`;

          if (processedCatalogKeys.has(catalogKey)) {
            continue;
          }

          processedCatalogKeys.add(catalogKey);
          foundRequestedPackages.add(packageName);

          pendingUpdates.push({
            catalogName,
            currentSpecifier: catalogEntry.specifier,
            packageName,
            section: targetLocation.section,
            source: "catalog",
            targetLabel: manifestTarget.label,
          });
          continue;
        }

        pendingUpdates.push({
          currentSpecifier: targetLocation.specifier,
          packageName,
          section: targetLocation.section,
          source: "target",
          targetLabel: manifestTarget.label,
          targetManifestPath: manifestTarget.manifestPath,
        });
      }
    }

    const resolvedUpdates = await pMap(
      pendingUpdates,
      async (update) => {
        const resolution = safeLatest
          ? await resolveSafeLatestVersion({
              currentSpecifier: update.currentSpecifier,
              refresh: executionRequested,
              packageName: update.packageName,
              policy: {
                allowFreshScopes: safeLatestFreshScopes,
                maxFallbackDepth: Number(ctx.options.maxFallbackDepth ?? 20),
                minimumReleaseAgeDays: safeLatestAgeDays,
              },
            })
          : {
              decision: undefined,
              version: await resolveUpdateVersion({
                currentSpecifier: update.currentSpecifier,
                refresh: executionRequested,
                latest: latestByDefault,
                packageName: update.packageName,
                smart: smartByDefault,
              }),
            };
        const nextVersion = resolution.version;
        const nextSpecifier = createUpdatedSpecifier({
          currentSpecifier: update.currentSpecifier,
          version: nextVersion,
        });
        return {
          ...update,
          nextSpecifier,
          resolutionStrategy: strategy.label,
          safeDecision: resolution.decision,
        };
      },
      { concurrency: 8 },
    );

    for (const update of resolvedUpdates) {
      if (update.source === "catalog") {
        if (update.nextSpecifier === update.currentSpecifier) {
          actions.push({
            action: "noop",
            catalogName: update.catalogName,
            packageName: update.packageName,
            previousSpecifier: update.currentSpecifier,
            reason: canRewriteSpecifier(update.currentSpecifier)
              ? "catalog entry is already up to date"
              : "catalog entry uses a non-rewritable specifier; Bun install will refresh lockfile metadata",
            resolutionStrategy: update.resolutionStrategy,
            safeDecision: update.safeDecision,
            section: update.section,
            source: "catalog",
            targetLabel: update.targetLabel,
          });
          continue;
        }

        nextRootManifest = setCatalogEntry(
          nextRootManifest,
          update.packageName,
          update.nextSpecifier,
          update.catalogName,
        );
        actions.push({
          action: "updated",
          catalogName: update.catalogName,
          nextSpecifier: update.nextSpecifier,
          packageName: update.packageName,
          previousSpecifier: update.currentSpecifier,
          reason: "updated repo catalog entry",
          resolutionStrategy: update.resolutionStrategy,
          safeDecision: update.safeDecision,
          section: update.section,
          source: "catalog",
          targetLabel: update.targetLabel,
        });
        continue;
      }

      if (!update.targetManifestPath || !update.section) {
        continue;
      }

      const nextTargetManifest = nextManifests.get(update.targetManifestPath);
      if (!nextTargetManifest) {
        continue;
      }

      if (update.nextSpecifier === update.currentSpecifier) {
        actions.push({
          action: "noop",
          packageName: update.packageName,
          previousSpecifier: update.currentSpecifier,
          reason: canRewriteSpecifier(update.currentSpecifier)
            ? "already up to date"
            : "specifier is not rewritten; Bun install will refresh lockfile metadata",
          resolutionStrategy: update.resolutionStrategy,
          safeDecision: update.safeDecision,
          section: update.section,
          source: "target",
          targetLabel: update.targetLabel,
        });
        continue;
      }

      const updatedManifest = setDependency(
        nextTargetManifest,
        update.section,
        update.packageName,
        update.nextSpecifier,
      );
      nextManifests.set(update.targetManifestPath, updatedManifest);
      actions.push({
        action: "updated",
        nextSpecifier: update.nextSpecifier,
        packageName: update.packageName,
        previousSpecifier: update.currentSpecifier,
        resolutionStrategy: update.resolutionStrategy,
        safeDecision: update.safeDecision,
        section: update.section,
        source: "target",
        targetLabel: update.targetLabel,
      });
    }

    const missingRequestedPackages = requestedPackages.filter(
      (packageName) => !foundRequestedPackages.has(packageName),
    );

    if (missingRequestedPackages.length > 0) {
      ctx.exit(
        1,
        `Some requested packages were not found for ${context.targetLabel}: ${missingRequestedPackages.join(", ")}.`,
      );
    }

    const changedManifestTargets = manifestTargets.filter((target) => {
      const nextManifest = nextManifests.get(target.manifestPath);

      return (
        nextManifest !== undefined &&
        JSON.stringify(nextManifest) !== JSON.stringify(target.manifest)
      );
    });
    const rootChanged =
      JSON.stringify(nextRootManifest) !== JSON.stringify(context.repoRootManifest);
    const summary = createActionSummary(actions);
    const resultPayload = {
      actions,
      apply,
      preview,
      install: {
        command: installCommand,
        cwd: context.installCwd,
        enabled: autoinstall,
        executed: false,
      },
      latest: latestByDefault,
      safeLatest,
      safeLatestPolicy: safeLatest
        ? {
            allowFreshScopes: safeLatestFreshScopes,
            maxFallbackDepth: Number(ctx.options.maxFallbackDepth ?? 20),
            minimumReleaseAgeDays: safeLatestAgeDays,
          }
        : undefined,
      recursive: updateAllWorkspaceManifests,
      smart: smartByDefault,
      strategy,
      summary,
      targets: changedManifestTargets.map((target) => ({
        cwd: target.dir,
        label: target.label,
        manifestPath: target.manifestPath,
      })),
      target: {
        cwd: context.targetDir,
        label: context.targetLabel,
        manifestPath: context.targetManifestPath,
      },
    };

    if (changedManifestTargets.length === 0 && !rootChanged) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm update");
        return;
      }

      ctx.out(`${warnLabel(ctx, "No dependency updates:")} ${context.targetLabel}.`);
      ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
      emitSafeLatestDecisions(ctx, {
        actions,
        enabled: safeLatest,
        explain: ctx.options.explain === true,
      });
      ctx.out(`${infoLabel(ctx, "Install step:")} ${installCommand} (not needed).`);
      return;
    }

    if (preview) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm update");
        return;
      }

      ctx.out(infoLabel(ctx, "pm update preview"));
      ctx.out(`${infoLabel(ctx, "Target:")} ${context.targetLabel}`);
      ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
      ctx.out(
        `${infoLabel(ctx, "Summary:")} ${summary.updated} update(s), ${summary.noop} unchanged, ${summary.skipped} skipped, ${summary.missing} missing.`,
      );

      const grouped = groupUpdatedActions(actions, context.targetLabel);

      if (grouped.size > 0) {
        ctx.out(infoLabel(ctx, "Planned specifier changes:"));

        for (const [targetLabel, targetActions] of grouped) {
          ctx.out(`${ctx.colors.stdout.magenta("-")} ${ctx.colors.stdout.bold(targetLabel)}`);

          for (const action of targetActions) {
            ctx.out(
              `  ${ctx.colors.stdout.bold(action.packageName)}: ${action.previousSpecifier} -> ${ctx.colors.stdout.green(action.nextSpecifier ?? "")}`,
            );
          }
        }
      }

      emitUpdateNotes(ctx, {
        actions,
        fallbackLabel: context.targetLabel,
        verbose,
      });
      emitSafeLatestDecisions(ctx, {
        actions,
        enabled: safeLatest,
        explain: ctx.options.explain === true,
      });

      ctx.out(
        `${infoLabel(ctx, "Install step:")} ${autoinstall ? `${installCommand} (after --apply)` : "disabled (--no-autoinstall)"}`,
      );
      if (autoinstall) {
        ctx.out(`${infoLabel(ctx, "Install cwd:")} ${ctx.colors.stdout.bold(context.installCwd)}`);
      }
      return;
    }

    ctx.safety.assertApplied("fs.write");

    const snapshotPaths = [
      ...new Set([
        ...changedManifestTargets.map((target) => target.manifestPath),
        getBunLockfilePath(context.installCwd),
        ...(rootChanged ? [context.repoRootManifestPath] : []),
      ]),
    ];
    const snapshots = await collectSnapshots(snapshotPaths);

    for (const target of changedManifestTargets) {
      const nextManifest = nextManifests.get(target.manifestPath);

      if (!nextManifest) {
        continue;
      }

      await writeManifest(target.manifestPath, nextManifest);
    }

    if (rootChanged) {
      await writeManifest(context.repoRootManifestPath, nextRootManifest);
    }

    const installResult = autoinstall ? await runBunInstall(context.installCwd) : null;

    if (installResult && !installResult.ok) {
      await restoreSnapshots(snapshots);

      if (installResult.stderr.trim().length > 0 && ctx.output.mode !== "json") {
        ctx.err(installResult.stderr.trim());
      }

      ctx.exit(
        1,
        `bun install failed after updating ${context.targetLabel}. Changes were reverted.`,
      );
    }

    const successPayload = {
      ...resultPayload,
      install: installResult
        ? {
            ...installResult,
            enabled: true,
            executed: true,
          }
        : {
            command: installCommand,
            cwd: context.installCwd,
            enabled: false,
            executed: false,
          },
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(successPayload, "pm update");
      return;
    }

    ctx.out(okLabel(ctx, "pm update"));
    ctx.out(`${infoLabel(ctx, "Target:")} ${context.targetLabel}`);
    ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
    ctx.out(
      `${infoLabel(ctx, "Summary:")} ${summary.updated} update(s), ${summary.noop} unchanged, ${summary.skipped} skipped, ${summary.missing} missing.`,
    );

    const grouped = groupUpdatedActions(actions, context.targetLabel);

    for (const [targetLabel, targetActions] of grouped) {
      ctx.out(`${ctx.colors.stdout.magenta("-")} ${ctx.colors.stdout.bold(targetLabel)}`);

      for (const action of targetActions) {
        ctx.out(
          `  ${ctx.colors.stdout.bold(action.packageName)}: ${action.previousSpecifier} -> ${ctx.colors.stdout.green(action.nextSpecifier ?? "")}`,
        );
      }
    }

    emitUpdateNotes(ctx, {
      actions,
      fallbackLabel: context.targetLabel,
      verbose,
    });
    emitSafeLatestDecisions(ctx, {
      actions,
      enabled: safeLatest,
      explain: ctx.options.explain === true,
    });

    if (installResult) {
      ctx.out(
        `${okLabel(ctx, "Ran:")} ${installResult.command} (${ctx.colors.stdout.bold(context.installCwd)})`,
      );
    } else {
      ctx.out(`${warnLabel(ctx, "Install skipped:")} --no-autoinstall`);
    }
  },
});
