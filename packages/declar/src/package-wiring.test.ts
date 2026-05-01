import { describe, expect, test } from "bun:test";

import { wireDeclarPackageTypes } from "./package-wiring";
import type { DeclarEntrypoint } from "./types";

function createRootEntrypoint(typesPath = "./dist/index.d.ts"): DeclarEntrypoint {
  return {
    exportPath: ".",
    importPath: "./dist/index.js",
    kind: "root",
    runtimeConditions: [{ condition: "import", path: "./dist/index.js" }],
    typesConditions: [{ condition: "types", path: typesPath }],
    typesPath,
  };
}

describe("wireDeclarPackageTypes", () => {
  test("adds top-level types and export types for the root entrypoint", async () => {
    const result = await wireDeclarPackageTypes({
      entrypoints: [createRootEntrypoint()],
      packageJson: {
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.wrotePackageJson).toBe(false);
    expect(result.packageJson).toEqual({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
      types: "./dist/index.d.ts",
    });
  });

  test("wires direct root conditional exports", async () => {
    const result = await wireDeclarPackageTypes({
      entrypoints: [createRootEntrypoint()],
      packageJson: {
        exports: {
          import: "./dist/index.js",
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.packageJson.exports).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
  });

  test("wires nested import and require declaration conditions", async () => {
    const entrypoint: DeclarEntrypoint = {
      exportPath: ".",
      importPath: "./dist/index.mjs",
      importTypesPath: "./dist/index.d.mts",
      kind: "root",
      requirePath: "./dist/index.cjs",
      requireTypesPath: "./dist/index.d.cts",
      runtimeConditions: [
        { condition: "import", path: "./dist/index.mjs" },
        { condition: "require", path: "./dist/index.cjs" },
      ],
      typesConditions: [
        { condition: "import.types", path: "./dist/index.d.mts" },
        { condition: "require.types", path: "./dist/index.d.cts" },
      ],
    };

    const result = await wireDeclarPackageTypes({
      entrypoints: [entrypoint],
      packageJson: {
        exports: {
          ".": {
            import: {
              default: "./dist/index.mjs",
            },
            require: {
              default: "./dist/index.cjs",
            },
          },
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.packageJson).toEqual({
      exports: {
        ".": {
          import: {
            types: "./dist/index.d.mts",
            default: "./dist/index.mjs",
          },
          require: {
            types: "./dist/index.d.cts",
            default: "./dist/index.cjs",
          },
        },
      },
      types: "./dist/index.d.mts",
    });
  });

  test("reports unsupported string export entries instead of rewriting shape", async () => {
    const result = await wireDeclarPackageTypes({
      entrypoints: [createRootEntrypoint()],
      packageJson: {
        exports: {
          ".": "./dist/index.js",
        },
      },
    });

    expect(result.packageJson.types).toBe("./dist/index.d.ts");
    expect(result.packageJson.exports).toEqual({
      ".": "./dist/index.js",
    });
    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_PACKAGE_WIRING_UNSUPPORTED",
        message: "Declar can only wire object export entries. Export . is not an object.",
        path: ["package.json", "exports", "."],
        severity: "warning",
      },
    ]);
  });

  test("writes package metadata only when explicitly requested", async () => {
    const writes: string[] = [];

    const result = await wireDeclarPackageTypes({
      entrypoints: [createRootEntrypoint()],
      host: {
        writeFile: async (path, contents) => {
          writes.push(`${path}\n${contents}`);
        },
      },
      packageJson: {
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      },
      packageJsonPath: "/repo/package.json",
      write: true,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.wrotePackageJson).toBe(true);
    expect(result.packageJsonPath).toBe("/repo/package.json");
    expect(writes).toEqual([
      `/repo/package.json\n${JSON.stringify(result.packageJson, null, 2)}\n`,
    ]);
  });
});
