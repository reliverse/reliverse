import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  discoverPackageEntrypoints,
  validateDeclarEntrypointFiles,
  type DeclarDiagnostic,
  type DeclarPackageJson,
} from "@reliverse/declar";

import {
  fileExists,
  pathIsDirectory,
  type RequestedTarget,
  type SkippedTarget,
} from "../shared-targets";
import { getWorkspacePackageIgnoreReason } from "../workspace-package-policy";
import { getIneligibilityReason } from "./eligibility";

export interface PublishableTarget extends RequestedTarget {
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly packageRecord: Record<string, unknown>;
  readonly packageName: string;
}

const sourceExtensions = [".tsx", ".mts", ".cts", ".ts"] as const;

function resolvePackageName(pkg: Record<string, unknown>, fallbackLabel: string): string {
  return typeof pkg.name === "string" && pkg.name.trim().length > 0
    ? pkg.name.trim()
    : fallbackLabel;
}

function formatDeclarDiagnostic(diagnostic: DeclarDiagnostic): string {
  return `${diagnostic.code}: ${diagnostic.message}`;
}

function isDeclarationArtifactPath(path: string): boolean {
  return path.endsWith(".d.ts") || path.endsWith(".d.mts") || path.endsWith(".d.cts");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSourceEntrypoint(value: string): boolean {
  return sourceExtensions.some((extension) => value.endsWith(extension)) && !value.endsWith(".d.ts");
}

function normalizePackagePath(value: string): string {
  return value.startsWith("./") ? value : `./${value}`;
}

function stripSourcePrefix(value: string): string {
  const normalized = normalizePackagePath(value);
  return normalized.startsWith("./src/") ? `./${normalized.slice("./src/".length)}` : normalized;
}

function toPublishRuntimePath(sourcePath: string, publishFrom: string): string {
  const withoutSourcePrefix = stripSourcePrefix(sourcePath);
  const extension = sourceExtensions.find((candidate) => withoutSourcePrefix.endsWith(candidate));
  const basePath = extension
    ? withoutSourcePrefix.slice(0, -extension.length)
    : withoutSourcePrefix;
  const runtimeExtension = sourcePath.endsWith(".cts")
    ? ".cjs"
    : sourcePath.endsWith(".mts")
      ? ".mjs"
      : ".js";

  return `./${publishFrom.replace(/^\.\//, "").replace(/\/$/, "")}/${basePath.replace(/^\.\//, "")}${runtimeExtension}`;
}

function toPublishDeclarationPath(sourcePath: string, publishFrom: string): string {
  const withoutSourcePrefix = stripSourcePrefix(sourcePath);
  const extension = sourceExtensions.find((candidate) => withoutSourcePrefix.endsWith(candidate));
  const basePath = extension
    ? withoutSourcePrefix.slice(0, -extension.length)
    : withoutSourcePrefix;
  const declarationExtension = sourcePath.endsWith(".mts")
    ? ".d.mts"
    : sourcePath.endsWith(".cts")
      ? ".d.cts"
      : ".d.ts";

  return `./${publishFrom.replace(/^\.\//, "").replace(/\/$/, "")}/${basePath.replace(/^\.\//, "")}${declarationExtension}`;
}

function collectFirstSourceEntrypoint(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isSourceEntrypoint(value) ? normalizePackagePath(value) : undefined;
  }

  if (!isRecord(value)) return undefined;

  for (const nested of Object.values(value)) {
    const sourceEntrypoint = collectFirstSourceEntrypoint(nested);
    if (sourceEntrypoint) return sourceEntrypoint;
  }

  return undefined;
}

function rewriteExportForPublish(value: unknown, publishFrom: string): unknown {
  if (typeof value === "string") {
    if (!isSourceEntrypoint(value)) return value;

    return {
      types: toPublishDeclarationPath(value, publishFrom),
      import: toPublishRuntimePath(value, publishFrom),
    };
  }

  if (!isRecord(value)) return value;

  const sourceEntrypoint = collectFirstSourceEntrypoint(value);
  const rewritten: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && isSourceEntrypoint(nested)) {
      rewritten[key] = key === "types"
        ? toPublishDeclarationPath(nested, publishFrom)
        : toPublishRuntimePath(nested, publishFrom);
      continue;
    }

    rewritten[key] = rewriteExportForPublish(nested, publishFrom);
  }

  if (sourceEntrypoint && typeof rewritten.types !== "string") {
    return { types: toPublishDeclarationPath(sourceEntrypoint, publishFrom), ...rewritten };
  }

  return rewritten;
}

