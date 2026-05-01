import { describe, expect, test } from "bun:test";

import type { DeclarEntrypoint } from "./types";
import { validateDeclarEntrypointFiles } from "./validate";

function createEntrypoint(typesPath: string): DeclarEntrypoint {
  return {
    exportPath: ".",
    importPath: "./dist/index.js",
    kind: "root",
    runtimeConditions: [
      {
        condition: "import",
        path: "./dist/index.js",
      },
    ],
    typesConditions: [
      {
        condition: "types",
        path: typesPath,
      },
    ],
    typesPath,
  };
}

describe("validateDeclarEntrypointFiles", () => {
  test("passes when declaration targets exist", async () => {
    const result = await validateDeclarEntrypointFiles({
      entrypoints: [createEntrypoint("./dist/index.d.ts")],
      host: {
        access: async () => {},
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([]);
  });

  test("reports missing declaration targets", async () => {
    const result = await validateDeclarEntrypointFiles({
      entrypoints: [createEntrypoint("./dist/index.d.ts")],
      host: {
        access: async () => {
          throw new Error("missing");
        },
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_DECLARATION_TARGET_MISSING",
        message:
          "Export . declares types at ./dist/index.d.ts, but the declaration file does not exist.",
        path: ["package.json", "exports", "."],
        severity: "error",
      },
    ]);
  });

  test("can validate runtime targets when requested", async () => {
    const checkedPaths: string[] = [];

    const result = await validateDeclarEntrypointFiles({
      checkRuntimeTargets: true,
      entrypoints: [createEntrypoint("./dist/index.d.ts")],
      host: {
        access: async (path) => {
          checkedPaths.push(path);
        },
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([]);
    expect(checkedPaths).toEqual([
      "/repo/packages/declar/dist/index.d.ts",
      "/repo/packages/declar/dist/index.js",
    ]);
  });

  test("rejects targets that resolve outside the package directory", async () => {
    const result = await validateDeclarEntrypointFiles({
      entrypoints: [createEntrypoint("./../dist/index.d.ts")],
      host: {
        access: async () => {},
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_TARGET_OUTSIDE_PACKAGE",
        message:
          "Export . declares types at ./../dist/index.d.ts, but the target resolves outside the package directory.",
        path: ["package.json", "exports", "."],
        severity: "error",
      },
    ]);
  });

  test("skips pattern targets until filesystem-aware pattern expansion exists", async () => {
    const result = await validateDeclarEntrypointFiles({
      entrypoints: [createEntrypoint("./dist/*.d.ts")],
      host: {
        access: async () => {
          throw new Error("patterns should not be checked directly");
        },
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.diagnostics).toEqual([]);
  });
});
