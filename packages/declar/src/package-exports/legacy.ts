import { createDeclarDiagnostic } from "../diagnostics";
import type {
  DeclarConditionPath,
  DeclarEntrypoint,
  DeclarEntrypointDiscoveryResult,
  DeclarPackageJson,
} from "../types";

export function createEntrypointDiscoveryResult(
  entrypoints: readonly DeclarEntrypoint[],
  diagnostics: DeclarEntrypointDiscoveryResult["diagnostics"],
): DeclarEntrypointDiscoveryResult {
  return {
    diagnostics,
    entrypoints,
  };
}

export function entrypointFromLegacyPackageFields(
  packageJson: DeclarPackageJson,
): DeclarEntrypointDiscoveryResult {
  const diagnostics: DeclarEntrypointDiscoveryResult["diagnostics"][number][] = [];
  const entrypoints: DeclarEntrypoint[] = [];

  const typesPath = packageJson.types ?? packageJson.typings;
  const importPath = packageJson.module;
  const requirePath = packageJson.main;
  const defaultPath = importPath ?? requirePath;

  if (!defaultPath && !typesPath) {
    return createEntrypointDiscoveryResult(entrypoints, [
      createDeclarDiagnostic(
        "DECLAR_PACKAGE_MISSING_EXPORTS",
        "package.json does not define exports, main, module, types, or typings.",
        ["package.json"],
      ),
    ]);
  }

  const runtimeConditions: DeclarConditionPath[] = [];
  const typesConditions: DeclarConditionPath[] = [];

  if (importPath) {
    runtimeConditions.push({
      condition: "import",
      path: importPath,
    });
  }

  if (requirePath) {
    runtimeConditions.push({
      condition: "require",
      path: requirePath,
    });
  }

  if (!importPath && defaultPath) {
    runtimeConditions.push({
      condition: "default",
      path: defaultPath,
    });
  }

  if (typesPath) {
    typesConditions.push({
      condition: packageJson.types ? "types" : "typings",
      path: typesPath,
    });
  }

  entrypoints.push({
    defaultPath,
    exportPath: ".",
    importPath,
    kind: "root",
    requirePath,
    runtimeConditions,
    typesConditions,
    typesPath,
  });

  if (!typesPath) {
    diagnostics.push(
      createDeclarDiagnostic(
        "DECLAR_EXPORT_MISSING_TYPES",
        "Root package entrypoint does not declare package.json#types.",
        ["package.json", "types"],
      ),
    );
  }

  return createEntrypointDiscoveryResult(entrypoints, diagnostics);
}