export function preparePublishPackageMetadata(
  packageRecord: Record<string, unknown>,
  publishFrom: string,
): Record<string, unknown> {
  const nextPackageRecord: Record<string, unknown> = JSON.parse(
    JSON.stringify(packageRecord),
  ) as Record<string, unknown>;
  delete nextPackageRecord.devDependencies;

  const sourceEntrypoint = collectFirstSourceEntrypoint(nextPackageRecord.exports);

  if (sourceEntrypoint) {
    nextPackageRecord.types = toPublishDeclarationPath(sourceEntrypoint, publishFrom);
  } else if (typeof nextPackageRecord.types === "string" && isSourceEntrypoint(nextPackageRecord.types)) {
    nextPackageRecord.types = toPublishDeclarationPath(nextPackageRecord.types, publishFrom);
  }

  if (isRecord(nextPackageRecord.exports)) {
    const exportsValue = nextPackageRecord.exports;
    const hasSubpathExports = Object.keys(exportsValue).some((key) => key.startsWith("."));

    nextPackageRecord.exports = hasSubpathExports
      ? Object.fromEntries(
          Object.entries(exportsValue).map(([key, value]) => [
            key,
            rewriteExportForPublish(value, publishFrom),
          ]),
        )
      : rewriteExportForPublish(exportsValue, publishFrom);
  } else if (nextPackageRecord.exports) {
    nextPackageRecord.exports = rewriteExportForPublish(nextPackageRecord.exports, publishFrom);
  }

  return nextPackageRecord;
}

function isInsidePublishFrom(path: string, publishFrom: string): boolean {
  const normalizedPath = path.startsWith("./") ? path.slice(2) : path;
  const normalizedPublishFrom = publishFrom.replace(/^\.\//, "").replace(/\/$/, "");

  return normalizedPath === normalizedPublishFrom || normalizedPath.startsWith(`${normalizedPublishFrom}/`);
}

async function validatePublishDeclarationArtifacts(options: {
  readonly packageDir: string;
  readonly packageJson: Record<string, unknown>;
  readonly publishFrom: string;
}): Promise<string | undefined> {
  const hasTsconfig = await fileExists(resolve(options.packageDir, "tsconfig.json"));
  if (!hasTsconfig) {
    return undefined;
  }

  const discovery = discoverPackageEntrypoints(options.packageJson as DeclarPackageJson);
  const hasDeclaredTypes = discovery.entrypoints.some(
    (entrypoint) => entrypoint.typesConditions.length > 0,
  );

  if (!hasDeclaredTypes) {
    return "missing declaration targets in package.json for TypeScript package";
  }

  const invalidTypeTargets = discovery.entrypoints.flatMap((entrypoint) =>
    entrypoint.typesConditions
      .filter(
        (condition) =>
          !isDeclarationArtifactPath(condition.path) ||
          !isInsidePublishFrom(condition.path, options.publishFrom),
      )
      .map((condition) => `${entrypoint.exportPath}:${condition.path}`),
  );

  if (invalidTypeTargets.length > 0) {
    return `package type targets must point to declaration artifacts under ${options.publishFrom}: ${invalidTypeTargets.join(", ")}`;
  }

  const validation = await validateDeclarEntrypointFiles({
    entrypoints: discovery.entrypoints,
    packageDir: options.packageDir,
  });
  const errorDiagnostics = validation.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );

  return errorDiagnostics.length > 0
    ? `missing declaration artifacts: ${errorDiagnostics.map(formatDeclarDiagnostic).join("; ")}`
    : undefined;
}

export async function resolvePublishableTargets(options: {
  readonly requireArtifactDir?: boolean | undefined;
  readonly publishFrom: string;
  readonly targets: readonly RequestedTarget[];
}): Promise<{
  readonly publishable: readonly PublishableTarget[];
  readonly skipped: readonly SkippedTarget[];
}> {
  const publishable: PublishableTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const target of options.targets) {
    const manifestPath = resolve(target.cwd, "package.json");
    if (!(await fileExists(manifestPath))) {
      skipped.push({ label: target.label, reason: "missing package.json" });
      continue;
    }

    let packageRecord: Record<string, unknown>;
    try {
      packageRecord = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      skipped.push({ label: target.label, reason: "invalid package.json" });
      continue;
    }

    const ignored = getWorkspacePackageIgnoreReason(packageRecord);
    if (ignored) {
      skipped.push({ label: target.label, reason: ignored });
      continue;
    }

    const ineligible = getIneligibilityReason(packageRecord);
    if (ineligible) {
      skipped.push({ label: target.label, reason: ineligible });
      continue;
    }

    const artifactDir = resolve(target.cwd, options.publishFrom);
    if (options.requireArtifactDir !== false) {
      if (!(await pathIsDirectory(artifactDir))) {
        skipped.push({
          label: target.label,
          reason: `missing publish directory: ${artifactDir}`,
        });
        continue;
      }
    }

    const publishPackageRecord = preparePublishPackageMetadata(packageRecord, options.publishFrom);
    const declarationArtifactReason = await validatePublishDeclarationArtifacts({
      packageDir: target.cwd,
      packageJson: publishPackageRecord,
      publishFrom: options.publishFrom,
    });
    if (declarationArtifactReason) {
      skipped.push({ label: target.label, reason: declarationArtifactReason });
      continue;
    }

    publishable.push({
      artifactDir,
      cwd: target.cwd,
      label: target.label,
      manifestPath,
      packageName: resolvePackageName(packageRecord, target.label),
      packageRecord: publishPackageRecord,
    });
  }

  return { publishable, skipped };
}
