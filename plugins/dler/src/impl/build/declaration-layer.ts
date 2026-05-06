import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { emitTypeScriptDeclarations, type DeclarDiagnostic } from "@reliverse/declar";

import { fileExists, type RequestedTarget } from "../shared-targets";

interface DlerDeclarationPackageJson {
  readonly exports?: unknown;
  readonly main?: string | undefined;
  readonly module?: string | undefined;
  readonly name?: string | undefined;
  readonly private?: boolean | undefined;
  readonly type?: string | undefined;
  readonly types?: string | undefined;
}

interface DlerDeclarPackagePlan {
  readonly packageJson: DlerDeclarationPackageJson;
  readonly sourceEntrypoints: readonly string[];
}

export interface DlerDeclarationLayerResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles: readonly string[];
  readonly ok: boolean;
  readonly skippedReason?: string | undefined;
}

const sourceExtensions = [".tsx", ".mts", ".cts", ".ts"] as const;
const ignoredDeclarationSourceSegments = [".test.", ".spec.", ".bench.", ".fixture."] as const;

async function readPackageJson(cwd: string): Promise<DlerDeclarationPackageJson | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as DlerDeclarationPackageJson;
  } catch {
    return undefined;
  }
}

function isSourceEntrypoint(value: string): boolean {
  return sourceExtensions.some((extension) => value.endsWith(extension)) && !value.endsWith(".d.ts");
}

function isDeclarationSourceFile(value: string): boolean {
  return isSourceEntrypoint(value) && !ignoredDeclarationSourceSegments.some((segment) => value.includes(segment));
}

function normalizePackagePath(value: string): string {
  return value.startsWith("./") ? value : `./${value}`;
}

function stripSourcePrefix(value: string): string {
  const normalized = normalizePackagePath(value);
  return normalized.startsWith("./src/") ? `./${normalized.slice("./src/".length)}` : normalized;
}

function toRuntimeOutputPath(sourcePath: string): string {
  const withoutSourcePrefix = stripSourcePrefix(sourcePath);
  const extension = sourceExtensions.find((candidate) => withoutSourcePrefix.endsWith(candidate));
  const basePath = extension
    ? withoutSourcePrefix.slice(0, -extension.length)
    : withoutSourcePrefix;

  if (sourcePath.endsWith(".cts")) {
    return `./dist/${basePath.replace(/^\.\//, "")}.cjs`;
  }

  if (sourcePath.endsWith(".mts")) {
    return `./dist/${basePath.replace(/^\.\//, "")}.mjs`;
  }

  return `./dist/${basePath.replace(/^\.\//, "")}.js`;
}

function toDeclarationOutputPath(sourcePath: string): string {
  const withoutSourcePrefix = stripSourcePrefix(sourcePath);
  const extension = sourceExtensions.find((candidate) => withoutSourcePrefix.endsWith(candidate));
  const basePath = extension
    ? withoutSourcePrefix.slice(0, -extension.length)
    : withoutSourcePrefix;
  const declarationExtension = sourcePath.endsWith(".mts")
    ? ".d.mts"
    : sourcePath.endsWith(".cts")
      ? ".d.cts"
      : ".d.ts";

  return `./dist/${basePath.replace(/^\.\//, "")}${declarationExtension}`;
}

function collectSourceEntrypoints(value: unknown, bucket: Set<string>): void {
  if (typeof value === "string") {
    if (isDeclarationSourceFile(value)) bucket.add(normalizePackagePath(value));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectSourceEntrypoints(nested, bucket);
  }
}

function createDeclarExportValue(value: unknown): unknown {
  const sourceEntrypoints = new Set<string>();
  collectSourceEntrypoints(value, sourceEntrypoints);
  const [sourceEntrypoint] = sourceEntrypoints;

  if (!sourceEntrypoint) return value;

  const runtimeCondition = sourceEntrypoint.endsWith(".cts") ? "require" : "import";

  return {
    types: toDeclarationOutputPath(sourceEntrypoint),
    [runtimeCondition]: toRuntimeOutputPath(sourceEntrypoint),
  };
}

