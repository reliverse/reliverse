import { readFile } from "node:fs/promises";

import { fileExists, type RequestedTarget } from "../shared-targets";
import type { BuildCommandInvocation } from "./generated-command";

export type BunBundleStrategy = "auto" | "single" | "split";

export interface ResolvePackageBuildCommandOptions {
  readonly bundleStrategy?: BunBundleStrategy | undefined;
}

interface MinimalPackageJson {
  readonly bin?: Record<string, string> | string;
  readonly dependencies?: Record<string, string>;
  readonly exports?: Record<string, unknown>;
  readonly main?: string;
  readonly module?: string;
  readonly name?: string;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly private?: boolean;
  readonly scripts?: Record<string, string>;
  readonly types?: string;
}

const TSDOWN_CONFIG_CANDIDATES = [
  "tsdown.config.ts",
  "tsdown.config.mts",
  "tsdown.config.js",
  "tsdown.config.mjs",
] as const;

const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
] as const;

const ELECTROBUN_CONFIG_CANDIDATES = ["electrobun.config.ts", "electrobun.config.js"] as const;

const PACKAGE_ROOT_INDEX_CANDIDATES = ["index.ts", "index.tsx", "index.js"] as const;

const PLUGIN_OR_CLI_RUNTIME_EXTERNALS = new Set([
  "@reliverse/rempts",
  "@typescript/native-preview",
  "esbuild",
  "eslint",
  "prettier",
  "rollup",
  "tsdown",
  "typescript",
  "unbuild",
  "vite",
  "webpack",
]);

interface BuildShapeContext {
  readonly cwd: string;
  readonly label: string;
  readonly packageJson: MinimalPackageJson | null;
}

interface BuildShapeFacts extends BuildShapeContext {
  readonly appConfigExists: boolean;
  readonly convexConfigExists: boolean;
  readonly desktopConfigPath: string | null;
  readonly manifestEntrypoints: readonly string[];
  readonly packageRootIndexPath: string | null;
  readonly srcCliExists: boolean;
  readonly srcIndexExists: boolean;
  readonly tsdownConfigPath: string | null;
  readonly viteConfigPath: string | null;
}

