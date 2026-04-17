import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

import {
  canRewriteSpecifier,
  cloneManifest,
  collectSnapshots,
  createUpdatedSpecifier,
  type DependencySection,
  findCatalogEntry,
  findDependencyLocation,
  isCatalogProtocol,
  isWorkspaceProtocol,
  listManifestTargets,
  listTargetDependencies,
  parseCatalogProtocol,
  parsePackageInput,
  resolveUpdateVersion,
  resolveTargetContext,
  restoreSnapshots,
  runBunInstall,
  runBunUpdate,
  setCatalogEntry,
  setDependency,
  writeManifest,
} from "../../../lib";

interface UpdateAction {
  readonly action: "missing" | "noop" | "skipped" | "updated";
  readonly catalogName?: string | undefined;
  readonly nextSpecifier?: string | undefined;
  readonly packageName: string;
  readonly previousSpecifier?: string | undefined;
  readonly reason?: string | undefined;
  readonly resolutionStrategy?: string | undefined;
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

function describeStrategy(options: {
  readonly latest: boolean;
  readonly smart: boolean;
}): { label: string; text: string } {
  if (options.smart && options.latest) {
    return {
      label: "smart-latest-stable",
      text: "smart strategy: pick the newest stable overall",
    };
  }

  if (options.smart && !options.latest) {
    return {
      label: "smart-range",
      text: "smart strategy: stay within the current semver line and prefer the current prerelease branch when relevant",
    };
  }

  if (!options.smart && options.latest) {
    return {
      label: "latest",
      text: "latest strategy: jump to dist-tags.latest",
    };
  }

  return {
    label: "range",
    text: "range strategy: stay within the current semver range",
  };
}

function formatActionTarget(action: UpdateAction, fallbackLabel: string): string {
  const location = action.targetLabel ?? fallbackLabel;

  if (action.source === "catalog") {
    return action.catalogName ? `${location} (catalog:${action.catalogName})` : `${location} (catalog)`;
  }

  return action.section ? `${location} (${action.section})` : location;
}

function buildInstallCommand(options: {
  readonly useBunForce?: boolean | undefined;
  readonly installCwd: string;
  readonly latest: boolean;
  readonly recursive: boolean;
  readonly targetDir: string;
}): string {
  if (options.recursive) {
    return `bun update${options.useBunForce ? " --force" : ""}${options.latest ? " --latest" : ""} --recursive`;
  }

  if (options.installCwd === options.targetDir) {
    return `bun update${options.useBunForce ? " --force" : ""}${options.latest ? " --latest" : ""}`;
  }

  return `bun install${options.useBunForce ? " --force" : ""}`;
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

function resolveDryRunMode(options: {
  readonly apply?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}): boolean {
  if (options.dryRun === true) {
    return true;
  }

  if (options.dryRun === false) {
    return false;
  }

  if (options.apply === true) {
    return false;
  }

  return true;
}

function infoLabel(ctx: { colors: { stdout: { bold(text: string): string; cyan(text: string): string } } }, text: string): string {
  return ctx.colors.stdout.cyan(ctx.colors.stdout.bold(text));
}

function okLabel(ctx: { colors: { stdout: { bold(text: string): string; green(text: string): string } } }, text: string): string {
  return ctx.colors.stdout.green(ctx.colors.stdout.bold(text));
}

function warnLabel(ctx: { colors: { stdout: { bold(text: string): string; yellow(text: string): string } } }, text: string): string {
  return ctx.colors.stdout.yellow(ctx.colors.stdout.bold(text));
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Update dependency versions in a repo or workspace package with Bun-aware package.json changes",
  },
  agent: {
    notes:
      "Pass package names to update a focused subset, or omit args to update all direct dependencies of the target package. By default the command updates to the newest stable version and uses smart behavior for prereleases. With `latest=true` (default), smart picks the newest stable overall. With `latest=false`, smart prefers the current prerelease release line and promotes to matching stable when it appears. Pass `--no-smart` to disable this behavior. When the target is a monorepo root, workspace manifests are swept recursively by default; pass `--no-recursive` to stay on the root manifest only.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsDryRun: true,
    supportsApply: true,
  },
  help: {
    examples: [
      "rse pm update --cwd .",
      "rse pm update typescript @types/bun --target packages/rempts",
      "rse pm update --target apps/cli --json",
      "rse pm update zod --target packages/server --dry-run --json",
      "rse pm update --target . --dry-run --json",
      "rse pm update --target . --no-recursive --dry-run --json",
      "rse pm update typescript --dry-run --json",
      "rse pm update typescript --no-latest --dry-run --json",
      "rse pm update vite --no-smart --dry-run --json",
      "rse pm update --cwd /path/to/project --target /path/to/project --apply --dry-run --json",
      "rse pm update --apply",
    ],
    text: "By default this command updates to the newest stable version. Smart mode is enabled by default: with `latest=true` it selects the newest stable overall, and with `latest=false` it follows the current prerelease release line and promotes to matching stable when available. Pass `--no-smart` to disable this strategy. Pass `--no-latest` to stay within the current semver range. When the target is a monorepo root, workspace manifests are swept recursively by default; use `--no-recursive` to limit the run to the root manifest. Dry-run is enabled by default. Pass `--apply` to execute real writes and the final Bun step, or pass `--dry-run --apply` to keep preview mode explicit. Dry-run output shows grouped specifier diffs and the final Bun command that would run. Catalog-backed dependencies are updated through the Bun catalog in the repo root.",
  },
  options: {
    cwd: {
      type: "string",
      defaultValue: ".",
      description: "Base directory used to resolve the repo and target package",
      inputSources: ["flag", "default"],
    },
    dryRun: {
      type: "boolean",
      description: "Enabled by default; preview package.json changes without writing files. Pass --apply to execute unless --dry-run is also set",
      inputSources: ["flag"],
    },
    apply: {
      type: "boolean",
      description: "Execute real writes and the final Bun step unless --dry-run is also set",
      inputSources: ["flag"],
    },
    latest: {
      type: "boolean",
      description: "Enabled by default; pass --no-latest to stay within the current semver range instead of jumping to the newest published version",
      inputSources: ["flag"],
    },
    recursive: {
      type: "boolean",
      description: "Enabled by default for monorepo root targets; pass --no-recursive to limit the update to the root manifest only",
      inputSources: ["flag"],
    },
    smart: {
      type: "boolean",
      description: "Enabled by default; with latest=true pick newest stable overall, with latest=false prefer current prerelease branch and promote to matching stable",
      inputSources: ["flag"],
    },
    target: {
      type: "string",
      description: "Workspace path or package name to update relative to --cwd",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const requestedInputs = ctx.args.map(parsePackageInput);

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
    const smartByDefault = ctx.options.smart !== false;
    const latestByDefault = ctx.options.latest !== false;
    const executionRequested = ctx.options.apply === true;
    const dryRun = resolveDryRunMode({
      apply: ctx.options.apply,
      dryRun: ctx.options.dryRun,
    });
    const strategy = describeStrategy({
      latest: latestByDefault,
      smart: smartByDefault,
    });
    const recursiveByDefault = context.usesWorkspaces && context.targetDir === context.repoRootDir;
    const updateAllWorkspaceManifests =
      recursiveByDefault && ctx.options.recursive !== false;
    const manifestTargets = await listManifestTargets(context, {
      includeWorkspacePackages: updateAllWorkspaceManifests,
    });
    const nextManifests = new Map(
      manifestTargets.map((target) => [
        target.manifestPath,
        cloneManifest(target.manifest),
      ]),
    );
    let nextRootManifest = cloneManifest(context.repoRootManifest);
    const processedCatalogKeys = new Set<string>();
    const foundRequestedPackages = new Set<string>();
    const targetPackages =
      requestedPackages.length > 0
        ? requestedPackages
        : manifestTargets.flatMap((target) => listTargetDependencies(target.manifest));
    const installCommand = buildInstallCommand({
      useBunForce: executionRequested,
      installCwd: context.installCwd,
      latest: latestByDefault,
      recursive: updateAllWorkspaceManifests,
      targetDir: context.targetDir,
    });

    if (targetPackages.length === 0) {
      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            actions: [],
            dryRun,
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
        const nextVersion = await resolveUpdateVersion({
          currentSpecifier: update.currentSpecifier,
          refresh: executionRequested,
          latest: latestByDefault,
          packageName: update.packageName,
          smart: smartByDefault,
        });
        const nextSpecifier = createUpdatedSpecifier({
          currentSpecifier: update.currentSpecifier,
          version: nextVersion,
        });
        return {
          ...update,
          nextSpecifier,
          resolutionStrategy: strategy.label,
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
              : "catalog entry uses a non-rewritable specifier; Bun will refresh it during install/update",
            resolutionStrategy: update.resolutionStrategy,
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
            : "specifier is not rewritten; Bun will refresh it during install/update",
          resolutionStrategy: update.resolutionStrategy,
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
      dryRun,
      install: {
        command: installCommand,
        cwd: context.installCwd,
        executed: false,
      },
      latest: latestByDefault,
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

    const shouldRunNativeUpdate =
      context.installCwd === context.targetDir || updateAllWorkspaceManifests;

    if (changedManifestTargets.length === 0 && !rootChanged && !shouldRunNativeUpdate) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm update");
        return;
      }

      ctx.out(`${warnLabel(ctx, "No dependency updates:")} ${context.targetLabel}.`);
      ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
      ctx.out(`${infoLabel(ctx, "Install step:")} ${installCommand} (not needed).`);
      return;
    }

    if (dryRun) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm update");
        return;
      }

      ctx.out(`${infoLabel(ctx, "Dry run:")} ${context.targetLabel}.`);
      ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
      ctx.out(`${infoLabel(ctx, "Summary:")} ${summary.updated} update(s), ${summary.noop} unchanged, ${summary.skipped} skipped, ${summary.missing} missing.`);

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

      if (summary.skipped > 0 || summary.missing > 0) {
        ctx.out(warnLabel(ctx, "Notes:"));

        for (const action of actions.filter(
          (action) => action.action === "skipped" || action.action === "missing",
        )) {
          ctx.out(`${ctx.colors.stdout.magenta("-")} ${formatActionTarget(action, context.targetLabel)} :: ${ctx.colors.stdout.bold(action.packageName)} :: ${action.reason}`);
        }
      }

      ctx.out(`${infoLabel(ctx, "Final Bun command:")} ${installCommand}`);
      ctx.out(`${infoLabel(ctx, "Install cwd:")} ${ctx.colors.stdout.bold(context.installCwd)}`);
      return;
    }

    const snapshotPaths = [
      ...new Set([
        ...changedManifestTargets.map((target) => target.manifestPath),
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

    const installResult = shouldRunNativeUpdate
      ? await runBunUpdate(context.installCwd, {
          useBunForce: executionRequested,
          latest: latestByDefault,
          packages: requestedPackages,
          recursive: updateAllWorkspaceManifests,
        })
      : await runBunInstall(context.installCwd, {
          useBunForce: executionRequested,
        });

    if (!installResult.ok) {
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
      install: {
        ...installResult,
        executed: true,
      },
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(successPayload, "pm update");
      return;
    }

    ctx.out(`${okLabel(ctx, "Updated dependency versions:")} ${context.targetLabel}.`);
    ctx.out(`${infoLabel(ctx, "Strategy:")} ${strategy.text}.`);
    ctx.out(`${infoLabel(ctx, "Summary:")} ${summary.updated} update(s), ${summary.noop} unchanged, ${summary.skipped} skipped, ${summary.missing} missing.`);

    const grouped = groupUpdatedActions(actions, context.targetLabel);

    for (const [targetLabel, targetActions] of grouped) {
      ctx.out(`${ctx.colors.stdout.magenta("-")} ${ctx.colors.stdout.bold(targetLabel)}`);

      for (const action of targetActions) {
        ctx.out(
          `  ${ctx.colors.stdout.bold(action.packageName)}: ${action.previousSpecifier} -> ${ctx.colors.stdout.green(action.nextSpecifier ?? "")}`,
        );
      }
    }

    if (summary.skipped > 0 || summary.missing > 0) {
      ctx.out(warnLabel(ctx, "Notes:"));

      for (const action of actions.filter(
        (action) => action.action === "skipped" || action.action === "missing",
      )) {
        ctx.out(`${ctx.colors.stdout.magenta("-")} ${formatActionTarget(action, context.targetLabel)} :: ${ctx.colors.stdout.bold(action.packageName)} :: ${action.reason}`);
      }
    }

    ctx.out(`${okLabel(ctx, "Ran:")} ${installResult.command} in ${ctx.colors.stdout.bold(context.installCwd)}`);
  },
});
