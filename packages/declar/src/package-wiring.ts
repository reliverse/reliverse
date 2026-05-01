import { writeFile as defaultWriteFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDeclarError, createDeclarWarning } from "./diagnostics";
import type { DeclarDiagnostic, DeclarEntrypoint, DeclarPackageJson } from "./types";

export interface DeclarPackageTypesWiringHost {
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
}

export interface DeclarPackageTypesWiringOptions {
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly host?: DeclarPackageTypesWiringHost | undefined;
  readonly packageDir?: string | undefined;
  readonly packageJson: DeclarPackageJson & Record<string, unknown>;
  readonly packageJsonPath?: string | undefined;
  readonly write?: boolean | undefined;
}

export interface DeclarPackageTypesWiringResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly packageJson: Record<string, unknown>;
  readonly packageJsonPath?: string | undefined;
  readonly wrotePackageJson: boolean;
}

function clonePackageJson(packageJson: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(packageJson)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasSubpathExports(exportsValue: Record<string, unknown>): boolean {
  return Object.keys(exportsValue).some((key) => key.startsWith("."));
}

function getRootEntrypoint(entrypoints: readonly DeclarEntrypoint[]): DeclarEntrypoint | undefined {
  return entrypoints.find((entrypoint) => entrypoint.exportPath === ".");
}

function getPreferredTypesPath(entrypoint: DeclarEntrypoint): string | undefined {
  return (
    entrypoint.typesPath ??
    entrypoint.defaultTypesPath ??
    entrypoint.importTypesPath ??
    entrypoint.requireTypesPath ??
    entrypoint.typesConditions[0]?.path
  );
}

function getTypesConditionEntries(
  entrypoint: DeclarEntrypoint,
): readonly { readonly condition: string; readonly path: string }[] {
  if (entrypoint.typesConditions.length > 0) {
    return entrypoint.typesConditions;
  }

  const preferredTypesPath = getPreferredTypesPath(entrypoint);

  return preferredTypesPath ? [{ condition: "types", path: preferredTypesPath }] : [];
}

function setPropertyFirst(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const nextTarget: Record<string, unknown> = { [key]: value };

  for (const [targetKey, targetValue] of Object.entries(target)) {
    if (targetKey !== key) {
      nextTarget[targetKey] = targetValue;
    }
  }

  return nextTarget;
}

function wireTypesCondition(
  exportPath: string,
  exportValue: Record<string, unknown>,
  condition: string,
  targetPath: string,
  diagnostics: DeclarDiagnostic[],
): Record<string, unknown> {
  const nestedCondition = condition.split(".");

  if (nestedCondition.length === 1) {
    return setPropertyFirst(exportValue, condition, targetPath);
  }

  if (nestedCondition.length !== 2) {
    diagnostics.push(
      createDeclarWarning(
        "DECLAR_PACKAGE_WIRING_UNSUPPORTED",
        `Declar cannot wire nested types condition ${condition} for export ${exportPath}.`,
        ["package.json", "exports", exportPath],
      ),
    );
    return exportValue;
  }

  const runtimeCondition = nestedCondition[0];
  const typesCondition = nestedCondition[1];

  if (!runtimeCondition || !typesCondition) {
    return exportValue;
  }

  const runtimeValue = exportValue[runtimeCondition];

  if (!isRecord(runtimeValue)) {
    diagnostics.push(
      createDeclarWarning(
        "DECLAR_PACKAGE_WIRING_UNSUPPORTED",
        `Declar cannot wire ${condition} for export ${exportPath} because ${runtimeCondition} is not an object condition.`,
        ["package.json", "exports", exportPath, runtimeCondition],
      ),
    );
    return exportValue;
  }

  return {
    ...exportValue,
    [runtimeCondition]: setPropertyFirst(runtimeValue, typesCondition, targetPath),
  };
}

function wireEntrypointTypes(
  packageJson: Record<string, unknown>,
  entrypoint: DeclarEntrypoint,
  diagnostics: DeclarDiagnostic[],
): void {
  const exportsValue = packageJson.exports;

  if (!isRecord(exportsValue)) {
    diagnostics.push(
      createDeclarWarning(
        "DECLAR_PACKAGE_WIRING_UNSUPPORTED",
        "Declar can only wire package exports when package.json#exports is an object.",
        ["package.json", "exports"],
      ),
    );
    return;
  }

  const subpathExports = hasSubpathExports(exportsValue);
  const exportValue = subpathExports ? exportsValue[entrypoint.exportPath] : exportsValue;

  if (!isRecord(exportValue)) {
    diagnostics.push(
      createDeclarWarning(
        "DECLAR_PACKAGE_WIRING_UNSUPPORTED",
        `Declar can only wire object export entries. Export ${entrypoint.exportPath} is not an object.`,
        ["package.json", "exports", entrypoint.exportPath],
      ),
    );
    return;
  }

  let nextExportValue = exportValue;

  for (const typesCondition of getTypesConditionEntries(entrypoint)) {
    nextExportValue = wireTypesCondition(
      entrypoint.exportPath,
      nextExportValue,
      typesCondition.condition,
      typesCondition.path,
      diagnostics,
    );
  }

  if (subpathExports) {
    packageJson.exports = {
      ...exportsValue,
      [entrypoint.exportPath]: nextExportValue,
    };
    return;
  }

  packageJson.exports = nextExportValue;
}

function resolvePackageJsonPath(options: DeclarPackageTypesWiringOptions): string | undefined {
  if (options.packageJsonPath) {
    return resolve(options.packageJsonPath);
  }

  if (options.packageDir) {
    return resolve(options.packageDir, "package.json");
  }

  return undefined;
}

function serializePackageJson(packageJson: Record<string, unknown>): string {
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

export async function wireDeclarPackageTypes(
  options: DeclarPackageTypesWiringOptions,
): Promise<DeclarPackageTypesWiringResult> {
  const packageJson = clonePackageJson(options.packageJson);
  const diagnostics: DeclarDiagnostic[] = [];
  const rootEntrypoint = getRootEntrypoint(options.entrypoints);
  const rootTypesPath = rootEntrypoint ? getPreferredTypesPath(rootEntrypoint) : undefined;

  if (rootTypesPath) {
    packageJson.types = rootTypesPath;
  }

  for (const entrypoint of options.entrypoints) {
    wireEntrypointTypes(packageJson, entrypoint, diagnostics);
  }

  const packageJsonPath = resolvePackageJsonPath(options);

  if (options.write !== true) {
    return {
      diagnostics,
      packageJson,
      packageJsonPath,
      wrotePackageJson: false,
    };
  }

  if (!packageJsonPath) {
    diagnostics.push(
      createDeclarError(
        "DECLAR_PACKAGE_JSON_WRITE_FAILED",
        "Declar cannot write package.json because neither packageDir nor packageJsonPath was provided.",
        ["package.json"],
      ),
    );

    return {
      diagnostics,
      packageJson,
      packageJsonPath,
      wrotePackageJson: false,
    };
  }

  try {
    const writeFile =
      options.host?.writeFile ?? ((path, contents) => defaultWriteFile(path, contents));
    await writeFile(packageJsonPath, serializePackageJson(packageJson));
  } catch {
    diagnostics.push(
      createDeclarError(
        "DECLAR_PACKAGE_JSON_WRITE_FAILED",
        `Declar could not write package metadata to ${packageJsonPath}.`,
        [packageJsonPath],
      ),
    );

    return {
      diagnostics,
      packageJson,
      packageJsonPath,
      wrotePackageJson: false,
    };
  }

  return {
    diagnostics,
    packageJson,
    packageJsonPath,
    wrotePackageJson: true,
  };
}
