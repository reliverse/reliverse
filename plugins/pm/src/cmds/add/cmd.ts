import { defineCommand } from "@reliverse/rempts";
import pMap from "p-map";

import {
  assertSupportedBunLockfileProject,
  cloneManifest,
  getBunLockfilePath,
  createDesiredSpecifier,
  findDependencyLocation,
  fetchLatestVersion,
  findCatalogEntry,
  getCatalogProtocol,
  getRequestedSection,
  parsePackageInput,
  resolveTargetContext,
  runBunInstall,
  setCatalogEntry,
  setDependency,
  type PackageInput,
  withSnapshotRollback,
  writeManifest,
} from "../../lib";

interface AddAction {
  readonly action: "added" | "noop" | "skipped";
  readonly nextSpecifier?: string | undefined;
  readonly packageName: string;
  readonly previousSpecifier?: string | undefined;
  readonly reason?: string | undefined;
  readonly section: string;
  readonly usesCatalog: boolean;
}

function createAddSummary(actions: readonly AddAction[]) {
  return {
    added: actions.filter((action) => action.action === "added").length,
    unchanged: actions.filter((action) => action.action === "noop").length,
    skipped: actions.filter((action) => action.action === "skipped").length,
  };
}

function formatSummary(summary: ReturnType<typeof createAddSummary>): string {
  return `${summary.added} added, ${summary.unchanged} unchanged, ${summary.skipped} skipped`;
}

