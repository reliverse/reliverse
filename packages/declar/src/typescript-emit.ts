import { resolve } from "node:path";

import {
  type DeclarDeclarationBundleHost,
  bundleTypeScriptDeclarations,
} from "./bundle-declarations";
import { createDeclarDiagnostic, createDeclarError, hasDeclarErrors } from "./diagnostics";
import {
  collectDeclarIsolatedDeclarationSourceFiles,
  emitIsolatedTypeScriptDeclarations,
} from "./isolated-declarations";
import { discoverPackageEntrypoints } from "./package-exports";
import { type DeclarPackageTypesWiringHost, wireDeclarPackageTypes } from "./package-wiring";
import {
  type DeclarParsedCommandLine,
  type DeclarTsconfigLoadResult,
  type DeclarTypeScriptConfigAdapter,
  loadDeclarTsconfig,
} from "./tsconfig";
import type {
  DeclarDiagnostic,
  DeclarFastDeclarationFallback,
  DeclarFastDeclarationMode,
  DeclarFastDeclarationOption,
  DeclarPackageJson,
} from "./types";
import { validateDeclarEmittedFiles, validateDeclarEntrypointFiles } from "./validate";

export interface DeclarTypeScriptEmitAdapter extends DeclarTypeScriptConfigAdapter {
  // any[] is intentional here because this is a boundary to the external TypeScript compiler API.
  // Different TypeScript versions expose compatible overloads, but not always with the same TS-level shape.
  readonly createProgram: (...args: any[]) => DeclarTypeScriptProgram;

  readonly formatDiagnosticsWithColorAndContext?: (
    // any is intentional: TypeScript versions expose this with concrete Diagnostic[] types.
    diagnostics: readonly any[],
    host: any,
  ) => string;

  // any is intentional here because the real TypeScript Program type is much wider than Declar needs.
  readonly getPreEmitDiagnostics: (program: any) => readonly unknown[];

  // any[] is intentional here because this is a boundary to TypeScript's public API.
  // TypeScript 5.5+ exposes `transpileDeclaration` with a concrete TranspileOptions type,
  // and keeping that exact shape here would make `typeof ts` fail assignment under
  // `exactOptionalPropertyTypes`.
  readonly transpileDeclaration?: (...args: any[]) => {
    readonly diagnostics?: readonly unknown[] | undefined;
    readonly outputText?: string | undefined;
    readonly sourceMapText?: string | undefined;
  };
}

export interface DeclarTypeScriptProgram {
  // any is intentional here because this is the narrow boundary to TypeScript's Program.emit API.
  // Using unknown makes the real TypeScript Program type fail assignment under strict function variance.
  readonly emit: (
    targetSourceFile?: any,
    writeFile?: any,
    cancellationToken?: any,
    emitOnlyDtsFiles?: boolean,
  ) => DeclarTypeScriptEmitOutput;
}

export interface DeclarTypeScriptEmitOutput {
  readonly diagnostics?: readonly unknown[] | undefined;
  readonly emittedFiles?: readonly string[] | undefined;
  readonly emitSkipped?: boolean | undefined;
}

export interface DeclarTypeScriptFormatHost {
  readonly getCanonicalFileName: (fileName: string) => string;
  readonly getCurrentDirectory: () => string;
  readonly getNewLine: () => string;
}

export interface DeclarTypeScriptDeclarationEmitOptions {
  readonly bundleHost?: DeclarDeclarationBundleHost | undefined;
  readonly checkRuntimeTargets?: boolean | undefined;
  readonly compiler?: DeclarTypeScriptEmitAdapter | undefined;
  readonly declarationMap?: boolean | undefined;
  readonly fastDeclarationFallback?: DeclarFastDeclarationFallback | undefined;
  readonly fastDeclarations?: DeclarFastDeclarationOption | undefined;
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly packageJson: DeclarPackageJson;
  readonly packageJsonHost?: DeclarPackageTypesWiringHost | undefined;
  readonly packageJsonPath?: string | undefined;
  readonly rollup?: boolean | undefined;
  readonly tsconfigPath?: string | undefined;
  readonly updatePackageJson?: boolean | undefined;
  readonly validateBundledFiles?: boolean | undefined;
  readonly validateEmittedFiles?: boolean | undefined;
}

export interface DeclarTypeScriptDeclarationEmitResult {
  readonly bundledFiles: readonly string[];
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles: readonly string[];
  readonly emitSkipped: boolean;
  readonly packageJson?: Record<string, unknown> | undefined;
  readonly packageJsonPath?: string | undefined;
  readonly packageJsonUpdated: boolean;
  readonly tsconfig: DeclarTsconfigLoadResult;
}

