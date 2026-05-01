export const runtimeConditionKeys = new Set(["default", "import", "require"]);
export const sourceConditionKeys = new Set(["source"]);
export const typeConditionAliases = new Set(["types", "typings"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTypesConditionKey(key: string): boolean {
  return typeConditionAliases.has(key) || key.startsWith("types@");
}
