import { readFile } from "node:fs/promises";

import { fileExists, type RequestedTarget } from "../shared-targets";

import type { BuildCommandInvocation } from "./generated-command";

interface MinimalPackageJson {
  readonly exports?: Record<string, unknown>;
  readonly main?: string;
  readonly module?: string;
  readonly name?: string;
  readonly private?: boolean;
  readonly scripts?: Record<string, string>;
  readonly types?: string;
}

async function firstExisting(pathnames: readonly string[]): Promise<string | null> {
  for (const pathname of pathnames) {
    if (await fileExists(pathname)) {
      return pathname;
    }
  }

  return null;
}

async function readPackageJson(target: RequestedTarget): Promise<MinimalPackageJson | null> {
  const manifestPath = `${target.cwd}/package.json`;
  if (!(await fileExists(manifestPath))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as MinimalPackageJson;
  } catch {
    return null;
  }
}

async function listCommandEntrypoints(cwd: string): Promise<string[]> {
  const entrypoints = ["./src/index.ts"];

  for await (const match of new Bun.Glob("src/cmds/**/cmd.ts").scan({ cwd, onlyFiles: true })) {
    entrypoints.push(`./${match}`);
  }

  return entrypoints;
}

function normalizeEntrypoint(value: string): string | null {
  if (value.includes("*")) {
    return null;
  }

  if (!(value.endsWith(".ts") || value.endsWith(".tsx") || value.endsWith(".js") || value.endsWith(".jsx"))) {
    return null;
  }

  return value.startsWith("./") ? value : `./${value}`;
}

function collectExportEntrypoints(value: unknown, bucket: Set<string>): void {
  if (typeof value === "string") {
    const entrypoint = normalizeEntrypoint(value);
    if (entrypoint) {
      bucket.add(entrypoint);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectExportEntrypoints(nested, bucket);
  }
}

function inferManifestEntrypoints(pkg: MinimalPackageJson | null): string[] {
  const entrypoints = new Set<string>();

  if (pkg?.main) {
    const entrypoint = normalizeEntrypoint(pkg.main);
    if (entrypoint) {
      entrypoints.add(entrypoint);
    }
  }

  if (pkg?.module) {
    const entrypoint = normalizeEntrypoint(pkg.module);
    if (entrypoint) {
      entrypoints.add(entrypoint);
    }
  }

  if (pkg?.types) {
    const entrypoint = normalizeEntrypoint(pkg.types);
    if (entrypoint) {
      entrypoints.add(entrypoint);
    }
  }

  if (pkg?.exports) {
    collectExportEntrypoints(pkg.exports, entrypoints);
  }

  return [...entrypoints].sort();
}

function createBunBuildInvocation(entrypoints: readonly string[], targetRuntime: "bun" | "node"): BuildCommandInvocation {
  return {
    argv: ["bun", "build", ...entrypoints, "--outdir", "./dist", "--target", targetRuntime],
    display: `bun build ${entrypoints.join(" ")} --outdir ./dist --target ${targetRuntime}`,
  };
}

export async function resolvePackageBuildCommand(target: RequestedTarget): Promise<BuildCommandInvocation | null> {
  const pkg = await readPackageJson(target);
  const rel = target.label;

  const tsdownConfig = await firstExisting([
    `${target.cwd}/tsdown.config.ts`,
    `${target.cwd}/tsdown.config.mts`,
    `${target.cwd}/tsdown.config.js`,
    `${target.cwd}/tsdown.config.mjs`,
  ]);
  if (tsdownConfig) {
    return {
      argv: ["bun", "x", "tsdown"],
      display: "bun x tsdown",
    };
  }

  if (await fileExists(`${target.cwd}/convex.json`)) {
    return {
      argv: ["bun", "x", "tsgo"],
      display: "bun x tsgo",
    };
  }

  const desktopConfig = await firstExisting([`${target.cwd}/electrobun.config.ts`, `${target.cwd}/electrobun.config.js`]);
  const viteConfig = await firstExisting([
    `${target.cwd}/vite.config.ts`,
    `${target.cwd}/vite.config.mts`,
    `${target.cwd}/vite.config.js`,
    `${target.cwd}/vite.config.mjs`,
  ]);
  if (desktopConfig && viteConfig) {
    return {
      argv: ["sh", "-lc", "bun x vite build && bun x electrobun build"],
      display: "bun x vite build && bun x electrobun build",
    };
  }

  if (viteConfig) {
    return {
      argv: ["bun", "x", "vite", "build"],
      display: "bun x vite build",
    };
  }

  if (await fileExists(`${target.cwd}/app.config.ts`)) {
    return {
      argv: ["bun", "typecheck"],
      display: "bun typecheck",
    };
  }

  if (await fileExists(`${target.cwd}/src/cli.ts`)) {
    return createBunBuildInvocation(["./src/cli.ts"], "bun");
  }

  if (await fileExists(`${target.cwd}/src/index.ts`)) {
    if (rel.startsWith("plugins/")) {
      return createBunBuildInvocation(await listCommandEntrypoints(target.cwd), "bun");
    }

    if (rel.startsWith("packages/")) {
      const entrypoints = inferManifestEntrypoints(pkg);
      return createBunBuildInvocation(entrypoints.length > 0 ? entrypoints : ["./src/index.ts"], "node");
    }

    return createBunBuildInvocation(["./src/index.ts"], "bun");
  }

  const packageRootIndex = await firstExisting([`${target.cwd}/index.ts`, `${target.cwd}/index.tsx`, `${target.cwd}/index.js`]);
  if (packageRootIndex && rel.startsWith("packages/")) {
    const entrypoints = inferManifestEntrypoints(pkg);
    return createBunBuildInvocation(entrypoints.length > 0 ? entrypoints : ["./index.ts"], "node");
  }

  const manifestEntrypoints = inferManifestEntrypoints(pkg);
  if (manifestEntrypoints.length > 0 && rel.startsWith("packages/")) {
    return createBunBuildInvocation(manifestEntrypoints, "node");
  }

  return null;
}