interface DeclarTypeScriptDeclarationEmitFailureOptions {
  readonly bundledFiles?: readonly string[] | undefined;
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles?: readonly string[] | undefined;
  readonly tsconfig: DeclarTsconfigLoadResult;
}

interface DeclarTypeScriptDeclarationContext {
  readonly compiler: DeclarTypeScriptEmitAdapter;
  readonly diagnostics: DeclarDiagnostic[];
  readonly discovery: ReturnType<typeof discoverPackageEntrypoints>;
  readonly options: DeclarTypeScriptDeclarationEmitOptions;
  readonly tsconfig: DeclarTsconfigLoadResult & {
    readonly parsedCommandLine: DeclarParsedCommandLine;
  };
}

interface DeclarResolvedEmitContext {
  readonly compiler: DeclarTypeScriptEmitAdapter;
  readonly diagnostics: DeclarDiagnostic[];
  readonly options: DeclarTypeScriptDeclarationEmitOptions;
  readonly tsconfig: DeclarTsconfigLoadResult & {
    readonly parsedCommandLine: DeclarParsedCommandLine;
  };
}

function createFormatHost(compiler: DeclarTypeScriptEmitAdapter): DeclarTypeScriptFormatHost {
  const sys = compiler.sys;

  return {
    getCanonicalFileName: sys?.useCaseSensitiveFileNames
      ? (fileName) => fileName
      : (fileName) => fileName.toLowerCase(),
    getCurrentDirectory: () => sys?.getCurrentDirectory() ?? process.cwd(),
    getNewLine: () => sys?.newLine ?? "\n",
  };
}

function unwrapDefaultCompiler(compilerModule: unknown): unknown {
  if (!compilerModule || typeof compilerModule !== "object" || !("default" in compilerModule)) {
    return compilerModule;
  }

  const defaultExport = (compilerModule as { readonly default?: unknown }).default;

  return defaultExport ?? compilerModule;
}

function isDeclarTypeScriptEmitAdapter(value: unknown): value is DeclarTypeScriptEmitAdapter {
  if (!value || typeof value !== "object") {
    return false;
  }

  const compiler = value as {
    readonly createProgram?: unknown;
    readonly getPreEmitDiagnostics?: unknown;
    readonly parseJsonConfigFileContent?: unknown;
    readonly readConfigFile?: unknown;
    readonly sys?: unknown;
  };

  return (
    typeof compiler.createProgram === "function" &&
    typeof compiler.getPreEmitDiagnostics === "function" &&
    typeof compiler.parseJsonConfigFileContent === "function" &&
    typeof compiler.readConfigFile === "function" &&
    Boolean(compiler.sys)
  );
}

async function importDefaultTypeScriptCompiler(): Promise<DeclarTypeScriptEmitAdapter | undefined> {
  try {
    const compilerModule = await import("typescript");
    const compiler = unwrapDefaultCompiler(compilerModule);

    return isDeclarTypeScriptEmitAdapter(compiler) ? compiler : undefined;
  } catch {
    return undefined;
  }
}

async function resolveTypeScriptCompiler(
  compiler: DeclarTypeScriptEmitAdapter | undefined,
): Promise<DeclarTypeScriptEmitAdapter | undefined> {
  if (compiler) {
    return isDeclarTypeScriptEmitAdapter(compiler) ? compiler : undefined;
  }

  return importDefaultTypeScriptCompiler();
}

function formatTypeScriptDiagnostics(
  compiler: DeclarTypeScriptEmitAdapter,
  diagnostics: readonly unknown[],
): string {
  if (diagnostics.length === 0) {
    return "TypeScript declaration emit failed.";
  }

  if (compiler.formatDiagnosticsWithColorAndContext) {
    return compiler.formatDiagnosticsWithColorAndContext(diagnostics, createFormatHost(compiler));
  }

  if (compiler.flattenDiagnosticMessageText) {
    return diagnostics
      .map((diagnostic) => {
        const messageText = (diagnostic as { readonly messageText?: unknown }).messageText;
        return compiler.flattenDiagnosticMessageText?.(messageText, compiler.sys?.newLine ?? "\n");
      })
      .filter((message): message is string => typeof message === "string" && message.length > 0)
      .join("\n");
  }

  return "TypeScript declaration emit failed.";
}

function createTypeScriptEmitDiagnostic(
  compiler: DeclarTypeScriptEmitAdapter,
  diagnostics: readonly unknown[],
): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TYPESCRIPT_EMIT_FAILED",
    formatTypeScriptDiagnostics(compiler, diagnostics),
    ["typescript"],
  );
}

