export const DEFAULT_IGNORED_NAMES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".idea",
  ".vscode",
  ".vs",
  ".history",
  ".fleet",
  ".zed",
  ".nova",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".netlify",
  ".output",
  ".serverless",
  ".aws-sam",
  ".cache",
  ".parcel-cache",
  ".eslintcache",
  ".stylelintcache",
  ".rpt2_cache",
  "coverage",
  ".nyc_output",
  ".vitest",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".hypothesis",
  "__pycache__",
  ".gradle",
  ".dart_tool",
  ".pub-cache",
  ".pub",
  ".packages",
  "Pods",
  "DerivedData",
  ".swiftpm",
  ".build",
  ".terraform",
  ".terragrunt-cache",
  ".venv",
  "venv",
  "env",
  "tmp",
  "temp",
  ".tmp",
  ".temp",
  "logs",
  "log",
  ".logs",
  ".pnpm-store",
  ".yarn",
  ".bun",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  "npm-debug.log",
  "yarn-debug.log",
  "yarn-error.log",
  "pnpm-debug.log",
  "lerna-debug.log",
]);

export interface BuildIgnoredNamesOptions {
  readonly includeDefaultIgnores: boolean;
  readonly extraIgnoredNames?: readonly string[];
}

export function buildIgnoredNames(options: BuildIgnoredNamesOptions): readonly string[] {
  const ignoredNames = new Set<string>();

  if (options.includeDefaultIgnores) {
    for (const name of DEFAULT_IGNORED_NAMES) {
      ignoredNames.add(name);
    }
  }

  for (const name of options.extraIgnoredNames ?? []) {
    const normalized = normalizeIgnoredName(name);
    if (normalized !== undefined) {
      ignoredNames.add(normalized);
    }
  }

  return [...ignoredNames].sort((a, b) => a.localeCompare(b));
}

export function parseIgnoredNameInput(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap(parseIgnoredNameInput);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map(normalizeIgnoredName)
    .filter((name): name is string => name !== undefined);
}

export function toArchiveExcludePatterns(ignoredNames: readonly string[]): readonly string[] {
  const patterns = new Set<string>();

  for (const name of ignoredNames) {
    const normalized = normalizeIgnoredName(name);
    if (normalized === undefined) {
      continue;
    }

    patterns.add(normalized);
    patterns.add(`${normalized}/*`);
    patterns.add(`*/${normalized}`);
    patterns.add(`*/${normalized}/*`);
  }

  return [...patterns];
}

function normalizeIgnoredName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    return undefined;
  }

  return normalized;
}
