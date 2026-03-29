import { defineCommand } from "@reliverse/rempts";

import {
  canRewriteSpecifier,
  cloneManifest,
  collectSnapshots,
  createUpdatedSpecifier,
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
} from "../../lib";

interface UpdateAction {
  readonly action: "missing" | "noop" | "skipped" | "updated";
  readonly catalogName?: string | undefined;
  readonly nextSpecifier?: string | undefined;
  readonly packageName: string;
  readonly previousSpecifier?: string | undefined;
  readonly reason?: string | undefined;
  readonly section?: string | undefined;
  readonly source: "catalog" | "target";
  readonly targetLabel?: string | undefined;
}

export default defineCommand({
  description: "Update dependency versions in a repo or workspace package with Bun-aware package.json changes",
  agent: {
    notes:
      "Pass package names to update a focused subset, or omit args to update all direct dependencies of the target package. By default the command updates to the newest stable version and uses smart behavior for prereleases. With `latest=true` (default), smart picks the newest stable overall. With `latest=false`, smart prefers the current prerelease release line and promotes to matching stable when it appears. Pass `--no-smart` to disable this behavior. When the target is a monorepo root, workspace manifests are swept recursively by default; pass `--no-recursive` to stay on the root manifest only.",
  },
  conventions: {
    idempotent: true,
    supportsDryRun: true,
    supportsForce: true,
  },
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
    "rse pm update --cwd /path/to/project --target /path/to/project --force --dry-run --json",
  ],
  help:
    "By default this command updates to the newest stable version. Smart mode is enabled by default: with `latest=true` it selects the newest stable overall, and with `latest=false` it follows the current prerelease release line and promotes to matching stable when available. Pass `--no-smart` to disable this strategy. Pass `--no-latest` to stay within the current semver range. When the target is a monorepo root, workspace manifests are swept recursively by default; use `--no-recursive` to limit the run to the root manifest. Catalog-backed dependencies are updated through the Bun catalog in the repo root.",
  name: "update",
  options: {
    cwd: {
      type: "string",
      defaultValue: ".",
      description: "Base directory used to resolve the repo and target package",
      inputSources: ["flag", "default"],
    },
    dryRun: {
      type: "boolean",
      description: "Preview package.json changes without writing files",
      inputSources: ["flag"],
    },
    force: {
      type: "boolean",
      description: "Always refresh registry metadata and force the final Bun install/update step",
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

    if (targetPackages.length === 0) {
      if (ctx.output.mode === "json") {
        ctx.output.result(
          {
            actions: [],
            dryRun: ctx.options.dryRun === true,
            install: {
              command: updateAllWorkspaceManifests
                ? `bun update${latestByDefault ? " --latest" : ""} --recursive`
                : `bun update${latestByDefault ? " --latest" : ""}`,
              cwd: context.installCwd,
              executed: false,
            },
            latest: latestByDefault,
            recursive: updateAllWorkspaceManifests,
            smart: smartByDefault,
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

      ctx.out(`No direct dependencies found in ${context.targetLabel}.`);
      return;
    }

    const actions: UpdateAction[] = [];

    for (const manifestTarget of manifestTargets) {
      let nextTargetManifest = nextManifests.get(manifestTarget.manifestPath);

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

          const nextVersion = await resolveUpdateVersion({
            currentSpecifier: catalogEntry.specifier,
            force: ctx.options.force,
            latest: latestByDefault,
            packageName,
            smart: smartByDefault,
          });
          const nextSpecifier = createUpdatedSpecifier({
            currentSpecifier: catalogEntry.specifier,
            version: nextVersion,
          });

          if (nextSpecifier === catalogEntry.specifier) {
            actions.push({
              action: "noop",
              catalogName: catalogEntry.catalogName,
              packageName,
              previousSpecifier: catalogEntry.specifier,
              reason: canRewriteSpecifier(catalogEntry.specifier)
                ? "catalog entry is already up to date"
                : "catalog entry uses a non-rewritable specifier; Bun will refresh it during install/update",
              source: "catalog",
              targetLabel: manifestTarget.label,
            });
            continue;
          }

          nextRootManifest = setCatalogEntry(
            nextRootManifest,
            packageName,
            nextSpecifier,
            catalogEntry.catalogName,
          );
          actions.push({
            action: "updated",
            catalogName: catalogEntry.catalogName,
            nextSpecifier,
            packageName,
            previousSpecifier: catalogEntry.specifier,
            reason: "updated repo catalog entry",
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

          const nextVersion = await resolveUpdateVersion({
            currentSpecifier: catalogEntry.specifier,
            force: ctx.options.force,
            latest: latestByDefault,
            packageName,
            smart: smartByDefault,
          });
          const nextSpecifier = createUpdatedSpecifier({
            currentSpecifier: catalogEntry.specifier,
            version: nextVersion,
          });

          if (nextSpecifier === catalogEntry.specifier) {
            actions.push({
              action: "noop",
              catalogName,
              packageName,
              previousSpecifier: catalogEntry.specifier,
              reason: canRewriteSpecifier(catalogEntry.specifier)
                ? "catalog entry is already up to date"
                : "catalog entry uses a non-rewritable specifier; Bun will refresh it during install/update",
              section: targetLocation.section,
              source: "catalog",
              targetLabel: manifestTarget.label,
            });
            continue;
          }

          nextRootManifest = setCatalogEntry(
            nextRootManifest,
            packageName,
            nextSpecifier,
            catalogName,
          );
          actions.push({
            action: "updated",
            catalogName,
            nextSpecifier,
            packageName,
            previousSpecifier: catalogEntry.specifier,
            reason: "updated repo catalog entry",
            section: targetLocation.section,
            source: "catalog",
            targetLabel: manifestTarget.label,
          });
          continue;
        }

        const nextVersion = await resolveUpdateVersion({
          currentSpecifier: targetLocation.specifier,
          force: ctx.options.force,
          latest: latestByDefault,
          packageName,
          smart: smartByDefault,
        });
        const nextSpecifier = createUpdatedSpecifier({
          currentSpecifier: targetLocation.specifier,
          version: nextVersion,
        });

        if (nextSpecifier === targetLocation.specifier) {
          actions.push({
            action: "noop",
            packageName,
            previousSpecifier: targetLocation.specifier,
            reason: canRewriteSpecifier(targetLocation.specifier)
              ? "already up to date"
              : "specifier is not rewritten; Bun will refresh it during install/update",
            section: targetLocation.section,
            source: "target",
            targetLabel: manifestTarget.label,
          });
          continue;
        }

        nextTargetManifest = setDependency(
          nextTargetManifest,
          targetLocation.section,
          packageName,
          nextSpecifier,
        );
        nextManifests.set(manifestTarget.manifestPath, nextTargetManifest);
        actions.push({
          action: "updated",
          nextSpecifier,
          packageName,
          previousSpecifier: targetLocation.specifier,
          section: targetLocation.section,
          source: "target",
          targetLabel: manifestTarget.label,
        });
      }
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
    const resultPayload = {
      actions,
      dryRun: ctx.options.dryRun === true,
      install: {
        command: updateAllWorkspaceManifests
          ? `bun update${ctx.options.force ? " --force" : ""}${latestByDefault ? " --latest" : ""} --recursive`
          : `bun ${context.installCwd === context.targetDir ? "update" : "install"}${ctx.options.force ? " --force" : ""}${latestByDefault && context.installCwd === context.targetDir ? " --latest" : ""}`,
        cwd: context.installCwd,
        executed: false,
      },
      latest: latestByDefault,
      recursive: updateAllWorkspaceManifests,
      smart: smartByDefault,
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

      ctx.out(`No dependency updates needed for ${context.targetLabel}.`);
      return;
    }

    if (ctx.options.dryRun) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm update");
        return;
      }

      ctx.out(`Dry run for ${context.targetLabel}:`);

      for (const action of actions.filter((action) => action.action === "updated")) {
        ctx.out(
          `Would update ${action.packageName} in ${action.targetLabel ?? context.targetLabel} from ${action.previousSpecifier} to ${action.nextSpecifier}`,
        );
      }

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
          force: ctx.options.force,
          latest: latestByDefault,
          packages: requestedPackages,
          recursive: updateAllWorkspaceManifests,
        })
      : await runBunInstall(context.installCwd, {
          force: ctx.options.force,
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

    ctx.out(`Updated dependency versions for ${context.targetLabel}.`);

    for (const action of actions.filter((action) => action.action === "updated")) {
      ctx.out(
        `Updated ${action.packageName} in ${action.targetLabel ?? context.targetLabel} from ${action.previousSpecifier} to ${action.nextSpecifier}`,
      );
    }

    ctx.out(`Ran bun install in ${context.installCwd}`);
  },
});
