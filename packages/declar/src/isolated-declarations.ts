import {
  mkdir as defaultMkdir,
  readFile as defaultReadFile,
  writeFile as defaultWriteFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import { createDeclarDiagnostic } from "./diagnostics";
import type { DeclarDiagnostic, DeclarFastDeclarationFallback } from "./types";

export interface DeclarTranspileDeclarationOptions {
  readonly compilerOptions?: Record<string, unknown> | undefined;
  readonly fileName?: string | undefined;
  readonly reportDiagnostics?: boolean | undefined;
}

export interface DeclarTranspileDeclarationResult {
  readonly diagnostics?: readonly unknown[] | undefined;
  readonly outputText?: string | undefined;
  readonly sourceMapText?: string | undefined;
}

export interface DeclarIsolatedDeclarationCompilerAdapter {
  readonly flattenDiagnosticMessageText?: (messageText: unknown, newLine: string) => string;
  readonly sys?: {
    readonly newLine?: string | undefined;
  } | undefined;
  readonly transpileDeclaration?: (
    sourceText: string,
    options: DeclarTranspileDeclarationOptions,
  ) => DeclarTranspileDeclarationResult;
}

export interface DeclarIsolatedDeclarationHost {
  readonly mkdir?: (path: string) => Promise<void>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
}

export interface DeclarIsolatedDeclarationEmitOptions {
  readonly compiler: DeclarIsolatedDeclarationCompilerAdapter;
  readonly compilerOptions?: Record<string, unknown> | undefined;
  readonly declarationMap?: boolean | undefined;
  readonly fallback?: DeclarFastDeclarationFallback | undefined;
  readonly files: readonly string[];
  readonly host?: DeclarIsolatedDeclarationHost | undefined;
  readonly outDir?: string | undefined;
  readonly packageDir: string;
  readonly rootDir?: string | undefined;
  readonly write?: boolean | undefined;
}

export interface DeclarIsolatedDeclarationEmitResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly emittedFiles: readonly string[];
  readonly fallbackToTypeScript: boolean;
  readonly skippedFiles: readonly string[];
  readonly usedFastPath: boolean;
}

interface RequiredDeclarIsolatedDeclarationHost {
  readonly mkdir: (path: string) => Promise<void>;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
}

interface DeclarOutputPathResult {
  readonly diagnostics: readonly DeclarDiagnostic[];
  readonly path?: string | undefined;
}

function createDefaultHost(
  host: DeclarIsolatedDeclarationHost | undefined,
): RequiredDeclarIsolatedDeclarationHost {
  return {
    mkdir: host?.mkdir ?? ((path) => defaultMkdir(path, { recursive: true }).then(() => undefined)),
    readFile: host?.readFile ?? ((path) => defaultReadFile(path, "utf8")),
    writeFile: host?.writeFile ?? ((path, contents) => defaultWriteFile(path, contents)),
  };
}

function normalizePackagePath(packageDir: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(packageDir, path);
}

function normalizeSlashes(path: string): string {
  return path.split(sep).join("/");
}

function getSourceBaseName(filePath: string): string {
  const extension = extname(filePath);
  return extension ? filePath.slice(0, -extension.length) : filePath;
}

function getDeclarationExtension(filePath: string): string {
  if (filePath.endsWith(".mts")) {
    return ".d.mts";
  }

  if (filePath.endsWith(".cts")) {
    return ".d.cts";
  }

  return ".d.ts";
}

function getConfiguredRootDir(options: DeclarIsolatedDeclarationEmitOptions): string {
  if (options.rootDir) {
    return normalizePackagePath(options.packageDir, options.rootDir);
  }

  const compilerRootDir = options.compilerOptions?.rootDir;

  if (typeof compilerRootDir === "string") {
    return normalizePackagePath(options.packageDir, compilerRootDir);
  }

  return resolve(options.packageDir);
}

function getOutputPath(
  options: DeclarIsolatedDeclarationEmitOptions,
  sourceFilePath: string,
): DeclarOutputPathResult {
  const packageDir = resolve(options.packageDir);
  const rootDir = getConfiguredRootDir(options);
  const outDir = normalizePackagePath(packageDir, options.outDir ?? "dist");
  const relativeSourcePath = normalizeSlashes(relative(rootDir, sourceFilePath));

  if (relativeSourcePath.startsWith("../") || relativeSourcePath === "..") {
    return {
      diagnostics: [
        createDeclarDiagnostic(
          "DECLAR_FAST_PATH_INVALID_OUTPUT",
          `Fast declaration emit cannot map ${sourceFilePath} because it is outside rootDir ${rootDir}.`,
          [sourceFilePath],
          "error",
        ),
      ],
    };
  }

  const declarationPath = `${getSourceBaseName(relativeSourcePath)}${getDeclarationExtension(
    sourceFilePath,
  )}`;

  return {
    diagnostics: [],
    path: normalizeSlashes(resolve(outDir, declarationPath)),
  };
}