function createBundledTypeScriptCheckDiagnostic(
  compiler: DeclarTypeScriptEmitAdapter,
  diagnostics: readonly unknown[],
): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_BUNDLE_TYPESCRIPT_CHECK_FAILED",
    formatTypeScriptDiagnostics(compiler, diagnostics),
    ["typescript", "bundle"],
  );
}

function createCompilerUnavailableDiagnostic(): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE",
    "Declar needs a TypeScript compiler. Pass compiler: ts to emitTypeScriptDeclarations, or install TypeScript so Declar can load it automatically.",
    ["typescript"],
  );
}

function normalizeFastDeclarationMode(
  mode: DeclarFastDeclarationOption | undefined,
): DeclarFastDeclarationMode {
  if (mode === true) {
    return "auto";
  }

  return mode ?? false;
}

function normalizeFastDeclarationFallback(
  fallback: DeclarFastDeclarationFallback | undefined,
): DeclarFastDeclarationFallback {
  return fallback ?? "typescript";
}

function createCompilerOptions(
  parsedCommandLine: DeclarParsedCommandLine,
  options: DeclarTypeScriptDeclarationEmitOptions,
): Record<string, unknown> {
  return {
    ...parsedCommandLine.options,
    declaration: true,
    declarationMap: options.declarationMap ?? false,
    emitDeclarationOnly: true,
    listEmittedFiles: true,
    noEmit: false,
    outDir: resolve(options.packageDir, options.outDir ?? "dist"),
  };
}

function createBundledDeclarationCheckOptions(
  parsedCommandLine: DeclarParsedCommandLine,
): Record<string, unknown> {
  return {
    ...parsedCommandLine.options,
    declaration: false,
    emitDeclarationOnly: false,
    noEmit: true,
  };
}

function createUnavailableTsconfigResult(
  options: DeclarTypeScriptDeclarationEmitOptions,
  diagnostic: DeclarDiagnostic,
): DeclarTsconfigLoadResult {
  return {
    configFilePath: resolve(options.packageDir, options.tsconfigPath ?? "tsconfig.json"),
    diagnostics: [diagnostic],
  };
}

function getDiagnosticKey(diagnostic: DeclarDiagnostic): string {
  return `${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}:${
    diagnostic.path?.join("/") ?? ""
  }`;
}

function dedupeDiagnostics(diagnostics: readonly DeclarDiagnostic[]): readonly DeclarDiagnostic[] {
  const seen = new Set<string>();
  const result: DeclarDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = getDiagnosticKey(diagnostic);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(diagnostic);
  }

  return result;
}

function createEmitFailureResult(
  options: DeclarTypeScriptDeclarationEmitFailureOptions,
): DeclarTypeScriptDeclarationEmitResult {
  return {
    bundledFiles: options.bundledFiles ?? [],
    diagnostics: dedupeDiagnostics(options.diagnostics),
    emittedFiles: options.emittedFiles ?? [],
    emitSkipped: true,
    packageJsonUpdated: false,
    tsconfig: options.tsconfig,
  };
}

async function validateEmittedDeclarationTargets(
  options: DeclarTypeScriptDeclarationEmitOptions,
  entrypoints: ReturnType<typeof discoverPackageEntrypoints>["entrypoints"],
  emittedFiles: readonly string[],
): Promise<readonly DeclarDiagnostic[]> {
  const emittedValidation = validateDeclarEmittedFiles({
    emittedFiles,
    entrypoints,
    packageDir: options.packageDir,
  });

  const fileValidation = await validateDeclarEntrypointFiles({
    checkRuntimeTargets: options.checkRuntimeTargets,
    entrypoints,
    packageDir: options.packageDir,
  });

  return [...emittedValidation.diagnostics, ...fileValidation.diagnostics];
}

function checkBundledDeclarations(
  context: DeclarTypeScriptDeclarationContext,
  bundledFiles: readonly string[],
): readonly DeclarDiagnostic[] {
  if (!(context.options.validateBundledFiles ?? true) || bundledFiles.length === 0) {
    return [];
  }

  const program = context.compiler.createProgram(
    bundledFiles,
    createBundledDeclarationCheckOptions(context.tsconfig.parsedCommandLine),
  );
  const diagnostics = context.compiler.getPreEmitDiagnostics(program);

  return diagnostics.length > 0
    ? [createBundledTypeScriptCheckDiagnostic(context.compiler, diagnostics)]
    : [];
}

