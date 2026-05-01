import { createDeclarDiagnostic } from "../diagnostics";
import type {
  DeclarDiagnostic,
  DeclarEntrypoint,
  DeclarEntrypointDiscoveryResult,
  DeclarEntrypointDiscoveryValueResult,
  DeclarPackageJson,
} from "../types";
import { isRecord } from "./conditions";
import { createEntrypointDiscoveryResult, entrypointFromLegacyPackageFields } from "./legacy";
import { getEntrypointKind, normalizeExportPath } from "./normalize";
import {
  createTypesOrderDiagnostic,
  readConditionalTarget,
  readDirectTypes,
  readExportTargetPath,
  readUnknownRuntimeConditions,
} from "./read-target";

function hasTypes(entrypoint: DeclarEntrypoint): boolean {
  return entrypoint.typesConditions.length > 0;
}

function hasRuntimeTarget(entrypoint: DeclarEntrypoint): boolean {
  return entrypoint.runtimeConditions.length > 0;
}

function entrypointFromExportValue(
  exportPath: string,
  value: unknown,
  path: readonly string[],
): DeclarEntrypointDiscoveryValueResult {
  const normalizedExportPath = normalizeExportPath(exportPath);
  const kind = getEntrypointKind(normalizedExportPath);

  if (value === null) {
    return { diagnostics: [] };
  }

  if (typeof value === "string") {
    const result = readExportTargetPath(value, "default", path);
    const runtimeConditions = result.path
      ? [
          {
            condition: "default",
            path: result.path,
          },
        ]
      : [];

    const entrypoint: DeclarEntrypoint = {
      defaultPath: result.path,
      exportPath: normalizedExportPath,
      kind,
      runtimeConditions,
      typesConditions: [],
    };

    return {
      diagnostics: [
        ...result.diagnostics,
        createDeclarDiagnostic(
          "DECLAR_EXPORT_MISSING_TYPES",
          `Export ${normalizedExportPath} does not declare a types condition.`,
          path,
        ),
      ],
      entrypoint,
    };
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        createDeclarDiagnostic(
          "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
          `Export ${normalizedExportPath} uses an unsupported exports shape.`,
          path,
        ),
      ],
    };
  }

  const diagnostics: DeclarDiagnostic[] = [];

  const orderDiagnostic = createTypesOrderDiagnostic(value, path);
  if (orderDiagnostic) diagnostics.push(orderDiagnostic);

  const directTypes = readDirectTypes(value, path);
  diagnostics.push(...directTypes.diagnostics);

  const importTarget = readConditionalTarget("import", value.import, [...path, "import"]);
  diagnostics.push(...importTarget.diagnostics);

  const requireTarget = readConditionalTarget("require", value.require, [...path, "require"]);
  diagnostics.push(...requireTarget.diagnostics);

  const defaultTarget = readConditionalTarget("default", value.default, [...path, "default"]);
  diagnostics.push(...defaultTarget.diagnostics);

  const sourceResult = readExportTargetPath(value.source, "source", [...path, "source"]);
  diagnostics.push(...sourceResult.diagnostics);

  const unknownRuntimeConditions = readUnknownRuntimeConditions(value, path);
  diagnostics.push(...unknownRuntimeConditions.diagnostics);

  const entrypoint: DeclarEntrypoint = {
    defaultPath: defaultTarget.path,
    defaultTypesPath: defaultTarget.typesPath,
    exportPath: normalizedExportPath,
    importPath: importTarget.path,
    importTypesPath: importTarget.typesPath,
    kind,
    requirePath: requireTarget.path,
    requireTypesPath: requireTarget.typesPath,
    runtimeConditions: [
      ...importTarget.runtimeConditions,
      ...requireTarget.runtimeConditions,
      ...defaultTarget.runtimeConditions,
      ...unknownRuntimeConditions.runtimeConditions,
    ],
    sourcePath: sourceResult.path,
    typesConditions: [
      ...directTypes.typesConditions,
      ...importTarget.typesConditions.map((conditionPath) => ({
        condition: `import.${conditionPath.condition}`,
        path: conditionPath.path,
      })),
      ...requireTarget.typesConditions.map((conditionPath) => ({
        condition: `require.${conditionPath.condition}`,
        path: conditionPath.path,
      })),
      ...defaultTarget.typesConditions.map((conditionPath) => ({
        condition: `default.${conditionPath.condition}`,
        path: conditionPath.path,
      })),
    ],
    typesPath: directTypes.typesPath,
  };

  if (!hasTypes(entrypoint)) {
    diagnostics.push(
      createDeclarDiagnostic(
        "DECLAR_EXPORT_MISSING_TYPES",
        `Export ${normalizedExportPath} does not declare a types condition.`,
        path,
      ),
    );
  }

  if (!hasRuntimeTarget(entrypoint)) {
    diagnostics.push(
      createDeclarDiagnostic(
        "DECLAR_EXPORT_MISSING_RUNTIME_TARGET",
        `Export ${normalizedExportPath} does not declare an import, require, default, or supported runtime condition.`,
        path,
      ),
    );
  }

  if (entrypoint.kind === "pattern" && hasTypes(entrypoint)) {
    diagnostics.push(
      createDeclarDiagnostic(
        "DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED",
        `Export pattern ${normalizedExportPath} declares types, but pattern targets cannot be fully verified until Declar has filesystem-aware validation.`,
        path,
      ),
    );
  }

  return {
    diagnostics,
    entrypoint,
  };
}

export function discoverPackageEntrypoints(
  packageJson: DeclarPackageJson,
): DeclarEntrypointDiscoveryResult {
  const diagnostics: DeclarDiagnostic[] = [];
  const entrypoints: DeclarEntrypoint[] = [];

  if (!packageJson.exports) {
    return entrypointFromLegacyPackageFields(packageJson);
  }

  if (typeof packageJson.exports === "string") {
    const result = entrypointFromExportValue(".", packageJson.exports, ["package.json", "exports"]);
    if (result.entrypoint) entrypoints.push(result.entrypoint);
    diagnostics.push(...result.diagnostics);

    return createEntrypointDiscoveryResult(entrypoints, diagnostics);
  }

  if (!isRecord(packageJson.exports)) {
    return createEntrypointDiscoveryResult(entrypoints, [
      createDeclarDiagnostic(
        "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
        "package.json#exports must be a string or object for Declar milestone 1.",
        ["package.json", "exports"],
      ),
    ]);
  }

  const exportEntries = Object.entries(packageJson.exports);
  const usesSubpathMap = exportEntries.some(([key]) => key === "." || key.startsWith("./"));

  if (!usesSubpathMap) {
    const result = entrypointFromExportValue(".", packageJson.exports, ["package.json", "exports"]);
    if (result.entrypoint) entrypoints.push(result.entrypoint);
    diagnostics.push(...result.diagnostics);

    return createEntrypointDiscoveryResult(entrypoints, diagnostics);
  }

  for (const [exportPath, value] of exportEntries) {
    if (exportPath !== "." && !exportPath.startsWith("./")) {
      continue;
    }

    const result = entrypointFromExportValue(exportPath, value, [
      "package.json",
      "exports",
      exportPath,
    ]);

    if (result.entrypoint) entrypoints.push(result.entrypoint);
    diagnostics.push(...result.diagnostics);
  }

  return createEntrypointDiscoveryResult(entrypoints, diagnostics);
}
