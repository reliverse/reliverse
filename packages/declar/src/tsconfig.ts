import { resolve } from "node:path";

import { createDeclarError } from "./diagnostics";
import type { DeclarDiagnostic } from "./types";

export interface DeclarTypeScriptSys {
  readonly fileExists: (path: string) => boolean;
  readonly getCurrentDirectory: () => string;
  readonly newLine: string;
  readonly readDirectory: (
    rootDir: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number,
  ) => readonly string[];
  readonly readFile: (path: string) => string | undefined;
  readonly useCaseSensitiveFileNames: boolean;
}

export interface DeclarTypeScriptConfigHost {
  readonly fileExists: (path: string) => boolean;
  readonly readDirectory: (
    rootDir: string,
    extensions?: readonly string[],
    excludes?: readonly string[],
    includes?: readonly string[],
    depth?: number,
  ) => readonly string[];
  readonly readFile: (path: string) => string | undefined;
  readonly useCaseSensitiveFileNames: boolean;
}

export interface DeclarTypeScriptConfigAdapter {
  readonly flattenDiagnosticMessageText?: (messageText: unknown, newLine: string) => string;
  readonly parseJsonConfigFileContent: (
    config: unknown,
    host: DeclarTypeScriptConfigHost,
    basePath: string,
    existingOptions?: Record<string, unknown>,
    configFileName?: string,
  ) => DeclarParsedCommandLine;
  readonly readConfigFile: (
    configFileName: string,
    readFile: (path: string) => string | undefined,
  ) => DeclarReadConfigFileResult;
  readonly sys?: DeclarTypeScriptSys | undefined;
}

export interface DeclarReadConfigFileResult {
  readonly config?: unknown;
  readonly error?: unknown;
}

export interface DeclarParsedCommandLine {
  readonly errors: readonly unknown[];
  readonly fileNames: readonly string[];
  readonly options: Record<string, unknown>;
}

export interface DeclarTsconfigLoadOptions {
  readonly compiler: DeclarTypeScriptConfigAdapter;
  readonly declarationMap?: boolean | undefined;
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly tsconfigPath?: string | undefined;
}

export interface DeclarTsconfigLoadResult {
  readonly configFilePath: string;
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly parsedCommandLine?: DeclarParsedCommandLine | undefined;
}

interface DeclarDiagnosticLike {
  readonly messageText?: unknown;
}

function formatTypeScriptDiagnostic(
  compiler: DeclarTypeScriptConfigAdapter,
  diagnostic: unknown,
): string {
  const diagnosticLike = diagnostic as DeclarDiagnosticLike;

  if (compiler.flattenDiagnosticMessageText && diagnosticLike.messageText !== undefined) {
    return compiler.flattenDiagnosticMessageText(
      diagnosticLike.messageText,
      compiler.sys?.newLine ?? "\n",
    );
  }

  if (typeof diagnosticLike.messageText === "string") {
    return diagnosticLike.messageText;
  }

  return "TypeScript reported a diagnostic that Declar could not format.";
}

function createParseDiagnostic(
  compiler: DeclarTypeScriptConfigAdapter,
  diagnostic: unknown,
  configFilePath: string,
): DeclarDiagnostic {
  return createDeclarError(
    "DECLAR_TSCONFIG_PARSE_FAILED",
    formatTypeScriptDiagnostic(compiler, diagnostic),
    [configFilePath],
  );
}

function createConfigHost(
  compiler: DeclarTypeScriptConfigAdapter,
): DeclarTypeScriptConfigHost | undefined {
  const sys = compiler.sys;
  if (!sys) return undefined;

  return {
    fileExists: sys.fileExists,
    readDirectory: sys.readDirectory,
    readFile: sys.readFile,
    useCaseSensitiveFileNames: sys.useCaseSensitiveFileNames,
  };
}

function createCompilerOptions(options: DeclarTsconfigLoadOptions): Record<string, unknown> {
  return {
    declaration: true,
    declarationMap: options.declarationMap ?? false,
    emitDeclarationOnly: true,
    noEmit: false,
    outDir: resolve(options.packageDir, options.outDir ?? "dist"),
  };
}

export function loadDeclarTsconfig(options: DeclarTsconfigLoadOptions): DeclarTsconfigLoadResult {
  const configFilePath = resolve(options.packageDir, options.tsconfigPath ?? "tsconfig.json");
  const configHost = createConfigHost(options.compiler);

  if (!configHost || !options.compiler.sys) {
    return {
      configFilePath,
      diagnostics: [
        createDeclarError(
          "DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE",
          "Declar needs a TypeScript compiler adapter with sys, readConfigFile, and parseJsonConfigFileContent to load tsconfig.json.",
          [configFilePath],
        ),
      ],
    };
  }

  const readResult = options.compiler.readConfigFile(configFilePath, options.compiler.sys.readFile);

  if (readResult.error) {
    return {
      configFilePath,
      diagnostics: [
        createDeclarError(
          "DECLAR_TSCONFIG_READ_FAILED",
          formatTypeScriptDiagnostic(options.compiler, readResult.error),
          [configFilePath],
        ),
      ],
    };
  }

  const parsedCommandLine = options.compiler.parseJsonConfigFileContent(
    readResult.config,
    configHost,
    options.packageDir,
    createCompilerOptions(options),
    configFilePath,
  );

  const diagnostics = parsedCommandLine.errors.map((diagnostic) =>
    createParseDiagnostic(options.compiler, diagnostic, configFilePath),
  );

  return {
    configFilePath,
    diagnostics,
    parsedCommandLine,
  };
}