function infoLabel(
  ctx: {
    colors: {
      stdout: {
        bold(text: string): string;
        cyan(text: string): string;
        green(text: string): string;
        yellow(text: string): string;
      };
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

class InstallFailedError extends Error {
  constructor(readonly installResult: Awaited<ReturnType<typeof runBunInstall>>) {
    super("bun install failed");
  }
}

export default defineCommand({
  meta: {
    name: "add",
    description:
      "Add new dependencies to a repo or workspace package using Bun-first package management flows",
  },
  agent: {
    notes:
      "This command is non-interactive by default. Pass packages as args and choose the target explicitly with --cwd or --target.",
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
      "rse add zod --cwd .",
      "rse add typescript @types/bun --dev --cwd .",
      "rse add react --target apps/web",
      "rse add zod --target packages/rempts --json",
      "rse add valibot --target packages/rempts --apply --json",
      "rse add jest --target apps/web --catalog testing --apply --json",
    ],
    text: "For workspace packages, the command prefers the default Bun catalog when available. Use --catalog <name> to target a named Bun catalog and write catalog:<name> references.",
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
    const packageInputs: PackageInput[] = (ctx.args as string[]).map(parsePackageInput);

    if (packageInputs.length === 0) {
      ctx.exit(1, "Missing package names. Example: rse add zod --target packages/rempts");
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
    await assertSupportedBunLockfileProject(context.installCwd);

    const autoinstall = ctx.options.autoinstall !== false;
    const requestedCatalogName = ctx.options.catalog?.trim() || undefined;

    if (
      requestedCatalogName &&
      (!context.usesWorkspaces || context.targetDir === context.repoRootDir)
    ) {
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
              !(
                shouldUseCatalog &&
                Boolean(findCatalogEntry(nextRootManifest, input.name, requestedCatalogName))
              ),
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
      const catalogEntry = findCatalogEntry(nextRootManifest, input.name, requestedCatalogName);
      const resolvedVersion =
        catalogEntry && shouldUseCatalog && !input.requestedSpecifier
          ? catalogEntry.specifier
          : createDesiredSpecifier({
              exact: ctx.options.exact,
              requestedSpecifier: input.requestedSpecifier,
              version:
                latestVersionByName.get(input.name) ?? (await fetchLatestVersion(input.name)),
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
          reason: "already present; use `rse update` to change versions",
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
      apply: ctx.safety.apply,
      preview: !ctx.safety.apply,
      install: {
        command: "bun install",
        cwd: context.installCwd,
        enabled: autoinstall,
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

      const summary = createAddSummary(actions);
      ctx.out(warnLabel(ctx, "pm add"));
      ctx.out(`${infoLabel(ctx, "Target:")} ${context.targetLabel}`);
      ctx.out(`${infoLabel(ctx, "Summary:")} ${formatSummary(summary)}.`);

      ctx.out(infoLabel(ctx, "Unchanged:"));
      for (const action of actions) {
        ctx.out(
          `${ctx.colors.stdout.yellow("-")} ${ctx.colors.stdout.bold(action.packageName)} ${action.reason ?? action.nextSpecifier ?? action.section}`,
        );
      }

      return;
    }

    if (!ctx.safety.apply) {
      if (ctx.output.mode === "json") {
        ctx.output.result(resultPayload, "pm add");
        return;
      }

      const summary = createAddSummary(actions);
      ctx.out(infoLabel(ctx, "pm add preview"));
      ctx.out(`${infoLabel(ctx, "Target:")} ${context.targetLabel}`);
      ctx.out(`${infoLabel(ctx, "Section:")} ${dependencySection}`);
      ctx.out(`${infoLabel(ctx, "Summary:")} ${formatSummary(summary)}.`);

      for (const action of actions.filter((action) => action.action === "added")) {
        ctx.out(
          `${ctx.colors.stdout.green("+")} ${ctx.colors.stdout.bold(action.packageName)} ${ctx.colors.stdout.green(action.nextSpecifier ?? "")} (${action.section})`,
        );
      }

      ctx.out(
        `${infoLabel(ctx, "Install step:")} ${autoinstall ? "bun install (after --apply)" : "disabled (--no-autoinstall)"}`,
      );

      return;
    }

    ctx.safety.assertApplied("fs.write");

    const snapshotPaths = [
      context.targetManifestPath,
      getBunLockfilePath(context.installCwd),
      ...(rootChanged ? [context.repoRootManifestPath] : []),
    ];
    const installResult = await withSnapshotRollback(snapshotPaths, async () => {
      await writeManifest(context.targetManifestPath, nextTargetManifest);

      if (rootChanged) {
        await writeManifest(context.repoRootManifestPath, nextRootManifest);
      }

      const result = autoinstall ? await runBunInstall(context.installCwd) : null;

      if (result && !result.ok) {
        throw new InstallFailedError(result);
      }

      return result;
    }).catch((error: unknown) => {
      if (error instanceof InstallFailedError) {
        if (error.installResult.stderr.trim().length > 0 && ctx.output.mode !== "json") {
          ctx.err(error.installResult.stderr.trim());
        }

        return ctx.exit(
          1,
          `bun install failed after updating ${context.targetLabel}. Changes were reverted. Command: ${error.installResult.command}. Cwd: ${error.installResult.cwd}. Exit code: ${error.installResult.exitCode}.`,
        );
      }

      throw error;
    });

    const successPayload = {
      ...resultPayload,
      install: installResult
        ? {
            ...installResult,
            enabled: true,
            executed: true,
          }
        : {
            command: "bun install",
            cwd: context.installCwd,
            enabled: false,
            executed: false,
          },
    };

    if (ctx.output.mode === "json") {
      ctx.output.result(successPayload, "pm add");
      return;
    }

    const summary = createAddSummary(actions);
    ctx.out(okLabel(ctx, "pm add"));
    ctx.out(`${infoLabel(ctx, "Target:")} ${context.targetLabel}`);
    ctx.out(`${infoLabel(ctx, "Summary:")} ${formatSummary(summary)}.`);

    for (const action of actions.filter((action) => action.action === "added")) {
      ctx.out(
        `${ctx.colors.stdout.green("+")} ${ctx.colors.stdout.bold(action.packageName)} ${ctx.colors.stdout.green(action.nextSpecifier ?? "")} (${action.section})`,
      );
    }

    if (installResult) {
      ctx.out(
        `${okLabel(ctx, "Ran:")} bun install (${ctx.colors.stdout.bold(context.installCwd)})`,
      );
    } else {
      ctx.out(`${warnLabel(ctx, "Install skipped:")} --no-autoinstall`);
    }
  },
});
