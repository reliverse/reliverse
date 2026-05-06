import { describe, expect, test } from "bun:test";

import {
  collectDeclarIsolatedDeclarationSourceFiles,
  emitIsolatedTypeScriptDeclarations,
} from "./isolated-declarations";
import type { DeclarIsolatedDeclarationCompilerAdapter } from "./isolated-declarations";

function createMemoryHost(files: Record<string, string>) {
  const writes = new Map<string, string>();
  const directories = new Set<string>();

  return {
    directories,
    host: {
      mkdir: async (path: string) => {
        directories.add(path);
      },
      readFile: async (path: string) => {
        const contents = files[path];

        if (contents === undefined) {
          throw new Error(`Missing fixture file: ${path}`);
        }

        return contents;
      },
      writeFile: async (path: string, contents: string) => {
        writes.set(path, contents);
      },
    },
    writes,
  };
}

describe("collectDeclarIsolatedDeclarationSourceFiles", () => {
  test("keeps supported source files and skips declaration/runtime files", () => {
    expect(
      collectDeclarIsolatedDeclarationSourceFiles([
        "/repo/src/index.ts",
        "/repo/src/view.tsx",
        "/repo/src/esm.mts",
        "/repo/src/cjs.cts",
        "/repo/src/index.d.ts",
        "/repo/src/runtime.js",
      ]),
    ).toEqual([
      "/repo/src/index.ts",
      "/repo/src/view.tsx",
      "/repo/src/esm.mts",
      "/repo/src/cjs.cts",
    ]);
  });
});

