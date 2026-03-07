// Removes common build artifacts and deps

import { readdir, rm } from "node:fs/promises";
import { join, sep } from "node:path";

type Cli = {
  dryRun: boolean;
  verbose: boolean;
};

const colors = {
  red: "\x1b[0;31m",
  green: "\x1b[0;32m",
  yellow: "\x1b[1;33m",
  blue: "\x1b[0;34m",
  nc: "\x1b[0m",
} as const;

const ICONS = {
  broom: "🧹",
  trash: "🗑️",
  ok: "✅",
  fail: "❌",
  warn: "⚠️",
  sparkle: "✨",
} as const;

function printHelp(): void {
  const bin = process.argv[1] ?? "clean";
  console.log(`Usage: ${bin} [options]

Remove common build artifacts and dependencies.

Options:
  -d, --dry-run    Show what would be removed without actually removing
  -v, --verbose    Show detailed output
  -h, --help       Show this help message
`);
}

function parseArgs(argv: string[]): Cli {
  let dryRun = false;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-d") dryRun = true;
    else if (a === "--verbose" || a === "-v") verbose = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`${colors.red}Unknown option: ${a}${colors.nc}`);
      console.error("Use --help for usage information");
      process.exit(2);
    }
  }

  return { dryRun, verbose };
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    if (ms > 1) return `${Math.floor(ms)}ms`;
    return `${ms.toFixed(1)}ms`;
  }
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const minutes = Math.floor(s / 60);
  const remaining = s - minutes * 60;
  return `${minutes}m ${remaining.toFixed(2)}s`;
}

function normalizeRel(p: string): string {
  // Keep output consistent ("./...").
  if (p === ".") return ".";
  return p.startsWith("." + sep) ? p : "." + sep + p;
}

function isInsideBunDir(pathRel: string): boolean {
  const s = pathRel.replaceAll("\\", "/");
  return s.includes("/.bun/");
}

async function* walk(root: string): AsyncGenerator<string> {
  // Yields relative paths from root (e.g. "apps/foo/node_modules")
  const stack: string[] = [root];

  while (stack.length) {
    const current = stack.pop()!;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];

    try {
      // Bun supports recursive reads fine, but we want control + skip logic.
      entries = (await readdir(current, { withFileTypes: true })) as any;
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = join(current, ent.name);
      const rel = normalizeRel(full);

      if (ent.isDirectory()) {
        if (isInsideBunDir(rel)) continue;
        stack.push(full);
        yield rel;
      } else if (ent.isFile()) {
        yield rel;
      }
    }
  }
}

const DIR_TARGETS = new Set([
  "node_modules",
  "dist",
  ".output",
  ".source",
  ".tanstack",
  ".cache",
  ".turbo",
  ".nitro",
  ".expo",
  "android",
  "ios",
  "target",
]);

const FILE_TARGETS = new Set(["bun.lock"]);

function matchesDir(relPath: string): boolean {
  const s = relPath.replaceAll("\\", "/");
  if (s.endsWith("/.turbo/cache") || s.includes("/.turbo/cache/")) return true;

  const parts = s.split("/").filter(Boolean);
  const last = parts.at(-1);
  if (!last) return false;

  if (DIR_TARGETS.has(last)) return true;
  return false;
}

function matchesFile(relPath: string): boolean {
  const s = relPath.replaceAll("\\", "/");
  const parts = s.split("/").filter(Boolean);
  const last = parts.at(-1);
  if (!last) return false;
  return FILE_TARGETS.has(last);
}

async function removePath(relPath: string, cli: Cli): Promise<"removed" | "error" | "skipped"> {
  const p = relPath.startsWith("." + sep) ? relPath.slice(2) : relPath;
  const pretty = relPath.replaceAll("\\", "/");

  if (isInsideBunDir(relPath)) return "skipped";

  if (cli.verbose || cli.dryRun) {
    console.log(`${colors.yellow}${ICONS.trash} Would remove: ${pretty}${colors.nc}`);
  }

  if (cli.dryRun) return "removed";

  try {
    await rm(p, { recursive: true, force: true });
    if (cli.verbose) console.log(`${colors.green}${ICONS.ok} Removed: ${pretty}${colors.nc}`);
    return "removed";
  } catch {
    console.error(`${colors.red}${ICONS.fail} Failed to remove: ${pretty}${colors.nc}`);
    return "error";
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const start = performance.now();

  if (cli.dryRun) {
    console.log(
      `${colors.yellow}${ICONS.broom} Dry run mode - showing what would be cleaned...${colors.nc}`,
    );
  } else {
    console.log(`${colors.blue}${ICONS.broom} Cleaning up codebase...${colors.nc}`);
  }

  let removedCount = 0;
  let errorCount = 0;

  // Strategy:
  // 1) Collect matching dirs + files while walking.
  // 2) Remove deeper paths first so parent deletions don't race.
  const dirs: string[] = [];
  const files: string[] = [];

  for await (const rel of walk(".")) {
    const s = rel.replaceAll("\\", "/");

    // Skip anything under .bun
    if (isInsideBunDir(s)) continue;

    const isDirLike = !s.includes(".") || s.endsWith("/") === false;
    // Infer dir/file by checking last segment matching logic:
    // If it matches file target => file
    if (matchesFile(s)) files.push(s);
    if (matchesDir(s)) dirs.push(s);
  }

  dirs.sort((a, b) => b.length - a.length);
  files.sort((a, b) => b.length - a.length);

  for (const d of dirs) {
    const res = await removePath(d, cli);
    if (res === "removed") removedCount++;
    else if (res === "error") errorCount++;
  }

  for (const f of files) {
    const res = await removePath(f, cli);
    if (res === "removed") removedCount++;
    else if (res === "error") errorCount++;
  }

  const elapsed = formatElapsed(performance.now() - start);

  if (cli.dryRun) {
    console.log(
      `${colors.blue}${ICONS.sparkle} Dry run complete! Would remove ${removedCount} items in ${elapsed}.${colors.nc}`,
    );
    process.exit(0);
  }

  if (removedCount > 0) {
    if (errorCount > 0) {
      console.log(
        `${colors.yellow}${ICONS.warn} Cleanup partially complete! Removed ${removedCount} items, ${errorCount} errors in ${elapsed}.${colors.nc}`,
      );
      process.exit(1);
    }
    console.log(
      `${colors.green}${ICONS.sparkle} Cleanup complete! Removed ${removedCount} items in ${elapsed}.${colors.nc}`,
    );
    process.exit(0);
  }

  console.log(`${colors.blue}${ICONS.sparkle} Nothing to cleanup! (${elapsed})${colors.nc}`);
  process.exit(0);
}

await main();