async function bundleDeclarations(
  context: DeclarTypeScriptDeclarationContext,
): Promise<readonly string[]> {
  if (!context.options.rollup || hasDeclarErrors(context.diagnostics)) {
    return [];
  }

  const bundleResult = await bundleTypeScriptDeclarations({
    entrypoints: context.discovery.entrypoints,
    host: context.options.bundleHost,
    packageDir: context.options.packageDir,
  });
  const bundledFiles = bundleResult.bundles.map((bundle) => bundle.path);

  context.diagnostics.push(...bundleResult.diagnostics);

  if (!hasDeclarErrors(context.diagnostics)) {
    context.diagnostics.push(...checkBundledDeclarations(context, bundledFiles));
  }

  return bundledFiles;
}

async function wirePackageJsonTypes(
  context: DeclarTypeScriptDeclarationContext,
): Promise<
  Pick<
    DeclarTypeScriptDeclarationEmitResult,
    "packageJson" | "packageJsonPath" | "packageJsonUpdated"
  >
> {
  if (!context.options.updatePackageJson || hasDeclarErrors(context.diagnostics)) {
    return { packageJsonUpdated: false };
  }

  const wiringResult = await wireDeclarPackageTypes({
    entrypoints: context.discovery.entrypoints,
    host: context.options.packageJsonHost,
    packageDir: context.options.packageDir,
    packageJson: context.options.packageJson as DeclarPackageJson & Record<string, unknown>,
    packageJsonPath: context.options.packageJsonPath,
    write: true,
  });

  context.diagnostics.push(...wiringResult.diagnostics);

  return {
    packageJson: wiringResult.packageJson,
    packageJsonPath: wiringResult.packageJsonPath,
    packageJsonUpdated: wiringResult.wrotePackageJson,
  };
}

async function finishDeclarationPipeline(
  context: DeclarTypeScriptDeclarationContext,
  emittedFiles: readonly string[],
  emitSkipped: boolean,
): Promise<DeclarTypeScriptDeclarationEmitResult> {
  const bundledFiles = await bundleDeclarations(context);
  const packageJsonResult = await wirePackageJsonTypes(context);

  return {
    bundledFiles,
    diagnostics: dedupeDiagnostics(context.diagnostics),
    emittedFiles,
    emitSkipped,
    ...packageJsonResult,
    tsconfig: context.tsconfig,
  };
}

async function emitWithTypeScript(
  context: DeclarResolvedEmitContext,
): Promise<DeclarTypeScriptDeclarationEmitResult> {
  const compilerOptions = createCompilerOptions(
    context.tsconfig.parsedCommandLine,
    context.options,
  );
  const program = context.compiler.createProgram(
    context.tsconfig.parsedCommandLine.fileNames,
    compilerOptions,
  );
  const preEmitDiagnostics = context.compiler.getPreEmitDiagnostics(program);

  if (preEmitDiagnostics.length > 0) {
    context.diagnostics.push(createTypeScriptEmitDiagnostic(context.compiler, preEmitDiagnostics));

    return createEmitFailureResult({
      diagnostics: context.diagnostics,
      tsconfig: context.tsconfig,
    });
  }

  const emitResult = program.emit(undefined, undefined, undefined, true);
  const emittedFiles = emitResult.emittedFiles ?? [];
  const emitDiagnostics = emitResult.diagnostics ?? [];

  if (emitDiagnostics.length > 0 || emitResult.emitSkipped) {
    context.diagnostics.push(createTypeScriptEmitDiagnostic(context.compiler, emitDiagnostics));

    return createEmitFailureResult({
      diagnostics: context.diagnostics,
      emittedFiles,
      tsconfig: context.tsconfig,
    });
  }

  const discovery = discoverPackageEntrypoints(context.options.packageJson);
  context.diagnostics.push(...discovery.diagnostics);

  if (context.options.validateEmittedFiles ?? true) {
    context.diagnostics.push(
      ...(await validateEmittedDeclarationTargets(
        context.options,
        discovery.entrypoints,
        emittedFiles,
      )),
    );
  }

  return finishDeclarationPipeline(
    {
      compiler: context.compiler,
      diagnostics: context.diagnostics,
      discovery,
      options: context.options,
      tsconfig: context.tsconfig,
    },
    emittedFiles,
    emitResult.emitSkipped ?? false,
  );
}

function createFastPathValidationFallbackDiagnostic(
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_FALLBACK",
    "Fast isolated declaration emit output failed Declar package validation. Falling back to the TypeScript-backed declaration path.",
    ["typescript", "transpileDeclaration"],
    fallback === "error" ? "error" : "warning",
  );
}

