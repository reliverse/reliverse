import type { RspacePlatform } from "./types";

export const RSPACE_PROTOCOL = "rspace-v1";

export const RSPACE_CREATED_BY = "@reliverse/rspace-rse-plugin";

export const DEFAULT_ENTRY_FILE = "START_HERE.md";

export const DEFAULT_RSPACE_EXTENSION = ".rse";

export const RSE_DIR = ".rse";

export const RSPACE_STATE_PATH = `${RSE_DIR}/state.json`;

export const PLATFORM_NOTES_DIR = `${RSE_DIR}/platforms`;

export const TEAMS_DIR = `${RSE_DIR}/teams`;

export const CUSTOM_IMPORTS_DIR = `${RSE_DIR}/custom`;

export const ARCHIVE_MANIFEST_PATH = "ARCHIVE_MANIFEST.md";

export const ARCHIVE_SHA256SUMS_PATH = "ARCHIVE_SHA256SUMS.txt";

export const SUPPORTED_PLATFORMS = [
  "generic",
  "chatgpt",
  "openclaw",
  "bleverse",
] as const satisfies readonly RspacePlatform[];

export const PLATFORM_NOTE_FILES = SUPPORTED_PLATFORMS.map(
  (platform) => `${PLATFORM_NOTES_DIR}/${platform}.md`,
);

export const GENERATED_STATIC_ROOT_FILES = [
  "AGENTS.md",
  "IDENTITY.md",
  "TOOLS.md",
  "MEMORY.md",
  ARCHIVE_MANIFEST_PATH,
  ARCHIVE_SHA256SUMS_PATH,
] as const;

export const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".vercel",
  ".wrangler",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const DEFAULT_IGNORED_FILES = new Set([
  ".DS_Store",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".npmrc",
  ".pnpmrc",
  "id_rsa",
  "id_ed25519",
]);

export const DEFAULT_IGNORED_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);
