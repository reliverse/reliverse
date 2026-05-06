const UNSAFE_SPECIFIER_PREFIXES = ["workspace:", "catalog:", "link:", "file:"] as const;
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

export interface UnsafeDependencySpecifier {
  readonly field: (typeof DEPENDENCY_FIELDS)[number];
  readonly name: string;
  readonly specifier: string;
}

export interface NormalizePublishDependencySpecifiersOptions {
  readonly catalog?: ReadonlyMap<string, string> | undefined;
  readonly workspaceVersions?: ReadonlyMap<string, string> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveWorkspaceSpecifier(
  name: string,
  specifier: string,
  workspaceVersions: ReadonlyMap<string, string>,
): string | undefined {
  const version = workspaceVersions.get(name);
  if (!version) return undefined;

  const range = specifier.slice("workspace:".length).trim();
  if (range === "" || range === "*" || range === "^") return `^${version}`;
  if (range === "~") return `~${version}`;
  if (range === version) return version;
  if (
    range.startsWith("^") ||
    range.startsWith("~") ||
    range.startsWith(">") ||
    range.startsWith("<") ||
    range.startsWith("=")
  ) {
    return range;
  }

  return version;
}

function resolveCatalogSpecifier(
  name: string,
  specifier: string,
  catalog: ReadonlyMap<string, string>,
): string | undefined {
  if (specifier !== "catalog:" && specifier !== "catalog:default") return undefined;

  return catalog.get(name);
}

export function normalizePublishDependencySpecifiers(
  pkg: Record<string, unknown>,
  options: NormalizePublishDependencySpecifiersOptions,
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
  const workspaceVersions = options.workspaceVersions ?? new Map<string, string>();
  const catalog = options.catalog ?? new Map<string, string>();

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = next[field];
    if (!isRecord(dependencies)) continue;

    for (const [name, rawSpecifier] of Object.entries(dependencies)) {
      if (typeof rawSpecifier !== "string") continue;

      const resolved = rawSpecifier.startsWith("workspace:")
        ? resolveWorkspaceSpecifier(name, rawSpecifier, workspaceVersions)
        : rawSpecifier.startsWith("catalog:")
          ? resolveCatalogSpecifier(name, rawSpecifier, catalog)
          : undefined;

      if (resolved) {
        dependencies[name] = resolved;
      }
    }
  }

  return next;
}

export function findUnsafeDependencySpecifiers(
  pkg: Record<string, unknown>,
): UnsafeDependencySpecifier[] {
  const found: UnsafeDependencySpecifier[] = [];

  for (const field of DEPENDENCY_FIELDS) {
    const record = pkg[field];
    if (!record || typeof record !== "object") {
      continue;
    }

    for (const [name, specifier] of Object.entries(record as Record<string, unknown>)) {
      if (typeof specifier !== "string") {
        continue;
      }

      if (UNSAFE_SPECIFIER_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        found.push({ field, name, specifier });
      }
    }
  }

  return found;
}