function createFastPathNoSourcesDiagnostic(
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_SKIPPED",
    "Fast isolated declaration emit found no supported source files in the parsed tsconfig file list.",
    ["tsconfig", "fileNames"],
    fallback === "error" ? "error" : "warning",
  );
}

async function tryEmitWithFastDeclarations(
  context: DeclarResolvedEmitContext,
  fallback: DeclarFastDeclarationFallback,
): Promise<DeclarTypeScriptDeclarationEmitResult | undefined> {
  const sourceFiles = collectDeclarIsolatedDeclarationSourceFiles(
    context.tsconfig.parsedCommandLine.fileNames,
  );

  if (sourceFiles.length === 0) {
    context.diagnostics.push(createFastPathNoSourcesDiagnostic(fallback));

    return fallback === "error"
      ? createEmitFailureResult({ diagnostics: context.diagnostics, tsconfig: context.tsconfig })
      : undefined;
  }

  const compilerOptions = createCompilerOptions(
    context.tsconfig.parsedCommandLine,
    context.options,
  );
  const fastResult = await emitIsolatedTypeScriptDeclarations({
    compiler: context.compiler,
    compilerOptions,
    declarationMap: context.options.declarationMap,
    fallback,
    files: sourceFiles,
    outDir: context.options.outDir,
    packageDir: context.options.packageDir,
    write: true,
  });

  context.diagnostics.push(...fastResult.diagnostics);

  if (fastResult.fallbackToTypeScript) {
    return undefined;
  }

  if (!fastResult.usedFastPath || hasDeclarErrors(context.diagnostics)) {
    return createEmitFailureResult({
      diagnostics: context.diagnostics,
      emittedFiles: fastResult.emittedFiles,
      tsconfig: context.tsconfig,
    });
  }

  const discovery = discoverPackageEntrypoints(context.options.packageJson);
  context.diagnostics.push(...discovery.diagnostics);

  if (context.options.validateEmittedFiles ?? true) {
    const validationDiagnostics = await validateEmittedDeclarationTargets(
      context.options,
      discovery.entrypoints,
      fastResult.emittedFiles,
    );

    if (validationDiagnostics.length > 0) {
      context.diagnostics.push(createFastPathValidationFallbackDiagnostic(fallback));

      if (fallback === "typescript") {
        return undefined;
      }

      context.diagnostics.push(...validationDiagnostics);

      return createEmitFailureResult({
        diagnostics: context.diagnostics,
        emittedFiles: fastResult.emittedFiles,
        tsconfig: context.tsconfig,
      });
    }
  }

  return finishDeclarationPipeline(
    {
      compiler: context.compiler,
      diagnostics: context.diagnostics,
      discovery,
      options: context.options,
      tsconfig: context.tsconfig,
    },
    fastResult.emittedFiles,
    false,
  );
}

export async function emitTypeScriptDeclarations(
  options: DeclarTypeScriptDeclarationEmitOptions,
): Promise<DeclarTypeScriptDeclarationEmitResult> {
  const compiler = await resolveTypeScriptCompiler(options.compiler);

  if (!compiler) {
    const diagnostic = createCompilerUnavailableDiagnostic();

    return createEmitFailureResult({
      diagnostics: [diagnostic],
      tsconfig: createUnavailableTsconfigResult(options, diagnostic),
    });
  }

  const tsconfig = loadDeclarTsconfig({
    compiler,
    declarationMap: options.declarationMap,
    outDir: options.outDir,
    packageDir: options.packageDir,
    tsconfigPath: options.tsconfigPath,
  });

  const diagnostics: DeclarDiagnostic[] = [...tsconfig.diagnostics];

  if (!tsconfig.parsedCommandLine || hasDeclarErrors(diagnostics)) {
    return createEmitFailureResult({
      diagnostics,
      tsconfig,
    });
  }

  const context: DeclarResolvedEmitContext = {
    compiler,
    diagnostics,
    options,
    tsconfig: { ...tsconfig, parsedCommandLine: tsconfig.parsedCommandLine },
  };
  const fastDeclarations = normalizeFastDeclarationMode(options.fastDeclarations);
  const fastDeclarationFallback = normalizeFastDeclarationFallback(options.fastDeclarationFallback);

  if (fastDeclarations) {
    const fastResult = await tryEmitWithFastDeclarations(context, fastDeclarationFallback);

    if (fastResult) {
      return fastResult;
    }
  }

  return emitWithTypeScript(context);
}
