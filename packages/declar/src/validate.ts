import { access as defaultAccess, readdir } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

import { createDeclarError } from "./diagnostics";
import type { DeclarConditionPath, DeclarDiagnostic, DeclarEntrypoint } from "./types";

export interface DeclarFileSystemHost {
  readonly access: (path: string) => Promise<void>;
  readonly readDirectory?: (path: string) => Promise<readonly string[]>;
}

export interface DeclarEntrypointFileValidationOptions {
  readonly checkRuntimeTargets?: boolean | undefined;
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly host?: DeclarFileSystemHost | undefined;
  readonly packageDir: string;
}

export interface DeclarEmittedFileValidationOptions {
  readonly emittedFiles: readonly string[];
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly packageDir: string;
}

export interface DeclarEntrypointFileValidationResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
}

type DeclarTargetKind = "runtime" | "types";

interface DeclarValidationTarget {
  readonly condition: string;
  readonly exportPath: string;
  readonly kind: DeclarTargetKind;
  readonly path: string;
}

async function readFilesRecursive(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await readFilesRecursive(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

const defaultHost: DeclarFileSystemHost = {
  access: defaultAccess,
  readDirectory: readFilesRecursive,
};

function isPatternTarget(targetPath: string): boolean {
  return targetPath.includes("*");
}

function normalizePackageDir(packageDir: string): string {
  return resolve(packageDir);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function resolvePackageTarget(packageDir: string, targetPath: string): string {
  return resolve(packageDir, targetPath);
}

function normalizeAbsolutePath(packageDir: string, path: string): string {
  return normalizePath(isAbsolute(path) ? resolve(path) : resolve(packageDir, path));
}

function isInsidePackage(packageDir: string, targetPath: string): boolean {
  const resolvedTarget = resolvePackageTarget(packageDir, targetPath);
  return resolvedTarget === packageDir || resolvedTarget.startsWith(`${packageDir}${sep}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPackageTargetPattern(packageDir: string, targetPath: string): RegExp {
  const normalizedPattern = normalizePath(resolvePackageTarget(packageDir, targetPath));
  const source = escapeRegExp(normalizedPattern).replaceAll("\\*", ".*");
  return new RegExp(`^${source}$`);
}

function getTargetKey(target: DeclarValidationTarget): string {
  return `${target.kind}:${target.exportPath}:${target.condition}:${target.path}`;
}

function collectEntrypointTargets(
  entrypoints: readonly DeclarEntrypoint[],
  checkRuntimeTargets: boolean,
): readonly DeclarValidationTarget[] {
  const targets = new Map<string, DeclarValidationTarget>();

  for (const entrypoint of entrypoints) {
    for (const condition of entrypoint.typesConditions) {
      const target: DeclarValidationTarget = {
        condition: condition.condition,
        exportPath: entrypoint.exportPath,
        kind: "types",
        path: condition.path,
      };

      targets.set(getTargetKey(target), target);
    }

    if (!checkRuntimeTargets) continue;

    for (const condition of entrypoint.runtimeConditions) {
      const target: DeclarValidationTarget = {
        condition: condition.condition,
        exportPath: entrypoint.exportPath,
        kind: "runtime",
        path: condition.path,
      };

      targets.set(getTargetKey(target), target);
    }
  }

  return [...targets.values()];
}

function collectTypeTargets(
  entrypoints: readonly DeclarEntrypoint[],
): readonly DeclarValidationTarget[] {
  return collectEntrypointTargets(entrypoints, false);
}

function createMissingTargetDiagnostic(target: DeclarValidationTarget): DeclarDiagnostic {
  if (target.kind === "types") {
    return createDeclarError(
      "DECLAR_DECLARATION_TARGET_MISSING",
      `Export ${target.exportPath} declares ${target.condition} at ${target.path}, but the declaration file does not exist.`,
      ["package.json", "exports", target.exportPath],
    );
  }

  return createDeclarError(
    "DECLAR_RUNTIME_TARGET_MISSING",
    `Export ${target.exportPath} declares ${target.condition} at ${target.path}, but the runtime file does not exist.`,
    ["package.json", "exports", target.exportPath],
  );
}

function createNotEmittedTargetDiagnostic(target: DeclarValidationTarget): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_DECLARATION_TARGET_NOT_EMITTED",
    `Export ${target.exportPath} declares ${target.condition} at ${target.path}, but TypeScript did not emit that declaration file.`,
    ["package.json", "exports", target.exportPath],
  );
}

function createOutsidePackageDiagnostic(target: DeclarValidationTarget): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TARGET_OUTSIDE_PACKAGE",
    `Export ${target.exportPath} declares ${target.condition} at ${target.path}, but the target resolves outside the package directory.`,
    ["package.json", "exports", target.exportPath],
  );
}

async function validatePatternTarget(
  packageDir: string,
  host: DeclarFileSystemHost,
  target: DeclarValidationTarget,
): Promise<readonly DeclarDiagnostic[]> {
  if (!host.readDirectory) {
    return [];
  }

  const matcher = createPackageTargetPattern(packageDir, target.path);

  try {
    const files = await host.readDirectory(packageDir);
    const hasMatch = files.some((file) => matcher.test(normalizeAbsolutePath(packageDir, file)));

    return hasMatch ? [] : [createMissingTargetDiagnostic(target)];
  } catch {
    return [createMissingTargetDiagnostic(target)];
  }
}

async function validateTarget(
  packageDir: string,
  host: DeclarFileSystemHost,
  target: DeclarValidationTarget,
): Promise<readonly DeclarDiagnostic[]> {
  if (!isInsidePackage(packageDir, target.path)) {
    return [createOutsidePackageDiagnostic(target)];
  }

  if (isPatternTarget(target.path)) {
    return validatePatternTarget(packageDir, host, target);
  }

  try {
    await host.access(resolvePackageTarget(packageDir, target.path));
    return [];
  } catch {
    return [createMissingTargetDiagnostic(target)];
  }
}

export async function validateDeclarEntrypointFiles(
  options: DeclarEntrypointFileValidationOptions,
): Promise<DeclarEntrypointFileValidationResult> {
  const packageDir = normalizePackageDir(options.packageDir);
  const host = options.host ?? defaultHost;
  const checkRuntimeTargets = options.checkRuntimeTargets ?? false;
  const targets = collectEntrypointTargets(options.entrypoints, checkRuntimeTargets);

  const diagnostics: DeclarDiagnostic[] = [];

  for (const target of targets) {
    diagnostics.push(...(await validateTarget(packageDir, host, target)));
  }

  return {
    diagnostics,
  };
}

export function validateDeclarEmittedFiles(
  options: DeclarEmittedFileValidationOptions,
): DeclarEntrypointFileValidationResult {
  const packageDir = normalizePackageDir(options.packageDir);
  const emittedFiles = new Set(
    options.emittedFiles.map((file) => normalizeAbsolutePath(packageDir, file)),
  );
  const diagnostics: DeclarDiagnostic[] = [];

  for (const target of collectTypeTargets(options.entrypoints)) {
    if (!isInsidePackage(packageDir, target.path)) {
      diagnostics.push(createOutsidePackageDiagnostic(target));
      continue;
    }

    if (isPatternTarget(target.path)) {
      const matcher = createPackageTargetPattern(packageDir, target.path);
      const hasMatch = [...emittedFiles].some((file) => matcher.test(file));

      if (!hasMatch) {
        diagnostics.push(createNotEmittedTargetDiagnostic(target));
      }

      continue;
    }

    const absoluteTarget = normalizeAbsolutePath(packageDir, target.path);

    if (!emittedFiles.has(absoluteTarget)) {
      diagnostics.push(createNotEmittedTargetDiagnostic(target));
    }
  }

  return {
    diagnostics,
  };
}

export function collectDeclarConditionPaths(
  entrypoint: DeclarEntrypoint,
): readonly DeclarConditionPath[] {
  return [...entrypoint.typesConditions, ...entrypoint.runtimeConditions];
}