describe("emitIsolatedTypeScriptDeclarations", () => {
  test("emits declarations through TypeScript transpileDeclaration", async () => {
    const packageDir = "/repo/packages/declar";
    const sourcePath = `${packageDir}/src/index.ts`;
    const { host, writes } = createMemoryHost({
      [sourcePath]: "export const value: number = 1;\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      transpileDeclaration: () => ({
        diagnostics: [],
        outputText: "export declare const value: number;\n",
      }),
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      files: ["src/index.ts"],
      host,
      outDir: "dist",
      packageDir,
      rootDir: "src",
    });

    expect(result).toEqual({
      diagnostics: [
        {
          code: "DECLAR_FAST_PATH_USED",
          message: `Fast isolated declaration emit produced ${packageDir}/dist/index.d.ts from ${sourcePath}.`,
          path: [sourcePath, `${packageDir}/dist/index.d.ts`],
          severity: "info",
        },
      ],
      emittedFiles: [`${packageDir}/dist/index.d.ts`],
      fallbackToTypeScript: false,
      skippedFiles: [],
      usedFastPath: true,
    });
    expect(writes.get(`${packageDir}/dist/index.d.ts`)).toBe(
      "export declare const value: number;\n",
    );
  });

  test("maps module source extensions to declaration extensions", async () => {
    const packageDir = "/repo/packages/declar";
    const { host } = createMemoryHost({
      [`${packageDir}/src/index.mts`]: "export const esm: number = 1;\n",
      [`${packageDir}/src/index.cts`]: "export const cjs: number = 1;\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      transpileDeclaration: () => ({
        diagnostics: [],
        outputText: "export declare const value: number;\n",
      }),
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      files: ["src/index.mts", "src/index.cts"],
      host,
      packageDir,
      rootDir: "src",
      write: false,
    });

    expect(result.emittedFiles).toEqual([
      `${packageDir}/dist/index.d.mts`,
      `${packageDir}/dist/index.d.cts`,
    ]);
    expect(result.usedFastPath).toBe(true);
    expect(result.fallbackToTypeScript).toBe(false);
  });

  test("does not write partial fast output before falling back", async () => {
    const packageDir = "/repo/packages/declar";
    const goodPath = `${packageDir}/src/good.ts`;
    const unsafePath = `${packageDir}/src/unsafe.ts`;
    const { host, writes } = createMemoryHost({
      [goodPath]: "export const good: number = 1;\n",
      [unsafePath]: "export function unsafe() { return 1; }\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      flattenDiagnosticMessageText: (messageText) => String(messageText),
      transpileDeclaration: (sourceText: string) =>
        sourceText.includes("unsafe")
          ? {
              diagnostics: [{ messageText: "Function must have an explicit return type." }],
              outputText: "",
            }
          : {
              diagnostics: [],
              outputText: "export declare const good: number;\n",
            },
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      files: ["src/good.ts", "src/unsafe.ts"],
      host,
      packageDir,
      rootDir: "src",
    });

    expect(result.fallbackToTypeScript).toBe(true);
    expect(result.emittedFiles).toEqual([]);
    expect(result.usedFastPath).toBe(false);
    expect(writes.size).toBe(0);
  });

  test("writes declaration maps when the fast emitter returns one", async () => {
    const packageDir = "/repo/packages/declar";
    const sourcePath = `${packageDir}/src/index.ts`;
    const { host, writes } = createMemoryHost({
      [sourcePath]: "export const value: number = 1;\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      transpileDeclaration: () => ({
        diagnostics: [],
        outputText: "export declare const value: number;\n",
        sourceMapText: "{}",
      }),
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      declarationMap: true,
      files: ["src/index.ts"],
      host,
      packageDir,
      rootDir: "src",
    });

    expect(result.emittedFiles).toEqual([
      `${packageDir}/dist/index.d.ts`,
      `${packageDir}/dist/index.d.ts.map`,
    ]);
    expect(writes.get(`${packageDir}/dist/index.d.ts.map`)).toBe("{}");
  });

  test("reports explicit TypeScript fallback when transpileDeclaration is unavailable", async () => {
    const result = await emitIsolatedTypeScriptDeclarations({
      compiler: {},
      files: ["src/index.ts"],
      packageDir: "/repo/packages/declar",
    });

    expect(result).toEqual({
      diagnostics: [
        {
          code: "DECLAR_FAST_PATH_EMITTER_UNAVAILABLE",
          message:
            "Fast isolated declaration emit needs TypeScript 5.5+ transpileDeclaration support. Falling back to the TypeScript-backed declaration path.",
          path: ["typescript", "transpileDeclaration"],
          severity: "warning",
        },
      ],
      emittedFiles: [],
      fallbackToTypeScript: true,
      skippedFiles: ["src/index.ts"],
      usedFastPath: false,
    });
  });

  test("can make fast path fallback failures fatal", async () => {
    const result = await emitIsolatedTypeScriptDeclarations({
      compiler: {},
      fallback: "error",
      files: ["src/index.ts"],
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.fallbackToTypeScript).toBe(false);
  });

  test("falls back when TypeScript reports isolated declaration diagnostics", async () => {
    const packageDir = "/repo/packages/declar";
    const sourcePath = `${packageDir}/src/index.ts`;
    const { host } = createMemoryHost({
      [sourcePath]: "export function value() { return 1; }\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      flattenDiagnosticMessageText: (messageText) => String(messageText),
      transpileDeclaration: () => ({
        diagnostics: [{ messageText: "Function must have an explicit return type." }],
        outputText: "",
      }),
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      files: ["src/index.ts"],
      host,
      packageDir,
      rootDir: "src",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX",
        message: `Fast isolated declaration emit could not safely emit ${sourcePath}. Reason: Function must have an explicit return type..`,
        path: [sourcePath],
        severity: "warning",
      },
    ]);
    expect(result.emittedFiles).toEqual([]);
    expect(result.fallbackToTypeScript).toBe(true);
    expect(result.skippedFiles).toEqual([sourcePath]);
    expect(result.usedFastPath).toBe(false);
  });

  test("reports invalid output when a fast emitter returns no declaration text", async () => {
    const packageDir = "/repo/packages/declar";
    const sourcePath = `${packageDir}/src/index.ts`;
    const { host } = createMemoryHost({
      [sourcePath]: "export const value: number = 1;\n",
    });

    const compiler: DeclarIsolatedDeclarationCompilerAdapter = {
      transpileDeclaration: () => ({
        diagnostics: [],
      }),
    };

    const result = await emitIsolatedTypeScriptDeclarations({
      compiler,
      files: ["src/index.ts"],
      host,
      packageDir,
      rootDir: "src",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_FAST_PATH_INVALID_OUTPUT",
        message: `Fast isolated declaration emit did not produce declaration text for ${sourcePath}.`,
        path: [sourcePath],
        severity: "warning",
      },
    ]);
    expect(result.fallbackToTypeScript).toBe(true);
  });
});
