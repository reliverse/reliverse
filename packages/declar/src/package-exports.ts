import type {
  DeclarConditionPath,
  DeclarEntrypoint,
  DeclarEntrypointKind,
  DeclarPackageJson,
  DeclarDiagnostic,
} from "./types";

interface EntrypointDiscoveryResult {
  readonly entrypoints: readonly DeclarEntrypoint[];
  readonly diagnostics: readonly DeclarDiagnostic[];
}

interface EntrypointDiscoveryValueResult {
  readonly entrypoint?: DeclarEntrypoint | undefined;
  readonly diagnostics: readonly DeclarDiagnostic[];
}

interface TargetReadResult {
  readonly path?: string | undefined;
  readonly runtimeConditions: readonly DeclarConditionPath[];
  readonly typesPath?: string | undefined;
  readonly typesConditions: readonly DeclarConditionPath[];
  readonly diagnostics: readonly DeclarDiagnostic[];
}

interface DirectTypesReadResult {
  readonly typesPath?: string | undefined;
  readonly typesConditions: readonly DeclarConditionPath[];
  readonly diagnostics: readonly DeclarDiagnostic[];
}

const runtimeConditionKeys = new Set(["default", "import", "require"]);
const sourceConditionKeys = new Set(["source"]);
const typeConditionAliases = new Set(["types", "typings"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isTypesConditionKey(key: string): boolean {
  return typeConditionAliases.has(key) || key.startsWith("types@");
}

function normalizeExportPath(exportPath: string): string {
  if (exportPath === ".") return ".";
  return exportPath.startsWith("./") ? exportPath : `./${exportPath}`;
}

function getEntrypointKind(exportPath: string): DeclarEntrypointKind {
  if (exportPath === ".") return "root";
  return exportPath.includes("*") ? "pattern" : "subpath";
}

function createDiagnostic(
  code: DeclarDiagnostic["code"],
  message: string,
  path: readonly string[],
): DeclarDiagnostic {
  return { code, message, path, severity: "warning" };
}

function createEntrypointDiscoveryResult(
  entrypoints: readonly DeclarEntrypoint[],
  diagnostics: readonly DeclarDiagnostic[],
): EntrypointDiscoveryResult {
  return { diagnostics, entrypoints };
}

function createRelativeTargetDiagnostic(
  targetPath: string,
  path: readonly string[],
): DeclarDiagnostic | undefined {
  if (targetPath.startsWith("./")) return undefined;

  return createDiagnostic(
    "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
    `Export target ${targetPath} should be a relative path starting with "./".`,
    path,
  );
}

function createTypesOrderDiagnostic(
  value: Record<string, unknown>,
  path: readonly string[],
): DeclarDiagnostic | undefined {
  const keys = Object.keys(value);
  const hasTypesCondition = keys.some(isTypesConditionKey);
  const firstKey = keys[0];

  if (!hasTypesCondition || !firstKey || isTypesConditionKey(firstKey)) {
    return undefined;
  }

  return createDiagnostic(
    "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST",
    `Types condition should be the first condition, but "${firstKey}" appears first.`,
    path,
  );
}

function readExportTargetPath(
  value: unknown,
  condition: string,
  path: readonly string[],
): {
  readonly path?: string | undefined;
  readonly diagnostics: readonly DeclarDiagnostic[];
} {
  if (value === undefined || value === null) {
    return { diagnostics: [] };
  }

  if (typeof value !== "string") {
    return {
      diagnostics: [
        createDiagnostic(
          "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
          `Export condition "${condition}" must point to a string target for Declar milestone 1.`,
          path,
        ),
      ],
    };
  }

  const relativeTargetDiagnostic = createRelativeTargetDiagnostic(value, path);

  return {
    path: value,
    diagnostics: relativeTargetDiagnostic ? [relativeTargetDiagnostic] : [],
  };
}

function readDirectTypes(
  value: Record<string, unknown>,
  path: readonly string[],
): DirectTypesReadResult {
  const diagnostics: DeclarDiagnostic[] = [];
  const typesConditions: DeclarConditionPath[] = [];
  let typesPath: string | undefined;

  for (const [condition, conditionValue] of Object.entries(value)) {
    if (!isTypesConditionKey(condition)) continue;

    const result = readExportTargetPath(conditionValue, condition, [...path, condition]);
    diagnostics.push(...result.diagnostics);

    if (result.path) {
      typesPath ??= result.path;
      typesConditions.push({
        condition,
        path: result.path,
      });
    }
  }

  return {
    typesPath,
    typesConditions,
    diagnostics,
  };
}

function readConditionalTarget(
  condition: string,
  value: unknown,
  path: readonly string[],
): TargetReadResult {
  if (value === undefined || value === null) {
    return {
      runtimeConditions: [],
      typesConditions: [],
      diagnostics: [],
    };
  }

  if (typeof value === "string") {
    const result = readExportTargetPath(value, condition, path);

    return {
      path: result.path,
      runtimeConditions: result.path
        ? [
            {
              condition,
              path: result.path,
            },
          ]
        : [],
      typesConditions: [],
      diagnostics: result.diagnostics,
    };
  }

  if (!isRecord(value)) {
    return {
      runtimeConditions: [],
      typesConditions: [],
      diagnostics: [
        createDiagnostic(
          "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
          `Export condition "${condition}" uses an unsupported shape.`,
          path,
        ),
      ],
    };
  }

  const diagnostics: DeclarDiagnostic[] = [];
  const runtimeConditions: DeclarConditionPath[] = [];

  const orderDiagnostic = createTypesOrderDiagnostic(value, path);
  if (orderDiagnostic) diagnostics.push(orderDiagnostic);

  const directTypes = readDirectTypes(value, path);
  diagnostics.push(...directTypes.diagnostics);

  const defaultResult = readExportTargetPath(value.default, `${condition}.default`, [
    ...path,
    "default",
  ]);
  diagnostics.push(...defaultResult.diagnostics);

  if (defaultResult.path) {
    runtimeConditions.push({
      condition: `${condition}.default`,
      path: defaultResult.path,
    });
  }

  for (const [nestedCondition, nestedValue] of Object.entries(value)) {
    if (nestedCondition === "default" || isTypesConditionKey(nestedCondition)) {
      continue;
    }

    if (nestedValue === null || nestedValue === undefined) {
      continue;
    }

    if (typeof nestedValue === "string") {
      const nestedResult = readExportTargetPath(nestedValue, `${condition}.${nestedCondition}`, [
        ...path,
        nestedCondition,
      ]);
      diagnostics.push(...nestedResult.diagnostics);

      if (nestedResult.path) {
        runtimeConditions.push({
          condition: `${condition}.${nestedCondition}`,
          path: nestedResult.path,
        });
      }
    }

    diagnostics.push(
      createDiagnostic(
        "DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED",
        `Nested export condition "${condition}.${nestedCondition}" is preserved in diagnostics but cannot be flattened into a primary Declar target yet.`,
        [...path, nestedCondition],
      ),
    );
  }

  return {
    path: defaultResult.path,
    runtimeConditions,
    typesPath: directTypes.typesPath,
    typesConditions: directTypes.typesConditions,
    diagnostics,
  };
}

function readUnknownRuntimeConditions(
  value: Record<string, unknown>,
  path: readonly string[],
): {
  readonly runtimeConditions: readonly DeclarConditionPath[];
  readonly diagnostics: readonly DeclarDiagnostic[];
} {
  const runtimeConditions: DeclarConditionPath[] = [];
  const diagnostics: DeclarDiagnostic[] = [];

  for (const [condition, conditionValue] of Object.entries(value)) {
    if (
      runtimeConditionKeys.has(condition) ||
      sourceConditionKeys.has(condition) ||
      isTypesConditionKey(condition)
    ) {
      continue;
    }

    if (conditionValue === null || conditionValue === undefined) {
      continue;
    }

    if (typeof conditionValue === "string") {
      const result = readExportTargetPath(conditionValue, condition, [...path, condition]);
      diagnostics.push(...result.diagnostics);

      if (result.path) {
        runtimeConditions.push({
          condition,
          path: result.path,
        });
      }
    }

    diagnostics.push(
      createDiagnostic(
        "DECLAR_EXPORT_CONDITION_UNSUPPORTED",
        `Export condition "${condition}" is not a primary Declar condition yet.`,
        [...path, condition],
      ),
    );
  }

  return { runtimeConditions, diagnostics };
}

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
): EntrypointDiscoveryValueResult {
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
      entrypoint,
      diagnostics: [
        ...result.diagnostics,
        createDiagnostic(
          "DECLAR_EXPORT_MISSING_TYPES",
          `Export ${normalizedExportPath} does not declare a types condition.`,
          path,
        ),
      ],
    };
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        createDiagnostic(
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
      createDiagnostic(
        "DECLAR_EXPORT_MISSING_TYPES",
        `Export ${normalizedExportPath} does not declare a types condition.`,
        path,
      ),
    );
  }

  if (!hasRuntimeTarget(entrypoint)) {
    diagnostics.push(
      createDiagnostic(
        "DECLAR_EXPORT_MISSING_RUNTIME_TARGET",
        `Export ${normalizedExportPath} does not declare an import, require, default, or supported runtime condition.`,
        path,
      ),
    );
  }

  if (entrypoint.kind === "pattern" && hasTypes(entrypoint)) {
    diagnostics.push(
      createDiagnostic(
        "DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED",
        `Export pattern ${normalizedExportPath} declares types, but pattern targets cannot be fully verified until Declar has filesystem-aware validation.`,
        path,
      ),
    );
  }

  return { entrypoint, diagnostics };
}

function entrypointFromLegacyPackageFields(
  packageJson: DeclarPackageJson,
): EntrypointDiscoveryResult {
  const diagnostics: DeclarDiagnostic[] = [];
  const entrypoints: DeclarEntrypoint[] = [];

  const typesPath = packageJson.types ?? packageJson.typings;
  const importPath = packageJson.module;
  const requirePath = packageJson.main;
  const defaultPath = importPath ?? requirePath;

  if (!defaultPath && !typesPath) {
    return createEntrypointDiscoveryResult(entrypoints, [
      createDiagnostic(
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
      createDiagnostic(
        "DECLAR_EXPORT_MISSING_TYPES",
        "Root package entrypoint does not declare package.json#types.",
        ["package.json", "types"],
      ),
    );
  }

  return createEntrypointDiscoveryResult(entrypoints, diagnostics);
}

export function discoverPackageEntrypoints(
  packageJson: DeclarPackageJson,
): EntrypointDiscoveryResult {
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
      createDiagnostic(
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