function formatCompilerDiagnostics(
  compiler: DeclarIsolatedDeclarationCompilerAdapter,
  diagnostics: readonly unknown[],
): string {
  const newLine = compiler.sys?.newLine ?? "\n";

  return diagnostics
    .map((diagnostic) => {
      const messageText = (diagnostic as { readonly messageText?: unknown }).messageText;

      if (compiler.flattenDiagnosticMessageText && messageText !== undefined) {
        return compiler.flattenDiagnosticMessageText(messageText, newLine);
      }

      if (typeof messageText === "string") {
        return messageText;
      }

      if (typeof diagnostic === "string") {
        return diagnostic;
      }

      return "TypeScript isolated declaration emit reported an unsupported diagnostic.";
    })
    .join(newLine);
}

function getFallbackSeverity(fallback: DeclarFastDeclarationFallback): "error" | "warning" {
  return fallback === "error" ? "error" : "warning";
}

function createFastPathUnavailableDiagnostic(
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_EMITTER_UNAVAILABLE",
    "Fast isolated declaration emit needs TypeScript 5.5+ transpileDeclaration support. Falling back to the TypeScript-backed declaration path.",
    ["typescript", "transpileDeclaration"],
    getFallbackSeverity(fallback),
  );
}

function createFastPathFallbackDiagnostic(
  path: string,
  reason: string,
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_FALLBACK",
    `Fast isolated declaration emit was skipped for ${path}. Reason: ${reason}.`,
    [path],
    getFallbackSeverity(fallback),
  );
}

function createFastPathUnsupportedSyntaxDiagnostic(
  path: string,
  reason: string,
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX",
    `Fast isolated declaration emit could not safely emit ${path}. Reason: ${reason}.`,
    [path],
    getFallbackSeverity(fallback),
  );
}

function createFastPathUsedDiagnostic(path: string, outputPath: string): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_USED",
    `Fast isolated declaration emit produced ${outputPath} from ${path}.`,
    [path, outputPath],
    "info",
  );
}

function createFastPathInvalidOutputDiagnostic(
  path: string,
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_INVALID_OUTPUT",
    `Fast isolated declaration emit did not produce declaration text for ${path}.`,
    [path],
    getFallbackSeverity(fallback),
  );
}

function createCompilerOptions(options: DeclarIsolatedDeclarationEmitOptions): Record<string, unknown> {
  return {
    ...options.compilerOptions,
    declaration: true,
    declarationMap: options.declarationMap ?? false,
    emitDeclarationOnly: true,
    isolatedDeclarations: true,
    noEmit: false,
  };
}

export async function emitIsolatedTypeScriptDeclarations(
  options: DeclarIsolatedDeclarationEmitOptions,
): Promise<DeclarIsolatedDeclarationEmitResult> {
  const fallback = options.fallback ?? "typescript";
  const host = createDefaultHost(options.host);
  const diagnostics: DeclarDiagnostic[] = [];
  const emittedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const transpileDeclaration = options.compiler.transpileDeclaration;

  if (!transpileDeclaration) {
    diagnostics.push(createFastPathUnavailableDiagnostic(fallback));

    return {
      diagnostics,
      emittedFiles,
      fallbackToTypeScript: fallback === "typescript",
      skippedFiles: [...options.files],
      usedFastPath: false,
    };
  }

  for (const file of options.files) {
    const sourceFilePath = normalizePackagePath(options.packageDir, file);
    const outputPathResult = getOutputPath(options, sourceFilePath);

    diagnostics.push(...outputPathResult.diagnostics);

    if (!outputPathResult.path) {
      skippedFiles.push(sourceFilePath);
      continue;
    }

    let sourceText: string;

    try {
      sourceText = await host.readFile(sourceFilePath);
    } catch {
      diagnostics.push(
        createFastPathFallbackDiagnostic(
          sourceFilePath,
          "source file could not be read",
          fallback,
        ),
      );
      skippedFiles.push(sourceFilePath);
      continue;
    }

    const result = transpileDeclaration(sourceText, {
      compilerOptions: createCompilerOptions(options),
      fileName: sourceFilePath,
      reportDiagnostics: true,
    });

    const compilerDiagnostics = result.diagnostics ?? [];

    if (compilerDiagnostics.length > 0) {
      diagnostics.push(
        createFastPathUnsupportedSyntaxDiagnostic(
          sourceFilePath,
          formatCompilerDiagnostics(options.compiler, compilerDiagnostics),
          fallback,
        ),
      );
      skippedFiles.push(sourceFilePath);
      continue;
    }

    if (typeof result.outputText !== "string" || result.outputText.length === 0) {
      diagnostics.push(createFastPathInvalidOutputDiagnostic(sourceFilePath, fallback));
      skippedFiles.push(sourceFilePath);
      continue;
    }

    if (options.write !== false) {
      await host.mkdir(dirname(outputPathResult.path));
      await host.writeFile(outputPathResult.path, result.outputText);
    }

    emittedFiles.push(outputPathResult.path);
    diagnostics.push(createFastPathUsedDiagnostic(sourceFilePath, outputPathResult.path));
  }

  return {
    diagnostics,
    emittedFiles,
    fallbackToTypeScript: fallback === "typescript" && skippedFiles.length > 0,
    skippedFiles,
    usedFastPath: emittedFiles.length > 0,
  };
}
