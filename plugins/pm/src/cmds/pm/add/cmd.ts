import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

import {
  cloneManifest,
  collectSnapshots,
  createDesiredSpecifier,
  findDependencyLocation,
  fetchLatestVersion,
  findCatalogEntry,
  getCatalogProtocol,
  getRequestedSection,
  parsePackageInput,
  resolveTargetContext,
  restoreSnapshots,
  runBunInstall,
  setCatalogEntry,
  setDependency,
  writeManifest,
} from "../../../lib";

interface AddAction {
  readonly action: "added" | "noop" | "skipped";
  readonly nextSpecifier?: string | undefined;
  readonly packageName: string;
  readonly previousSpecifier?: string | undefined;
  readonly reason?: string | undefined;
  readonly section: string;
  readonly usesCatalog: boolean;
}

function infoLabel(ctx: { colors: { stdout: { bold(text: string): string; cyan(text: string): string; green(text: string): string; yellow(text: string): string } } }, text: string): string {
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
    name: "add",
    description: "Add new dependencies to a repo or workspace package using Bun-first package management flows",
  },
  agent: {
    notes:
      "This command is non-interactive by default. Pass packages as args and choose the target explicitly with --cwd or --target.",
  },
  interactive: "never",
  conventions: {
    idempotent: true,
    supportsDryRun: true,
  },
  help: {
    examples: [
      "rse pm add zod --cwd .",
      "rse pm add typescript @types/bun --dev --cwd .",
      "rse pm add react --target apps/web",
      "rse pm add drizzle-orm --target packages/db --json",
      "rse pm add valibot --target packages/rempts --dry-run --json",
      "rse pm add jest --target apps/web --catalog testing --dry-run --json",
    ],
    text: "For workspace packages, the command prefers the default Bun catalog when available. Use --catalog <name> to target a named Bun catalog and write catalog:<name> references.",
  },
  options: {
    cwd: {
      type: "string",
      defaultValue: ".",
      description: "Base directory used to resolve the repo and target package",
      inputSources: ["flag", "default"],
    },
    catalog: {
      type: "string",
      description: "Named Bun catalog to use for workspace dependencies (writes catalog:<name>)",
      inputSources: ["flag"],
    },
    dev: {
      type: "boolean",
      description: "Add packages to devDependencies",
      inputSources: ["flag"],
    },
    dryRun: {
      type: "boolean",
      description: "Preview the planned package.json changes without writing files",
      inputSources: ["flag"],
    },
    exact: {
      type: "boolean",
      description: "Use exact versions instead of caret ranges for newly resolved versions",
      inputSources: ["flag"],
    },
    optional: {
      type: "boolean",
      description: "Add packages to optionalDependencies",
      inputSources: ["flag"],
    },
    peer: {
      type: "boolean",
      description: "Add packages to peerDependencies",
      inputSources: ["flag"],
    },
    target: {
      type: "string",
      description: "Workspace path or package name to modify relative to --cwd",
      inputSources: ["flag"],
    },
  },
  async handler(ctx) {
    const packageInputs = ctx.args.map(parsePackageInput);

    if (packageInputs.length === 0) {
      ctx.exit(
        1,
        "Missing package names. Example: rse pm add zod --target packages/rempts",
      );
    }

    const dependencySection = getRequestedSection({
      dev: ctx.options.dev,
      optional: ctx.options.optional,
      peer: ctx.options.peer,
    });
    const context = await resolveTargetContext({
      cwd: ctx.options.cwd,
      target: ctx.options.target,
    });
    const requestedCatalogName = ctx.options.catalog?.trim() || undefined;

    if (requestedCatalogName && (!context.usesWorkspaces || context.targetDir === context.repoRootDir)) {
      ctx.exit(
        1,
        "Named catalogs can only be used when targeting a workspace package inside a Bun monorepo.",
      );
    }

    const shouldUseCatalog = context.usesCatalog && context.targetDir !== context.repoRootDir;
    let nextTargetManifest = cloneManifest(context.targetManifest);
    let nextRootManifest = cloneManifest(context.repoRootManifest);
    const actions: AddAction[] = [];

    const packagesNeedingRegistryLookup = [
      ...new Set(
        packageInputs
          .filter(
            (input) =>
              !input.requestedSpecifier &&
              !(shouldUseCatalog && Boolean(findCatalogEntry(nextRootManifest, input.name, requestedCatalogName))),
          )
          .map((input) => input.name),
      ),
    ];
    const latestVersionByName =
      packagesNeedingRegistryLookup.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await pMap(
                packagesNeedingRegistryLookup,
                async (packageName) => {
                  const version = await fetchLatestVersion(packageName);
                  return [packageName, version] as const;
                },
                { concurrency: 8 },
              )
            ).map(([name, version]) => [name, version]),
          );

    for (const input of packageInputs) {
      const existing = findDependencyLocation(nextTargetManifest, input.name);
      const catalogEntry = findCatalogEntry(
        nextRootManifest,
        input.name,
        requestedCatalogName,
      );
      const resolvedVersion =
        catalogEntry && shouldUseCatalog && !input.requestedSpecifier
          ? catalogEntry.specifier
          : createDesiredSpecifier({
              exact: ctx.options.exact,
              requestedSpecifier: input.requestedSpecifier,
              version:
                latestVersionByName.get(input.name) ??
                (await fetchLatestVersion(input.name)),
            });
      const desiredSpecifier = shouldUseCatalog
        ? getCatalogProtocol(requestedCatalogName)
        : resolvedVersion;

      if (existing && existing.section !== dependencySection) {
        actions.push({
          action: "skipped",
          packageName: input.name,
          previousSpecifier: existing.specifier,
          reason: `already exists in ${existing.section}`,
          section: existing.section,
          usesCatalog: existing.specifier.startsWith("catalog:"),
        });
        continue;
      }

      if (existing && existing.section === dependencySection) {
        if (
          existing.specifier === desiredSpecifier &&
          (!shouldUseCatalog || catalogEntry?.specifier === resolvedVersion)
        ) {
          actions.push({
            action: "noop",
            nextSpecifier: desiredSpecifier,
            packageName: input.name,
            previousSpecifier: existing.specifier,
            reason: "already present",
            section: dependencySection,
            usesCatalog: desiredSpecifier.startsWith("catalog:"),
          });
          continue;
        }

        actions.push({
          action: "noop",
          packageName: input.name,
          previousSpecifier: existing.specifier,
          reason: "already present; use `rse pm update` to change versions",
          section: dependencySection,
          usesCatalog: existing.specifier.startsWith("catalog:"),
        });
        continue;
      }

      nextTargetManifest = setDependency(
        nextTargetManifest,
        dependencySection,
        input.name,
        desiredSpecifier,
      );

      if (shouldUseCatalog && catalogEntry?.specifier !== resolvedVersion) {
        nextRootManifest = setCatalogEntry(
          nextRootManifest,
          input.name,
          resolvedVersion,
          requestedCatalogName,
        );
      }

      actions.push({
        action: "added",
        nextSpecifier: desiredSpecifier,
        packageName: input.name,
        section: dependencySection,
        usesCatalog: desiredSpecifier.startsWith("catalog:"),
      });
    }

    const targetChanged =
      JSON.stringify(nextTargetManifest) !== JSON.stringify(context.targetManifest);
    const rootChanged =
      JSON.stringify(nextRootManifest) !== JSON.stringify(context.repoRootManifest);
    const resultPayload = {
      actions,
      dryRun: ctx.options.dryRun === true,
      install: {
        command: "bun install",
        cwd: context.installCwd,
        executed: false,
      },
      section: dependencySection,
      target: {
        cwd: context.targetDir,
        usesCatalog: shouldUseCatalog,
        catalogName: requestedCatalogName,
        label: context.targetLabel,
        manifestPath: context.targetManifestPath,
      },
    };

    if (!targetChanged && !rootChanged) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm add");
        return;
      }

      ctx.out(`${warnLabel(ctx, "No changes:")} ${context.targetLabel}.`);

      for (const action of actions) {
        ctx.out(
          `${infoLabel(ctx, `${action.action}:`)} ${ctx.colors.stdout.bold(action.packageName)} (${action.reason ?? action.nextSpecifier ?? action.section})`,
        );
      }

      return;
    }

    if (ctx.options.dryRun) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm add");
        return;
      }

      ctx.out(`${infoLabel(ctx, "Dry run:")} ${context.targetLabel}`);

      for (const action of actions.filter((action) => action.action === "added")) {
        ctx.out(
          `${infoLabel(ctx, "Would add")} ${ctx.colors.stdout.bold(action.packageName)} to ${action.section} as ${ctx.colors.stdout.green(action.nextSpecifier ?? "")}`,
        );
      }

      return;
    }

    const snapshotPaths = [
      context.targetManifestPath,
      ...(rootChanged ? [context.repoRootManifestPath] : []),
    ];
    const snapshots = await collectSnapshots(snapshotPaths);

    await writeManifest(context.targetManifestPath, nextTargetManifest);

    if (rootChanged) {
      await writeManifest(context.repoRootManifestPath, nextRootManifest);
    }

    const installResult = await runBunInstall(context.installCwd);

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
      ctx.output.result(successPayload, "pm add");
      return;
    }

    ctx.out(`${okLabel(ctx, "Updated:")} ${context.targetLabel}.`);

    for (const action of actions.filter((action) => action.action === "added")) {
      ctx.out(
        `${okLabel(ctx, "Added")} ${ctx.colors.stdout.bold(action.packageName)} to ${action.section} as ${ctx.colors.stdout.green(action.nextSpecifier ?? "")}`,
      );
    }

    ctx.out(`${okLabel(ctx, "Ran:")} bun install in ${ctx.colors.stdout.bold(context.installCwd)}`);
  },
});
