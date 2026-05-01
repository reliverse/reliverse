import { resolve } from "node:path";

import { createDeclarError, hasDeclarErrors } from "./diagnostics";
import { discoverPackageEntrypoints } from "./package-exports";
import {
  type DeclarParsedCommandLine,
  type DeclarTsconfigLoadResult,
  type DeclarTypeScriptConfigAdapter,
  loadDeclarTsconfig,
} from "./tsconfig";
import type { DeclarDiagnostic, DeclarPackageJson } from "./types";
import { validateDeclarEntrypointFiles } from "./validate";

export interface DeclarTypeScriptEmitAdapter extends DeclarTypeScriptConfigAdapter {
  readonly createProgram: (
    rootNames: readonly string[],
    options: Record<string, unknown>,
  ) => DeclarTypeScriptProgram;
  readonly formatDiagnosticsWithColorAndContext?: (
    diagnostics: readonly unknown[],
    host: DeclarTypeScriptFormatHost,
  ) => string;
  readonly getPreEmitDiagnostics?: (program: DeclarTypeScriptProgram) => readonly unknown[];
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
  readonly checkRuntimeTargets?: boolean | undefined;
  readonly compiler: DeclarTypeScriptEmitAdapter;
  readonly declarationMap?: boolean | undefined;
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly packageJson: DeclarPackageJson;
  readonly tsconfigPath?: string | undefined;
  readonly validateEmittedFiles?: boolean | undefined;
}

export interface DeclarTypeScriptDeclarationEmitResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles: readonly string[];
  readonly emitSkipped: boolean;
  readonly tsconfig: DeclarTsconfigLoadResult;
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

export async function emitTypeScriptDeclarations(
  options: DeclarTypeScriptDeclarationEmitOptions,
): Promise<DeclarTypeScriptDeclarationEmitResult> {
  const tsconfig = loadDeclarTsconfig({
    compiler: options.compiler,
    declarationMap: options.declarationMap,
    outDir: options.outDir,
    packageDir: options.packageDir,
    tsconfigPath: options.tsconfigPath,
  });

  const diagnostics: DeclarDiagnostic[] = [...tsconfig.diagnostics];

  if (!tsconfig.parsedCommandLine || hasDeclarErrors(diagnostics)) {
    return {
      diagnostics,
      emittedFiles: [],
      emitSkipped: true,
      tsconfig,
    };
  }

  const compilerOptions = createCompilerOptions(tsconfig.parsedCommandLine, options);
  const program = options.compiler.createProgram(
    tsconfig.parsedCommandLine.fileNames,
    compilerOptions,
  );
  const preEmitDiagnostics = options.compiler.getPreEmitDiagnostics?.(program) ?? [];

  if (preEmitDiagnostics.length > 0) {
    diagnostics.push(createTypeScriptEmitDiagnostic(options.compiler, preEmitDiagnostics));

    return {
      diagnostics,
      emittedFiles: [],
      emitSkipped: true,
      tsconfig,
    };
  }

  const emitResult = program.emit(undefined, undefined, undefined, true);
  const emitDiagnostics = emitResult.diagnostics ?? [];

  if (emitDiagnostics.length > 0 || emitResult.emitSkipped) {
    diagnostics.push(createTypeScriptEmitDiagnostic(options.compiler, emitDiagnostics));
  }

  if (options.validateEmittedFiles ?? true) {
    const discovery = discoverPackageEntrypoints(options.packageJson);
    const validation = await validateDeclarEntrypointFiles({
      checkRuntimeTargets: options.checkRuntimeTargets,
      entrypoints: discovery.entrypoints,
      packageDir: options.packageDir,
    });

    diagnostics.push(...discovery.diagnostics, ...validation.diagnostics);
  }

  return {
    diagnostics,
    emittedFiles: emitResult.emittedFiles ?? [],
    emitSkipped: emitResult.emitSkipped ?? false,
    tsconfig,
  };
}
