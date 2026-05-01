import type { SizeUnit } from "./types";

export const DEFAULT_OUTPUT_FILE = "packed-context.txt";
export const DEFAULT_MAX_SIZE_BYTES = 1024 * 1024;
export const BINARY_SAMPLE_BYTES = 8192;

export const PACKED_BLOCK_SEPARATOR =
  "================================================================================";

export const SIZE_MULTIPLIERS: Record<SizeUnit, number> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

export const DEFAULT_IGNORED_NAMES: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".idea",
  ".vscode",
  ".history",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".output",
  ".cache",
  ".parcel-cache",
  "coverage",
  ".nyc_output",
  ".vitest",
  ".pytest_cache",
  "__pycache__",
  "tmp",
  "temp",
  "logs",
  "log",
  ".pnpm-store",
  ".yarn",
  ".bun",
]);

export const DEFAULT_TEXT_EXTS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".ini",
  ".env",
  ".example",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sql",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".inc",
  ".pwn",
]);

export const DEFAULT_TEXT_FILE_NAMES: ReadonlySet<string> = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "procfile",
  "license",
  "notice",
  "readme",
  "changelog",
  "contributing",
]);