import { resolve } from "node:path";

import {
  type DeclarDeclarationBundleHost,
  bundleTypeScriptDeclarations,
} from "./bundle-declarations";
import { createDeclarError, hasDeclarErrors } from "./diagnostics";
import { discoverPackageEntrypoints } from "./package-exports";
import {
  type DeclarParsedCommandLine,
  type DeclarTsconfigLoadResult,
  type DeclarTypeScriptConfigAdapter,
  loadDeclarTsconfig,
} from "./tsconfig";
import type { DeclarDiagnostic, DeclarPackageJson } from "./types";
import { validateDeclarEmittedFiles, validateDeclarEntrypointFiles } from "./validate";

export interface DeclarTypeScriptEmitAdapter extends DeclarTypeScriptConfigAdapter {
  createProgram(options: { rootNames: readonly string[]; options: any }): DeclarTypeScriptProgram;
  // any here is fine because this is a boundary to the external compiler api
  getPreEmitDiagnostics(program: any): readonly unknown[];
}

export interface DeclarTypeScriptProgram {
  readonly emit: (
    targetSourceFile?: unknown,
    writeFile?: unknown,
    cancellationToken?: unknown,
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
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly packageJson: DeclarPackageJson;
  readonly rollup?: boolean | undefined;
  readonly tsconfigPath?: string | undefined;
  readonly validateEmittedFiles?: boolean | undefined;
}

export interface DeclarTypeScriptDeclarationEmitResult {
  readonly bundledFiles: readonly string[];
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles: readonly string[];
  readonly emitSkipped: boolean;
  readonly tsconfig: DeclarTsconfigLoadResult;
}

type TypeScriptModule = DeclarTypeScriptEmitAdapter & {
  readonly default?: DeclarTypeScriptEmitAdapter | undefined;
};

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

function isTypeScriptEmitAdapter(value: unknown): value is DeclarTypeScriptEmitAdapter {
  const compiler = value as Partial<DeclarTypeScriptEmitAdapter>;

  return (
    typeof compiler === "object" &&
    compiler !== null &&
    typeof compiler.createProgram === "function" &&
    typeof compiler.parseJsonConfigFileContent === "function" &&
    typeof compiler.readConfigFile === "function"
  );
}

async function importDefaultTypeScriptCompiler(): Promise<DeclarTypeScriptEmitAdapter | undefined> {
  try {
    const compilerModule = (await import("typescript")) as TypeScriptModule;
    return compilerModule.default ?? compilerModule;
  } catch {
    return undefined;
  }
}

async function resolveTypeScriptCompiler(
  compiler: DeclarTypeScriptEmitAdapter | undefined,
): Promise<DeclarTypeScriptEmitAdapter | undefined> {
  if (compiler) {
    return isTypeScriptEmitAdapter(compiler) ? compiler : undefined;
  }

  const defaultCompiler = await importDefaultTypeScriptCompiler();
  return isTypeScriptEmitAdapter(defaultCompiler) ? defaultCompiler : undefined;
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

function createCompilerUnavailableDiagnostic(): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE",
    "Declar needs a TypeScript compiler. Pass compiler: ts to emitTypeScriptDeclarations, or install TypeScript so Declar can load it automatically.",
    ["typescript"],
  );
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
  return `${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}:${diagnostic.path?.join("/") ?? ""}`;
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

export async function emitTypeScriptDeclarations(
  options: DeclarTypeScriptDeclarationEmitOptions,
): Promise<DeclarTypeScriptDeclarationEmitResult> {
  const compiler = await resolveTypeScriptCompiler(options.compiler);

  if (!compiler) {
    const diagnostic = createCompilerUnavailableDiagnostic();

    return {
      bundledFiles: [],
      diagnostics: [diagnostic],
      emittedFiles: [],
      emitSkipped: true,
      tsconfig: createUnavailableTsconfigResult(options, diagnostic),
    };
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
    return {
      bundledFiles: [],
      diagnostics,
      emittedFiles: [],
      emitSkipped: true,
      tsconfig,
    };
  }

  const compilerOptions = createCompilerOptions(tsconfig.parsedCommandLine, options);
  const program = compiler.createProgram(tsconfig.parsedCommandLine.fileNames, compilerOptions);
  const preEmitDiagnostics = compiler.getPreEmitDiagnostics?.(program) ?? [];

  if (preEmitDiagnostics.length > 0) {
    diagnostics.push(createTypeScriptEmitDiagnostic(compiler, preEmitDiagnostics));

    return {
      bundledFiles: [],
      diagnostics,
      emittedFiles: [],
      emitSkipped: true,
      tsconfig,
    };
  }

  const emitResult = program.emit(undefined, undefined, undefined, true);
  const emittedFiles = emitResult.emittedFiles ?? [];
  const emitDiagnostics = emitResult.diagnostics ?? [];

  if (emitDiagnostics.length > 0 || emitResult.emitSkipped) {
    diagnostics.push(createTypeScriptEmitDiagnostic(compiler, emitDiagnostics));

    return {
      bundledFiles: [],
      diagnostics: dedupeDiagnostics(diagnostics),
      emittedFiles,
      emitSkipped: emitResult.emitSkipped ?? true,
      tsconfig,
    };
  }

  const discovery = discoverPackageEntrypoints(options.packageJson);
  diagnostics.push(...discovery.diagnostics);

  if (options.validateEmittedFiles ?? true) {
    const emittedValidation = validateDeclarEmittedFiles({
      emittedFiles,
      entrypoints: discovery.entrypoints,
      packageDir: options.packageDir,
    });
    const fileValidation = await validateDeclarEntrypointFiles({
      checkRuntimeTargets: options.checkRuntimeTargets,
      entrypoints: discovery.entrypoints,
      packageDir: options.packageDir,
    });

    diagnostics.push(...emittedValidation.diagnostics, ...fileValidation.diagnostics);
  }

  const bundledFiles: string[] = [];

  if (options.rollup && !hasDeclarErrors(diagnostics)) {
    const bundleResult = await bundleTypeScriptDeclarations({
      entrypoints: discovery.entrypoints,
      host: options.bundleHost,
      packageDir: options.packageDir,
    });

    diagnostics.push(...bundleResult.diagnostics);
    bundledFiles.push(...bundleResult.bundles.map((bundle) => bundle.path));
  }

  return {
    bundledFiles,
    diagnostics: dedupeDiagnostics(diagnostics),
    emittedFiles,
    emitSkipped: emitResult.emitSkipped ?? false,
    tsconfig,
  };
}