function createDeclarPackagePlan(pkg: DlerDeclarationPackageJson): DlerDeclarPackagePlan | undefined {
  if (!pkg.exports || typeof pkg.exports !== "object") {
    return undefined;
  }

  const sourceEntrypoints = new Set<string>();
  const exportsValue: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(pkg.exports as Record<string, unknown>)) {
    collectSourceEntrypoints(value, sourceEntrypoints);
    exportsValue[key] = createDeclarExportValue(value);
  }

  if (pkg.types) collectSourceEntrypoints(pkg.types, sourceEntrypoints);
  if (pkg.main) collectSourceEntrypoints(pkg.main, sourceEntrypoints);
  if (pkg.module) collectSourceEntrypoints(pkg.module, sourceEntrypoints);

  if (sourceEntrypoints.size === 0) {
    return undefined;
  }

  return {
    packageJson: {
      name: pkg.name,
      type: "module",
      types: pkg.types && isDeclarationSourceFile(pkg.types) ? toDeclarationOutputPath(pkg.types) : pkg.types,
      exports: exportsValue,
    },
    sourceEntrypoints: [...sourceEntrypoints],
  };
}

async function resolveDefaultRootDir(cwd: string): Promise<string | undefined> {
  return (await fileExists(join(cwd, "src"))) ? "src" : undefined;
}

async function ensureDefaultPackagePlan(cwd: string): Promise<DlerDeclarPackagePlan | undefined> {
  for (const filename of ["index.ts", "index.tsx", "index.mts", "index.cts"]) {
    const path = join(cwd, "src", filename);
    if (!(await fileExists(path))) continue;

    const sourcePath = `./src/${filename}`;
    const runtimeCondition = sourcePath.endsWith(".cts") ? "require" : "import";

    return {
      packageJson: {
        type: "module",
        types: toDeclarationOutputPath(sourcePath),
        exports: {
          ".": {
            types: toDeclarationOutputPath(sourcePath),
            [runtimeCondition]: toRuntimeOutputPath(sourcePath),
          },
        },
      },
      sourceEntrypoints: [sourcePath],
    };
  }

  return undefined;
}

function formatDiagnostic(diagnostic: DeclarDiagnostic): string {
  return `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

function toSourceFiles(packageDir: string, sourceEntrypoints: readonly string[]): readonly string[] {
  return sourceEntrypoints.map((entrypoint) => resolve(packageDir, entrypoint));
}

export function formatDeclarDiagnostics(diagnostics: readonly DeclarDiagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}

export async function runDeclarDeclarationLayer(
  target: RequestedTarget,
): Promise<DlerDeclarationLayerResult> {
  if (!(await fileExists(join(target.cwd, "tsconfig.json")))) {
    return { diagnostics: [], emittedFiles: [], ok: true, skippedReason: "missing tsconfig.json" };
  }

  const packageJson = await readPackageJson(target.cwd);
  if (!packageJson) {
    return { diagnostics: [], emittedFiles: [], ok: true, skippedReason: "missing package.json" };
  }

  const declarPlan = createDeclarPackagePlan(packageJson) ?? (await ensureDefaultPackagePlan(target.cwd));

  if (!declarPlan) {
    return {
      diagnostics: [],
      emittedFiles: [],
      ok: true,
      skippedReason: "no TypeScript package entrypoint found",
    };
  }

  await mkdir(join(target.cwd, "dist"), { recursive: true });

  const result = await emitTypeScriptDeclarations({
    fastDeclarationFallback: "typescript",
    fastDeclarations: false,
    files: toSourceFiles(target.cwd, declarPlan.sourceEntrypoints),
    outDir: "dist",
    packageDir: target.cwd,
    packageJson: declarPlan.packageJson,
    rollup: false,
    rootDir: await resolveDefaultRootDir(target.cwd),
    updatePackageJson: false,
  });
  const ok = !result.emitSkipped && result.diagnostics.every((diagnostic) => diagnostic.severity !== "error");

  return {
    diagnostics: result.diagnostics,
    emittedFiles: result.emittedFiles,
    ok,
  };
}
