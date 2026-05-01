import { createDeclarDiagnostic } from "../diagnostics";
import type { DeclarConditionPath, DeclarDiagnostic } from "../types";
import {
  isRecord,
  isTypesConditionKey,
  runtimeConditionKeys,
  sourceConditionKeys,
} from "./conditions";
import { isRelativePackageTarget } from "./normalize";

export interface TargetReadResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly path?: string | undefined;
  readonly runtimeConditions: readonly DeclarConditionPath[];
  readonly typesConditions: readonly DeclarConditionPath[];
  readonly typesPath?: string | undefined;
}

export interface DirectTypesReadResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly typesConditions: readonly DeclarConditionPath[];
  readonly typesPath?: string | undefined;
}

export interface RuntimeConditionsReadResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly runtimeConditions: readonly DeclarConditionPath[];
}

export function createRelativeTargetDiagnostic(
  targetPath: string,
  path: readonly string[],
): DeclarDiagnostic | undefined {
  if (isRelativePackageTarget(targetPath)) return undefined;

  return createDeclarDiagnostic(
    "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
    `Export target ${targetPath} should be a relative path starting with "./".`,
    path,
  );
}

export function createTypesOrderDiagnostic(
  value: Record<string, unknown>,
  path: readonly string[],
): DeclarDiagnostic | undefined {
  const keys = Object.keys(value);
  const hasTypesCondition = keys.some(isTypesConditionKey);
  const firstKey = keys[0];

  if (!hasTypesCondition || !firstKey || isTypesConditionKey(firstKey)) {
    return undefined;
  }

  return createDeclarDiagnostic(
    "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST",
    `Types condition should be the first condition, but "${firstKey}" appears first.`,
    path,
  );
}

export function readExportTargetPath(
  value: unknown,
  condition: string,
  path: readonly string[],
): {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly path?: string | undefined;
} {
  if (value === undefined || value === null) {
    return { diagnostics: [] };
  }

  if (typeof value !== "string") {
    return {
      diagnostics: [
        createDeclarDiagnostic(
          "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
          `Export condition "${condition}" must point to a string target for Declar milestone 1.`,
          path,
        ),
      ],
    };
  }

  const relativeTargetDiagnostic = createRelativeTargetDiagnostic(value, path);

  return {
    diagnostics: relativeTargetDiagnostic ? [relativeTargetDiagnostic] : [],
    path: value,
  };
}

export function readDirectTypes(
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
    diagnostics,
    typesConditions,
    typesPath,
  };
}

export function readConditionalTarget(
  condition: string,
  value: unknown,
  path: readonly string[],
): TargetReadResult {
  if (value === undefined || value === null) {
    return {
      diagnostics: [],
      runtimeConditions: [],
      typesConditions: [],
    };
  }

  if (typeof value === "string") {
    const result = readExportTargetPath(value, condition, path);

    return {
      diagnostics: result.diagnostics,
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
    };
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        createDeclarDiagnostic(
          "DECLAR_EXPORT_UNSUPPORTED_SHAPE",
          `Export condition "${condition}" uses an unsupported shape.`,
          path,
        ),
      ],
      runtimeConditions: [],
      typesConditions: [],
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
      createDeclarDiagnostic(
        "DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED",
        `Nested export condition "${condition}.${nestedCondition}" is preserved in diagnostics but cannot be flattened into a primary Declar target yet.`,
        [...path, nestedCondition],
      ),
    );
  }

  return {
    diagnostics,
    path: defaultResult.path,
    runtimeConditions,
    typesConditions: directTypes.typesConditions,
    typesPath: directTypes.typesPath,
  };
}

export function readUnknownRuntimeConditions(
  value: Record<string, unknown>,
  path: readonly string[],
): RuntimeConditionsReadResult {
  const diagnostics: DeclarDiagnostic[] = [];
  const runtimeConditions: DeclarConditionPath[] = [];

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
      createDeclarDiagnostic(
        "DECLAR_EXPORT_CONDITION_UNSUPPORTED",
        `Export condition "${condition}" is not a primary Declar condition yet.`,
        [...path, condition],
      ),
    );
  }

  return {
    diagnostics,
    runtimeConditions,
  };
}
