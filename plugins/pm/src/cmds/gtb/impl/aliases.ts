export type GtbAlias = {
  name: string;
  packageName: string;
  description: string;
  defaultTag?: string;
};

const GTB_ALIASES: GtbAlias[] = [
  {
    name: "tsgo",
    packageName: "@typescript/native-preview",
    defaultTag: "beta",
    description: "TypeScript 7 native preview package that provides the tsgo binary.",
  },
  {
    name: "typescript-native",
    packageName: "@typescript/native-preview",
    defaultTag: "beta",
    description: "Alias for the TypeScript native preview package.",
  },
  {
    name: "ts-native",
    packageName: "@typescript/native-preview",
    defaultTag: "beta",
    description: "Short alias for the TypeScript native preview package.",
  },
];

export function resolveGtbAlias(aliasName: string): GtbAlias | undefined {
  const normalized = normalizeAliasName(aliasName);

  return GTB_ALIASES.find((alias) => normalizeAliasName(alias.name) === normalized);
}

export function listGtbAliases(): GtbAlias[] {
  return [...GTB_ALIASES];
}

function normalizeAliasName(value: string): string {
  return value.trim().toLowerCase();
}
