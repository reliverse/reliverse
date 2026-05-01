import { describe, expect, test } from "bun:test";

import { createDeclarPipelinePlan } from "./plan";

function createPackageJsonWithTypes() {
  return {
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    },
  };
}

describe("createDeclarPipelinePlan", () => {
  test("creates the default declaration pipeline plan", () => {
    const plan = createDeclarPipelinePlan({
      packageDir: "/repo/packages/declar",
      packageJson: createPackageJsonWithTypes(),
    });

    expect(plan).toEqual({
      declarationMap: false,
      diagnostics: [],
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
      fastDeclarationFallback: "typescript",
      fastDeclarations: false,
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
    });
  });

  test("adds the fast isolated declaration phase when fast declarations are enabled", () => {
    const plan = createDeclarPipelinePlan({
      fastDeclarations: true,
      packageDir: "/repo/packages/declar",
      packageJson: createPackageJsonWithTypes(),
    });

    expect(plan.fastDeclarations).toBe("auto");
    expect(plan.fastDeclarationFallback).toBe("typescript");
    expect(plan.phases).toEqual([
      "read-tsconfig",
      "discover-entrypoints",
      "fast-isolated-declaration-emit",
      "typescript-declaration-emit",
      "validate-package-types",
      "warn",
    ]);
  });

  test("keeps explicit fast declaration mode and fallback in the plan", () => {
    const plan = createDeclarPipelinePlan({
      fastDeclarationFallback: "error",
      fastDeclarations: "typescript",
      packageDir: "/repo/packages/declar",
      packageJson: createPackageJsonWithTypes(),
    });

    expect(plan.fastDeclarations).toBe("typescript");
    expect(plan.fastDeclarationFallback).toBe("error");
  });

  test("adds only bundle declaration phase when rollup is enabled", () => {
    const plan = createDeclarPipelinePlan({
      packageDir: "/repo/packages/declar",
      packageJson: createPackageJsonWithTypes(),
      rollup: true,
    });

    expect(plan.phases).toEqual([
      "read-tsconfig",
      "discover-entrypoints",
      "typescript-declaration-emit",
      "validate-package-types",
      "bundle-declarations",
      "warn",
    ]);
  });

  test("adds only package wiring phase when package update is enabled", () => {
    const plan = createDeclarPipelinePlan({
      packageDir: "/repo/packages/declar",
      packageJson: createPackageJsonWithTypes(),
      updatePackageJson: true,
    });

    expect(plan.phases).toEqual([
      "read-tsconfig",
      "discover-entrypoints",
      "typescript-declaration-emit",
      "validate-package-types",
      "wire-package-types",
      "warn",
    ]);
  });

  test("adds fast, bundle, and package wiring phases in order when enabled", () => {
    const plan = createDeclarPipelinePlan({
      declarationMap: true,
      fastDeclarations: "auto",
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
    expect(plan.fastDeclarations).toBe("auto");
    expect(plan.outDir).toBe("build");
    expect(plan.rollup).toBe(true);
    expect(plan.tsconfigPath).toBe("tsconfig.build.json");
    expect(plan.updatePackageJson).toBe(true);

    expect(plan.phases).toEqual([
      "read-tsconfig",
      "discover-entrypoints",
      "fast-isolated-declaration-emit",
      "typescript-declaration-emit",
      "validate-package-types",
      "bundle-declarations",
      "wire-package-types",
      "warn",
    ]);
  });

  test("includes discovery diagnostics in the pipeline plan", () => {
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

    expect(plan.diagnostics).toEqual([
      {
        code: "DECLAR_EXPORT_MISSING_TYPES",
        message: "Export . does not declare a types condition.",
        path: ["package.json", "exports", "."],
        severity: "warning",
      },
    ]);
  });
});
