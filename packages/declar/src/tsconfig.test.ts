import { describe, expect, test } from "bun:test";

import { loadDeclarTsconfig } from "./tsconfig";
import type { DeclarTypeScriptConfigAdapter } from "./tsconfig";

function createCompilerAdapter(
  overrides: Partial<DeclarTypeScriptConfigAdapter> = {},
): DeclarTypeScriptConfigAdapter {
  return {
    flattenDiagnosticMessageText: (messageText) => String(messageText),
    parseJsonConfigFileContent: () => ({
      errors: [],
      fileNames: ["/repo/packages/declar/src/index.ts"],
      options: {
        module: "esnext",
      },
    }),
    readConfigFile: () => ({
      config: {
        compilerOptions: {
          module: "esnext",
        },
      },
    }),
    sys: {
      fileExists: () => true,
      getCurrentDirectory: () => "/repo/packages/declar",
      newLine: "\n",
      readDirectory: () => ["/repo/packages/declar/src/index.ts"],
      readFile: () => "{}",
      useCaseSensitiveFileNames: true,
    },
    ...overrides,
  };
}

describe("loadDeclarTsconfig", () => {
  test("loads and parses tsconfig through a TypeScript adapter", () => {
    const result = loadDeclarTsconfig({
      compiler: createCompilerAdapter(),
      declarationMap: true,
      outDir: "dist",
      packageDir: "/repo/packages/declar",
      tsconfigPath: "tsconfig.json",
    });

    expect(result.configFilePath).toBe("/repo/packages/declar/tsconfig.json");
    expect(result.diagnostics).toEqual([]);
    expect(result.parsedCommandLine).toEqual({
      errors: [],
      fileNames: ["/repo/packages/declar/src/index.ts"],
      options: {
        module: "esnext",
      },
    });
  });

  test("reports missing compiler sys", () => {
    const result = loadDeclarTsconfig({
      compiler: {
        parseJsonConfigFileContent: createCompilerAdapter().parseJsonConfigFileContent,
        readConfigFile: createCompilerAdapter().readConfigFile,
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_TYPESCRIPT_COMPILER_UNAVAILABLE",
        message:
          "Declar needs a TypeScript compiler adapter with sys, readConfigFile, and parseJsonConfigFileContent to load tsconfig.json.",
        path: ["/repo/packages/declar/tsconfig.json"],
        severity: "error",
      },
    ]);
  });

  test("reports tsconfig read errors", () => {
    const result = loadDeclarTsconfig({
      compiler: createCompilerAdapter({
        readConfigFile: () => ({
          error: {
            messageText: "Cannot read tsconfig.json",
          },
        }),
      }),
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_TSCONFIG_READ_FAILED",
        message: "Cannot read tsconfig.json",
        path: ["/repo/packages/declar/tsconfig.json"],
        severity: "error",
      },
    ]);
  });

  test("reports tsconfig parse errors", () => {
    const result = loadDeclarTsconfig({
      compiler: createCompilerAdapter({
        parseJsonConfigFileContent: () => ({
          errors: [
            {
              messageText: "Unknown compiler option",
            },
          ],
          fileNames: [],
          options: {},
        }),
      }),
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_TSCONFIG_PARSE_FAILED",
        message: "Unknown compiler option",
        path: ["/repo/packages/declar/tsconfig.json"],
        severity: "error",
      },
    ]);
  });
});
