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

export type PublishBundleStrategy = "auto" | "single" | "split";

export interface PublishableTarget extends RequestedTarget {
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly packageRecord: Record<string, unknown>;
  readonly packageName: string;
}

const sourceExtensions = [".tsx", ".mts", ".cts", ".ts"] as const;
const runtimeConditions = new Set([
  "browser",
  "bun",
  "default",
  "development",
  "import",
  "node",
  "production",
  "require",
]);

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

function isPackageRelativePath(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith("/");
}

function isPublishFilePattern(value: string): boolean {
  return value.includes("*");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSourceEntrypoint(value: string): boolean {
  return (
    sourceExtensions.some((extension) => value.endsWith(extension)) && !value.endsWith(".d.ts")
  );
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

function toSingleBundleRuntimePath(publishFrom: string): string {
  return `./${publishFrom.replace(/^\.\//, "").replace(/\/$/, "")}/index.js`;
}

function toPublishBinPath(sourcePath: string, publishFrom: string): string {
  return toPublishRuntimePath(sourcePath, publishFrom).replace(/^\.\//, "");
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

function rewriteExportForPublish(
  value: unknown,
  publishFrom: string,
  bundleStrategy: Exclude<PublishBundleStrategy, "auto">,
): unknown {
  if (typeof value === "string") {
    if (!isSourceEntrypoint(value)) return value;

    return {
      types: toPublishDeclarationPath(value, publishFrom),
      import:
        bundleStrategy === "single"
          ? toSingleBundleRuntimePath(publishFrom)
          : toPublishRuntimePath(value, publishFrom),
    };
  }

  if (!isRecord(value)) return value;

  const sourceEntrypoint = collectFirstSourceEntrypoint(value);
  const rewritten: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && isSourceEntrypoint(nested)) {
      rewritten[key] =
        key === "types"
          ? toPublishDeclarationPath(nested, publishFrom)
          : bundleStrategy === "single" && runtimeConditions.has(key)
            ? toSingleBundleRuntimePath(publishFrom)
            : toPublishRuntimePath(nested, publishFrom);
      continue;
    }

    rewritten[key] = rewriteExportForPublish(nested, publishFrom, bundleStrategy);
  }

  if (sourceEntrypoint && typeof rewritten.types !== "string") {
    return { types: toPublishDeclarationPath(sourceEntrypoint, publishFrom), ...rewritten };
  }

  return rewritten;
}

export function preparePublishPackageMetadata(
  packageRecord: Record<string, unknown>,
  publishFrom: string,
  options: { readonly bundleStrategy?: PublishBundleStrategy | undefined } = {},
): Record<string, unknown> {
  const bundleStrategy = options.bundleStrategy === "single" ? "single" : "split";
  const nextPackageRecord: Record<string, unknown> = JSON.parse(
    JSON.stringify(packageRecord),
  ) as Record<string, unknown>;
  delete nextPackageRecord.devDependencies;

  const sourceEntrypoint = collectFirstSourceEntrypoint(nextPackageRecord.exports);

  if (sourceEntrypoint) {
    nextPackageRecord.types = toPublishDeclarationPath(sourceEntrypoint, publishFrom);
  } else if (
    typeof nextPackageRecord.types === "string" &&
    isSourceEntrypoint(nextPackageRecord.types)
  ) {
    nextPackageRecord.types = toPublishDeclarationPath(nextPackageRecord.types, publishFrom);
  }

  if (isRecord(nextPackageRecord.exports)) {
    const exportsValue = nextPackageRecord.exports;
    const hasSubpathExports = Object.keys(exportsValue).some((key) => key.startsWith("."));

    nextPackageRecord.exports = hasSubpathExports
      ? Object.fromEntries(
          Object.entries(exportsValue).map(([key, value]) => [
            key,
            rewriteExportForPublish(value, publishFrom, bundleStrategy),
          ]),
        )
      : rewriteExportForPublish(exportsValue, publishFrom, bundleStrategy);
  } else if (nextPackageRecord.exports) {
    nextPackageRecord.exports = rewriteExportForPublish(
      nextPackageRecord.exports,
      publishFrom,
      bundleStrategy,
    );
  }

  for (const field of ["main", "module"] as const) {
    if (
      typeof nextPackageRecord[field] === "string" &&
      isSourceEntrypoint(nextPackageRecord[field])
    ) {
      nextPackageRecord[field] =
        bundleStrategy === "single"
          ? toSingleBundleRuntimePath(publishFrom)
          : toPublishRuntimePath(nextPackageRecord[field], publishFrom);
    }
  }

  if (typeof nextPackageRecord.bin === "string" && isSourceEntrypoint(nextPackageRecord.bin)) {
    nextPackageRecord.bin =
      bundleStrategy === "single"
        ? toSingleBundleRuntimePath(publishFrom).replace(/^\.\//, "")
        : toPublishBinPath(nextPackageRecord.bin, publishFrom);
  } else if (isRecord(nextPackageRecord.bin)) {
    nextPackageRecord.bin = Object.fromEntries(
      Object.entries(nextPackageRecord.bin).map(([name, value]) => [
        name,
        typeof value === "string" && isSourceEntrypoint(value)
          ? bundleStrategy === "single"
            ? toSingleBundleRuntimePath(publishFrom).replace(/^\.\//, "")
            : toPublishBinPath(value, publishFrom)
          : value,
      ]),
    );
  }

  if (Array.isArray(nextPackageRecord.sideEffects)) {
    nextPackageRecord.sideEffects = nextPackageRecord.sideEffects.map((value) =>
      typeof value === "string" && isSourceEntrypoint(value)
        ? bundleStrategy === "single"
          ? toSingleBundleRuntimePath(publishFrom)
          : toPublishRuntimePath(value, publishFrom)
        : value,
    );
  }

  return nextPackageRecord;
}

function isInsidePublishFrom(path: string, publishFrom: string): boolean {
  const normalizedPath = path.startsWith("./") ? path.slice(2) : path;
  const normalizedPublishFrom = publishFrom.replace(/^\.\//, "").replace(/\/$/, "");

  return (
    normalizedPath === normalizedPublishFrom ||
    normalizedPath.startsWith(`${normalizedPublishFrom}/`)
  );
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

interface PublishFileReference {
  readonly field: string;
  readonly path: string;
}

function normalizeFileReferencePath(value: string): string {
  return value.replace(/^\.\//, "");
}

function collectExportFileReferences(
  value: unknown,
  field: string,
  references: PublishFileReference[],
): void {
  if (typeof value === "string") {
    if (isPackageRelativePath(value) && !isPublishFilePattern(value)) {
      references.push({ field, path: value });
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    const nextField = key.startsWith(".") ? `${field}[${key}]` : `${field}.${key}`;
    collectExportFileReferences(nested, nextField, references);
  }
}

function collectPublishFileReferences(
  packageJson: Record<string, unknown>,
): PublishFileReference[] {
  const references: PublishFileReference[] = [];

  for (const field of ["main", "module", "types"] as const) {
    const value = packageJson[field];
    if (typeof value === "string" && isPackageRelativePath(value) && !isPublishFilePattern(value)) {
      references.push({ field, path: value });
    }
  }

  if (typeof packageJson.bin === "string" && !isPublishFilePattern(packageJson.bin)) {
    references.push({ field: "bin", path: packageJson.bin });
  } else if (isRecord(packageJson.bin)) {
    for (const [name, value] of Object.entries(packageJson.bin)) {
      if (typeof value === "string" && !isPublishFilePattern(value)) {
        references.push({ field: `bin.${name}`, path: value });
      }
    }
  }

  if (packageJson.exports) {
    collectExportFileReferences(packageJson.exports, "exports", references);
  }

  return references;
}

function hasPublishSubpathExports(packageJson: Record<string, unknown>): boolean {
  return (
    isRecord(packageJson.exports) &&
    Object.keys(packageJson.exports).some((key) => key.startsWith(".") && key !== ".")
  );
}

function hasSourcePublishBin(packageJson: Record<string, unknown>): boolean {
  if (typeof packageJson.bin === "string") {
    return isSourceEntrypoint(packageJson.bin);
  }

  if (!isRecord(packageJson.bin)) return false;

  return Object.values(packageJson.bin).some(
    (value) => typeof value === "string" && isSourceEntrypoint(value),
  );
}

function resolvePublishBundleStrategy(options: {
  readonly packageJson: Record<string, unknown>;
  readonly requested: PublishBundleStrategy | undefined;
  readonly target: RequestedTarget;
}): Exclude<PublishBundleStrategy, "auto"> {
  if (options.requested === "single" || options.requested === "split") {
    return options.requested;
  }

  if (
    options.target.label.startsWith("plugins/") &&
    hasPublishSubpathExports(options.packageJson)
  ) {
    return "split";
  }

  if (options.target.label.startsWith("plugins/") || hasSourcePublishBin(options.packageJson)) {
    return "single";
  }

  return "split";
}

function validatePublishBundlePolicy(options: {
  readonly bundleStrategy: Exclude<PublishBundleStrategy, "auto">;
  readonly packageJson: Record<string, unknown>;
}): string | undefined {
  if (options.bundleStrategy !== "single") return undefined;

  if (hasPublishSubpathExports(options.packageJson)) {
    return "bundle strategy single requires package exports to expose only the root export; subpath runtime exports need --bundle-strategy split";
  }

  return undefined;
}

async function validatePublishFileReferences(options: {
  readonly packageDir: string;
  readonly packageJson: Record<string, unknown>;
}): Promise<string | undefined> {
  const missing: string[] = [];
  const references = collectPublishFileReferences(options.packageJson);

  for (const reference of references) {
    const relativePath = normalizeFileReferencePath(reference.path);
    if (!(await fileExists(resolve(options.packageDir, relativePath)))) {
      missing.push(`${reference.field}:${reference.path}`);
    }
  }

  return missing.length > 0 ? `missing publish file references: ${missing.join(", ")}` : undefined;
}

export async function resolvePublishableTargets(options: {
  readonly bundleStrategy?: PublishBundleStrategy | undefined;
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

    const bundleStrategy = resolvePublishBundleStrategy({
      packageJson: packageRecord,
      requested: options.bundleStrategy,
      target,
    });
    const bundlePolicyReason = validatePublishBundlePolicy({
      bundleStrategy,
      packageJson: packageRecord,
    });
    if (bundlePolicyReason) {
      skipped.push({ label: target.label, reason: bundlePolicyReason });
      continue;
    }

    const publishPackageRecord = preparePublishPackageMetadata(packageRecord, options.publishFrom, {
      bundleStrategy,
    });
    const declarationArtifactReason = await validatePublishDeclarationArtifacts({
      packageDir: target.cwd,
      packageJson: publishPackageRecord,
      publishFrom: options.publishFrom,
    });
    if (declarationArtifactReason) {
      skipped.push({ label: target.label, reason: declarationArtifactReason });
      continue;
    }

    const fileReferenceReason = await validatePublishFileReferences({
      packageDir: target.cwd,
      packageJson: publishPackageRecord,
    });
    if (fileReferenceReason) {
      skipped.push({ label: target.label, reason: fileReferenceReason });
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
