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
  readonly flattenDiagnosticMessageText?: (...args: any[]) => string;
  readonly sys?:
    | {
        readonly newLine?: string | undefined;
      }
    | undefined;

  // any[] is intentional here because this is a boundary to TypeScript's public API.
  // TypeScript 5.5+ exposes `transpileDeclaration` with a concrete TranspileOptions type,
  // and keeping that exact shape here would make `typeof ts` fail assignment under
  // `exactOptionalPropertyTypes`.
  readonly transpileDeclaration?: (...args: any[]) => DeclarTranspileDeclarationResult;
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

const supportedSourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

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

function isDeclarationFile(filePath: string): boolean {
  return filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts");
}

function isSupportedSourceFile(filePath: string): boolean {
  return supportedSourceExtensions.has(extname(filePath)) && !isDeclarationFile(filePath);
}

function getCompilerStringOption(
  options: Record<string, unknown> | undefined,
  key: "outDir" | "rootDir",
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

function getConfiguredRootDir(options: DeclarIsolatedDeclarationEmitOptions): string {
  const rootDir = options.rootDir ?? getCompilerStringOption(options.compilerOptions, "rootDir");

  return rootDir ? normalizePackagePath(options.packageDir, rootDir) : resolve(options.packageDir);
}

function getConfiguredOutDir(options: DeclarIsolatedDeclarationEmitOptions): string {
  const outDir =
    options.outDir ?? getCompilerStringOption(options.compilerOptions, "outDir") ?? "dist";

  return normalizePackagePath(options.packageDir, outDir);
}

function getOutputPath(
  options: DeclarIsolatedDeclarationEmitOptions,
  sourceFilePath: string,
  fallback: DeclarFastDeclarationFallback,
): DeclarOutputPathResult {
  const rootDir = getConfiguredRootDir(options);
  const outDir = getConfiguredOutDir(options);
  const relativeSourcePath = normalizeSlashes(relative(rootDir, sourceFilePath));

  if (relativeSourcePath.startsWith("../") || relativeSourcePath === "..") {
    return {
      diagnostics: [
        createDeclarDiagnostic(
          "DECLAR_FAST_PATH_INVALID_OUTPUT",
          `Fast declaration emit cannot map ${sourceFilePath} because it is outside rootDir ${rootDir}.`,
          [sourceFilePath],
          getFallbackSeverity(fallback),
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
    .filter(Boolean)
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

function createFastPathSkippedDiagnostic(
  path: string,
  reason: string,
  fallback: DeclarFastDeclarationFallback,
): DeclarDiagnostic {
  return createDeclarDiagnostic(
    "DECLAR_FAST_PATH_SKIPPED",
    `Fast isolated declaration emit skipped ${path}. Reason: ${reason}.`,
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

function createCompilerOptions(
  options: DeclarIsolatedDeclarationEmitOptions,
): Record<string, unknown> {
  return {
    ...options.compilerOptions,
    declaration: true,
    declarationMap: options.declarationMap ?? false,
    emitDeclarationOnly: true,
    isolatedDeclarations: true,
    noEmit: false,
  };
}

export function collectDeclarIsolatedDeclarationSourceFiles(
  files: readonly string[],
): readonly string[] {
  return files.filter(isSupportedSourceFile);
}

export async function emitIsolatedTypeScriptDeclarations(
  options: DeclarIsolatedDeclarationEmitOptions,
): Promise<DeclarIsolatedDeclarationEmitResult> {
  const fallback = options.fallback ?? "typescript";
  const host = createDefaultHost(options.host);
  const diagnostics: DeclarDiagnostic[] = [];
  const emittedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const pendingOutputs: { readonly path: string; readonly sourceMapText?: string; readonly text: string }[] = [];
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

  const sourceFiles = collectDeclarIsolatedDeclarationSourceFiles(options.files);

  for (const file of options.files) {
    if (sourceFiles.includes(file)) continue;

    diagnostics.push(
      createFastPathSkippedDiagnostic(file, "file extension is not supported", fallback),
    );
    skippedFiles.push(file);
  }

  if (sourceFiles.length === 0) {
    return {
      diagnostics,
      emittedFiles,
      fallbackToTypeScript: fallback === "typescript",
      skippedFiles,
      usedFastPath: false,
    };
  }

  for (const file of sourceFiles) {
    const sourceFilePath = normalizePackagePath(options.packageDir, file);
    const outputPathResult = getOutputPath(options, sourceFilePath, fallback);

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
        createFastPathFallbackDiagnostic(sourceFilePath, "source file could not be read", fallback),
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

    if (typeof result.outputText !== "string") {
      diagnostics.push(createFastPathInvalidOutputDiagnostic(sourceFilePath, fallback));
      skippedFiles.push(sourceFilePath);
      continue;
    }

    pendingOutputs.push({
      path: outputPathResult.path,
      ...(result.sourceMapText === undefined ? {} : { sourceMapText: result.sourceMapText }),
      text: result.outputText,
    });
    diagnostics.push(createFastPathUsedDiagnostic(sourceFilePath, outputPathResult.path));
  }

  const fallbackToTypeScript = fallback === "typescript" && skippedFiles.length > 0;
  const usedFastPath = pendingOutputs.length > 0 && !fallbackToTypeScript;

  if (usedFastPath) {
    for (const output of pendingOutputs) {
      if (options.write !== false) {
        await host.mkdir(dirname(output.path));
        await host.writeFile(output.path, output.text);

        if (output.sourceMapText) {
          await host.writeFile(`${output.path}.map`, output.sourceMapText);
        }
      }

      emittedFiles.push(output.path);
      if (output.sourceMapText) emittedFiles.push(`${output.path}.map`);
    }
  }

  return {
    diagnostics,
    emittedFiles,
    fallbackToTypeScript,
    skippedFiles,
    usedFastPath,
  };
}
