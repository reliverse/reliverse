const UNSAFE_SPECIFIER_PREFIXES = ["workspace:", "catalog:", "link:", "file:"] as const;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export interface UnsafeDependencySpecifier {
  readonly field: (typeof DEPENDENCY_FIELDS)[number];
  readonly name: string;
  readonly specifier: string;
}

export function findUnsafeDependencySpecifiers(pkg: Record<string, unknown>): UnsafeDependencySpecifier[] {
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
