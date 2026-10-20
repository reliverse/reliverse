import path from "node:path";

import type { RepositoryPolicyIndex } from "@reliverse/repo-index";

export const REPOSITORY_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

export function asStringRecord(value: unknown): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function hasOwn(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key);
}

export function findCalls(source: string, marker: string): readonly string[] {
  const calls: string[] = [];
  let offset = 0;

  while (true) {
    const start = source.indexOf(marker, offset);
    if (start < 0) return calls;

    let depth = 1;
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;
    let end = start + marker.length;

    for (; end < source.length; end += 1) {
      const character = source[end] ?? "";
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(source.slice(start, end + 1));
          break;
        }
      }
    }
    offset = end + 1;
  }
}

export function hasPropertyInCall(calls: readonly string[], property: string): boolean {
  const pattern = new RegExp(`(?:^|[,{]\\s*)${property}\\s*:`, "u");
  return calls.some((call) => pattern.test(call));
}

export function hasDefaultExport(source: string): boolean {
  return /export\s+(?:default|\{[^}]*\b(?:default|as\s+default)\b[^}]*\})/su.test(source);
}

const SOURCE_EXTENSIONS = [".cts", ".js", ".mjs", ".mts", ".ts", ".tsx"] as const;

export function relativeImportResolves(
  index: RepositoryPolicyIndex,
  modulePath: string,
  specifier: string,
): boolean {
  const inventory = new Set(index.inventory);
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(modulePath), specifier));
  const candidates = [
    target,
    ...SOURCE_EXTENSIONS.map((extension) => `${target}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${target}/index${extension}`),
  ];
  return candidates.some((candidate) => inventory.has(candidate));
}

export function isOperationalTextFile(file: string): boolean {
  return REPOSITORY_TEXT_EXTENSIONS.has(path.posix.extname(file));
}

export function isGeneratedRemptsProfilePath(value: string): boolean {
  return /(?:^|\/)src\/rempts\/generated-profile\.mjs$/u.test(normalizeRepositoryPath(value));
}

export function normalizeRepositoryPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
