import { describe, expect, test } from "bun:test";

import { createDeclarPipelinePlan } from "./plan";

describe("createDeclarPipelinePlan", () => {
  test("creates the default declaration pipeline plan", () => {
    const plan = createDeclarPipelinePlan({
      packageDir: "/repo/packages/declar",
      packageJson: {
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
      },
    });

    expect(plan).toEqual({
      declarationMap: false,
      entrypoints: [
        {
          defaultPath: undefined,
          defaultTypesPath: undefined,
          exportPath: ".",
          importPath: "./dist/index.js",
          importTypesPath: undefined,
          kind: "root",
          requirePath: undefined,
          requireTypesPath: undefined,
          runtimeConditions: [
            {
              condition: "import",
              path: "./dist/index.js",
            },
          ],
          sourcePath: undefined,
          typesConditions: [
            {
              condition: "types",
              path: "./dist/index.d.ts",
            },
          ],
          typesPath: "./dist/index.d.ts",
        },
      ],
      outDir: "dist",
      packageDir: "/repo/packages/declar",
      phases: [
        "read-tsconfig",
        "discover-entrypoints",
        "typescript-declaration-emit",
        "validate-package-types",
        "warn",
      ],
      rollup: false,
      tsconfigPath: "tsconfig.json",
      updatePackageJson: false,
      warnings: [],
    });
  });

  test("adds bundle and package wiring phases when enabled", () => {
    const plan = createDeclarPipelinePlan({
      declarationMap: true,
      outDir: "build",
      packageDir: "/repo/packages/declar",
      packageJson: {
        exports: {
          ".": {
            types: "./build/index.d.ts",
            import: "./build/index.js",
          },
        },
      },
      rollup: true,
      tsconfigPath: "tsconfig.build.json",
      updatePackageJson: true,
    });

    expect(plan.declarationMap).toBe(true);
    expect(plan.outDir).toBe("build");
    expect(plan.rollup).toBe(true);
    expect(plan.tsconfigPath).toBe("tsconfig.build.json");
    expect(plan.updatePackageJson).toBe(true);

    expect(plan.phases).toEqual([
      "read-tsconfig",
      "discover-entrypoints",
      "typescript-declaration-emit",
      "validate-package-types",
      "bundle-declarations",
      "wire-package-types",
      "warn",
    ]);
  });

  test("includes discovery warnings in the pipeline plan", () => {
    const plan = createDeclarPipelinePlan({
      packageDir: "/repo/packages/declar",
      packageJson: {
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      },
    });

    expect(plan.warnings).toEqual([
      {
        code: "DECLAR_EXPORT_MISSING_TYPES",
        message: "Export . does not declare a types condition.",
        path: ["package.json", "exports", "."],
      },
    ]);
  });
});
