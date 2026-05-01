import { access as defaultAccess } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { createDeclarError } from "./diagnostics";
import type { DeclarConditionPath, DeclarDiagnostic, DeclarEntrypoint } from "./types";

export interface DeclarFileSystemHost {
  readonly access: (path: string) => Promise<void>;
}

export interface DeclarEntrypointFileValidationOptions {
  readonly checkRuntimeTargets?: boolean | undefined;
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly host?: DeclarFileSystemHost | undefined;
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

const defaultHost: DeclarFileSystemHost = {
  access: defaultAccess,
};

function isPatternTarget(targetPath: string): boolean {
  return targetPath.includes("*");
}

function normalizePackageDir(packageDir: string): string {
  return resolve(packageDir);
}

function isInsidePackage(packageDir: string, targetPath: string): boolean {
  const resolvedTarget = resolve(packageDir, targetPath);
  return resolvedTarget === packageDir || resolvedTarget.startsWith(`${packageDir}${sep}`);
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

function createOutsidePackageDiagnostic(target: DeclarValidationTarget): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TARGET_OUTSIDE_PACKAGE",
    `Export ${target.exportPath} declares ${target.condition} at ${target.path}, but the target resolves outside the package directory.`,
    ["package.json", "exports", target.exportPath],
  );
}

async function validateTarget(
  packageDir: string,
  host: DeclarFileSystemHost,
  target: DeclarValidationTarget,
): Promise<readonly DeclarDiagnostic[]> {
  if (isPatternTarget(target.path)) {
    return [];
  }

  if (!isInsidePackage(packageDir, target.path)) {
    return [createOutsidePackageDiagnostic(target)];
  }

  try {
    await host.access(resolve(packageDir, target.path));
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

export function collectDeclarConditionPaths(
  entrypoint: DeclarEntrypoint,
): readonly DeclarConditionPath[] {
  return [...entrypoint.typesConditions, ...entrypoint.runtimeConditions];
}