async function firstExisting(cwd: string, pathnames: readonly string[]): Promise<string | null> {
  for (const pathname of pathnames) {
    const relativePath = `./${pathname}`;
    if (await fileExists(`${cwd}/${pathname}`)) {
      return relativePath;
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

  if (
    !(
      value.endsWith(".ts") ||
      value.endsWith(".tsx") ||
      value.endsWith(".js") ||
      value.endsWith(".jsx")
    )
  ) {
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

  if (typeof pkg?.bin === "string") {
    const entrypoint = normalizeEntrypoint(pkg.bin);
    if (entrypoint) {
      entrypoints.add(entrypoint);
    }
  } else if (pkg?.bin) {
    for (const value of Object.values(pkg.bin)) {
      const entrypoint = normalizeEntrypoint(value);
      if (entrypoint) {
        entrypoints.add(entrypoint);
      }
    }
  }

  if (pkg?.exports) {
    collectExportEntrypoints(pkg.exports, entrypoints);
  }

  return [...entrypoints].sort();
}

function collectDependencyNames(dependencies: Record<string, string> | undefined): string[] {
  return dependencies ? Object.keys(dependencies) : [];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function resolveExternalPackages(facts: BuildShapeFacts, targetRuntime: "bun" | "node"): string[] {
  const packageJson = facts.packageJson;

  if (!packageJson) {
    return [];
  }

  const peerAndOptionalDependencies = [
    ...collectDependencyNames(packageJson.peerDependencies),
    ...collectDependencyNames(packageJson.optionalDependencies),
  ];

  if (targetRuntime === "node" && isPackageTarget(facts.label)) {
    return uniqueSorted([
      ...collectDependencyNames(packageJson.dependencies),
      ...peerAndOptionalDependencies,
    ]);
  }

  const selectedRuntimeDependencies = collectDependencyNames(packageJson.dependencies).filter(
    (name) => PLUGIN_OR_CLI_RUNTIME_EXTERNALS.has(name),
  );

  return uniqueSorted([...peerAndOptionalDependencies, ...selectedRuntimeDependencies]);
}

function createExternalArgs(externalPackages: readonly string[]): string[] {
  return externalPackages.flatMap((name) => ["--external", name]);
}

function createBunBuildInvocation(
  entrypoints: readonly string[],
  targetRuntime: "bun" | "node",
  bundleStrategy: BunBundleStrategy,
  externalPackages: readonly string[] = [],
): BuildCommandInvocation {
  const externalArgs = createExternalArgs(externalPackages);
  const externalDisplay =
    externalPackages.length > 0
      ? ` ${externalPackages.map((name) => `--external ${name}`).join(" ")}`
      : "";

  if (bundleStrategy === "single") {
    const [entrypoint] = entrypoints;
    if (!entrypoint) {
      throw new Error("Cannot create a single-file Bun build without an entrypoint.");
    }

    return {
      argv: [
        "bun",
        "build",
        entrypoint,
        "--outfile",
        "./dist/index.js",
        "--target",
        targetRuntime,
        ...externalArgs,
      ],
      bundleStrategy: "single",
      display: `bun build ${entrypoint} --outfile ./dist/index.js --target ${targetRuntime}${externalDisplay}`,
    };
  }

  const rootArgs =
    entrypoints.length > 1 && entrypoints.every((entrypoint) => entrypoint.startsWith("./src/"))
      ? ["--root", "./src"]
      : [];

  return {
    argv: [
      "bun",
      "build",
      ...entrypoints,
      "--outdir",
      "./dist",
      "--target",
      targetRuntime,
      ...externalArgs,
      ...rootArgs,
    ],
    bundleStrategy: "split",
    display: `bun build ${entrypoints.join(" ")} --outdir ./dist --target ${targetRuntime}${externalDisplay}${rootArgs.length > 0 ? " --root ./src" : ""}`,
  };
}

function isPluginTarget(label: string): boolean {
  return label.startsWith("plugins/");
}

function isPackageTarget(label: string): boolean {
  return label.startsWith("packages/");
}

function hasSubpathExports(pkg: MinimalPackageJson | null): boolean {
  return Boolean(
    pkg?.exports &&
    typeof pkg.exports === "object" &&
    Object.keys(pkg.exports).some((key) => key.startsWith("./")),
  );
}

async function collectBuildShapeFacts(target: RequestedTarget): Promise<BuildShapeFacts> {
  const packageJson = await readPackageJson(target);

  return {
    appConfigExists: await fileExists(`${target.cwd}/app.config.ts`),
    convexConfigExists: await fileExists(`${target.cwd}/convex.json`),
    cwd: target.cwd,
    desktopConfigPath: await firstExisting(target.cwd, ELECTROBUN_CONFIG_CANDIDATES),
    label: target.label,
    manifestEntrypoints: inferManifestEntrypoints(packageJson),
    packageJson,
    packageRootIndexPath: await firstExisting(target.cwd, PACKAGE_ROOT_INDEX_CANDIDATES),
    srcCliExists: await fileExists(`${target.cwd}/src/cli.ts`),
    srcIndexExists: await fileExists(`${target.cwd}/src/index.ts`),
    tsdownConfigPath: await firstExisting(target.cwd, TSDOWN_CONFIG_CANDIDATES),
    viteConfigPath: await firstExisting(target.cwd, VITE_CONFIG_CANDIDATES),
  };
}

async function resolveConfigDrivenBuild(
  facts: BuildShapeFacts,
): Promise<BuildCommandInvocation | null> {
  if (facts.tsdownConfigPath) {
    return {
      argv: ["bun", "x", "tsdown"],
      display: "bun x tsdown",
    };
  }

  if (facts.convexConfigExists) {
    return {
      argv: ["bun", "x", "tsgo"],
      display: "bun x tsgo",
    };
  }

  if (facts.desktopConfigPath && facts.viteConfigPath) {
    return {
      argv: ["sh", "-lc", "bun x vite build && bun x electrobun build"],
      display: "bun x vite build && bun x electrobun build",
    };
  }

  if (facts.viteConfigPath) {
    return {
      argv: ["bun", "x", "vite", "build"],
      display: "bun x vite build",
    };
  }

  if (facts.appConfigExists) {
    return {
      argv: ["bun", "typecheck"],
      display: "bun typecheck",
    };
  }

  return null;
}

async function resolvePluginOrCliBuild(
  facts: BuildShapeFacts,
  bundleStrategy: BunBundleStrategy,
): Promise<BuildCommandInvocation | null> {
  if (facts.srcCliExists) {
    const entrypoints =
      bundleStrategy === "split" && facts.manifestEntrypoints.length > 0
        ? facts.manifestEntrypoints
        : ["./src/cli.ts"];

    return createBunBuildInvocation(
      entrypoints,
      "bun",
      bundleStrategy,
      resolveExternalPackages(facts, "bun"),
    );
  }

  if (facts.srcIndexExists && isPluginTarget(facts.label)) {
    const entrypoints =
      bundleStrategy === "split" ? await listCommandEntrypoints(facts.cwd) : ["./src/index.ts"];

    return createBunBuildInvocation(
      entrypoints,
      "bun",
      bundleStrategy,
      resolveExternalPackages(facts, "bun"),
    );
  }

  return null;
}

function resolvePackageLibraryBuild(
  facts: BuildShapeFacts,
  bundleStrategy: BunBundleStrategy,
): BuildCommandInvocation | null {
  if (!isPackageTarget(facts.label)) {
    return null;
  }

  if (facts.srcIndexExists) {
    const entrypoints =
      bundleStrategy === "single"
        ? ["./src/index.ts"]
        : facts.manifestEntrypoints.length > 0
          ? facts.manifestEntrypoints
          : ["./src/index.ts"];

    return createBunBuildInvocation(
      entrypoints,
      "node",
      bundleStrategy,
      resolveExternalPackages(facts, "node"),
    );
  }

  if (facts.packageRootIndexPath) {
    const entrypoints =
      bundleStrategy === "single"
        ? [facts.packageRootIndexPath]
        : facts.manifestEntrypoints.length > 0
          ? facts.manifestEntrypoints
          : [facts.packageRootIndexPath];

    return createBunBuildInvocation(
      entrypoints,
      "node",
      bundleStrategy,
      resolveExternalPackages(facts, "node"),
    );
  }

  if (facts.manifestEntrypoints.length > 0) {
    return createBunBuildInvocation(
      bundleStrategy === "single" ? [facts.manifestEntrypoints[0]!] : facts.manifestEntrypoints,
      "node",
      bundleStrategy,
      resolveExternalPackages(facts, "node"),
    );
  }

  return null;
}

function resolveGenericSourceBuild(
  facts: BuildShapeFacts,
  bundleStrategy: BunBundleStrategy,
): BuildCommandInvocation | null {
  if (facts.srcIndexExists) {
    return createBunBuildInvocation(
      ["./src/index.ts"],
      "bun",
      bundleStrategy,
      resolveExternalPackages(facts, "bun"),
    );
  }

  return null;
}

function resolveAutoBundleStrategy(facts: BuildShapeFacts): Exclude<BunBundleStrategy, "auto"> {
  if (isPluginTarget(facts.label) && hasSubpathExports(facts.packageJson)) {
    return "split";
  }

  if (isPluginTarget(facts.label) || facts.srcCliExists) {
    return "single";
  }

  return "split";
}

export async function explainMissingPackageBuildCommand(target: RequestedTarget): Promise<string> {
  const facts = await collectBuildShapeFacts(target);

  if (facts.desktopConfigPath && !facts.viteConfigPath) {
    return "unsupported package shape: electrobun config detected without a matching vite config";
  }

  if (facts.viteConfigPath && facts.desktopConfigPath === null) {
    return "unsupported package shape: vite config is present but no matching generated app build rule applied";
  }

  if (isPackageTarget(facts.label)) {
    return "unsupported package shape: package target is missing src/index.ts, root index entrypoints, and manifest entrypoints";
  }

  if (isPluginTarget(facts.label)) {
    return "unsupported package shape: plugin target is missing src/index.ts and src/cli.ts";
  }

  return "unsupported package shape: no generated package build command matched";
}

export async function resolvePackageBuildCommand(
  target: RequestedTarget,
  options: ResolvePackageBuildCommandOptions = {},
): Promise<BuildCommandInvocation | null> {
  const facts = await collectBuildShapeFacts(target);
  const bundleStrategy =
    options.bundleStrategy === "single" || options.bundleStrategy === "split"
      ? options.bundleStrategy
      : resolveAutoBundleStrategy(facts);

  return (
    (await resolveConfigDrivenBuild(facts)) ??
    (await resolvePluginOrCliBuild(facts, bundleStrategy)) ??
    resolvePackageLibraryBuild(facts, bundleStrategy) ??
    resolveGenericSourceBuild(facts, bundleStrategy)
  );
}
