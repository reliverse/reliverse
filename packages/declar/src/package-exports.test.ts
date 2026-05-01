import { describe, expect, test } from "bun:test";

import { discoverPackageEntrypoints } from "./package-exports";
import type { DeclarDiagnosticCode } from "./types";

function getDiagnosticCodes(
  result: ReturnType<typeof discoverPackageEntrypoints>,
): DeclarDiagnosticCode[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("discoverPackageEntrypoints", () => {
  test("discovers a legacy root entrypoint from main, module, and types", () => {
    const result = discoverPackageEntrypoints({
      main: "./dist/index.cjs",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(1);

    expect(result.entrypoints[0]).toEqual({
      defaultPath: "./dist/index.js",
      exportPath: ".",
      importPath: "./dist/index.js",
      kind: "root",
      requirePath: "./dist/index.cjs",
      runtimeConditions: [
        {
          condition: "import",
          path: "./dist/index.js",
        },
        {
          condition: "require",
          path: "./dist/index.cjs",
        },
      ],
      typesConditions: [
        {
          condition: "types",
          path: "./dist/index.d.ts",
        },
      ],
      typesPath: "./dist/index.d.ts",
    });
  });

  test("warns when legacy package metadata has no public entrypoint fields", () => {
    const result = discoverPackageEntrypoints({
      name: "@reliverse/empty",
    });

    expect(result.entrypoints).toEqual([]);
    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_PACKAGE_MISSING_EXPORTS"]);
  });

  test("discovers a string export and warns about missing types", () => {
    const result = discoverPackageEntrypoints({
      exports: "./dist/index.js",
    });

    expect(result.entrypoints).toEqual([
      {
        defaultPath: "./dist/index.js",
        exportPath: ".",
        kind: "root",
        runtimeConditions: [
          {
            condition: "default",
            path: "./dist/index.js",
          },
        ],
        typesConditions: [],
      },
    ]);

    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_MISSING_TYPES"]);
  });

  test("discovers conditional root exports with types, import, and require", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
          require: "./dist/index.cjs",
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(1);

    expect(result.entrypoints[0]).toEqual({
      defaultPath: undefined,
      defaultTypesPath: undefined,
      exportPath: ".",
      importPath: "./dist/index.js",
      importTypesPath: undefined,
      kind: "root",
      requirePath: "./dist/index.cjs",
      requireTypesPath: undefined,
      runtimeConditions: [
        {
          condition: "import",
          path: "./dist/index.js",
        },
        {
          condition: "require",
          path: "./dist/index.cjs",
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
    });
  });

  test("discovers versioned TypeScript types conditions", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          "types@>=5.0": "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(1);
    expect(result.entrypoints[0]?.typesPath).toBe("./dist/index.d.ts");
    expect(result.entrypoints[0]?.typesConditions).toContainEqual({
      condition: "types@>=5.0",
      path: "./dist/index.d.ts",
    });
  });

  test("preserves unknown runtime conditions as diagnostics", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          browser: "./dist/index.browser.js",
          default: "./dist/index.js",
        },
      },
    });

    expect(result.entrypoints).toHaveLength(1);
    expect(result.entrypoints[0]?.runtimeConditions).toEqual([
      {
        condition: "default",
        path: "./dist/index.js",
      },
      {
        condition: "browser",
        path: "./dist/index.browser.js",
      },
    ]);
    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_CONDITION_UNSUPPORTED"]);
    expect(getDiagnosticCodes(result)).not.toContain("DECLAR_EXPORT_MISSING_RUNTIME_TARGET");
    expect(getDiagnosticCodes(result)).not.toContain("DECLAR_EXPORT_MISSING_TYPES");
  });

  test("discovers multiple subpath exports", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
        "./cli": {
          types: "./dist/cli.d.ts",
          import: "./dist/cli.js",
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(2);

    expect(result.entrypoints.map((entrypoint) => entrypoint.exportPath)).toEqual([".", "./cli"]);
    expect(result.entrypoints.map((entrypoint) => entrypoint.kind)).toEqual(["root", "subpath"]);
  });

  test("normalizes direct object exports as the root entrypoint", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(1);
    expect(result.entrypoints[0]?.exportPath).toBe(".");
    expect(result.entrypoints[0]?.kind).toBe("root");
    expect(result.entrypoints[0]?.typesPath).toBe("./dist/index.d.ts");
    expect(result.entrypoints[0]?.importPath).toBe("./dist/index.js");
  });

  test("warns when types condition is not first", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          import: "./dist/index.js",
          types: "./dist/index.d.ts",
        },
      },
    });

    expect(getDiagnosticCodes(result)).toContain("DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST");
  });

  test("warns when export target is not relative", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "dist/index.d.ts",
          import: "dist/index.js",
        },
      },
    });

    expect(getDiagnosticCodes(result)).toEqual([
      "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
      "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
    ]);
  });

  test("warns when types condition is not first and export targets are not relative", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          import: "dist/index.js",
          types: "dist/index.d.ts",
        },
      },
    });

    expect(getDiagnosticCodes(result)).toEqual([
      "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST",
      "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
      "DECLAR_EXPORT_TARGET_NOT_RELATIVE",
    ]);
  });

  test("warns when a conditional export is missing types", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          import: "./dist/index.js",
        },
      },
    });

    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_MISSING_TYPES"]);
  });

  test("warns when a conditional export is missing runtime target", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
        },
      },
    });

    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_MISSING_RUNTIME_TARGET"]);
  });

  test("discovers pattern exports and warns that pattern types are not fully verified yet", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        "./*": {
          types: "./dist/*.d.ts",
          import: "./dist/*.js",
        },
      },
    });

    expect(result.entrypoints).toHaveLength(1);
    expect(result.entrypoints[0]?.exportPath).toBe("./*");
    expect(result.entrypoints[0]?.kind).toBe("pattern");
    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_PATTERN_TYPES_UNVERIFIED"]);
  });

  test("supports nested import and require declaration conditions", () => {
    const result = discoverPackageEntrypoints({
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
    });

    expect(result.entrypoints).toHaveLength(1);

    expect(result.entrypoints[0]?.importPath).toBe("./dist/index.mjs");
    expect(result.entrypoints[0]?.requirePath).toBe("./dist/index.cjs");
    expect(result.entrypoints[0]?.importTypesPath).toBe("./dist/index.d.mts");
    expect(result.entrypoints[0]?.requireTypesPath).toBe("./dist/index.d.cts");

    expect(result.entrypoints[0]?.runtimeConditions).toEqual([
      {
        condition: "import.default",
        path: "./dist/index.mjs",
      },
      {
        condition: "require.default",
        path: "./dist/index.cjs",
      },
    ]);

    expect(result.entrypoints[0]?.typesConditions).toEqual([
      {
        condition: "import.types",
        path: "./dist/index.d.mts",
      },
      {
        condition: "require.types",
        path: "./dist/index.d.cts",
      },
    ]);

    expect(result.diagnostics).toEqual([]);
  });

  test("warns about unsupported nested non-default runtime conditions", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          import: {
            browser: "./dist/index.browser.js",
            default: "./dist/index.js",
            types: "./dist/index.d.ts",
          },
        },
      },
    });

    expect(result.entrypoints[0]?.runtimeConditions).toEqual([
      {
        condition: "import.default",
        path: "./dist/index.js",
      },
      {
        condition: "import.browser",
        path: "./dist/index.browser.js",
      },
    ]);

    expect(getDiagnosticCodes(result)).toEqual([
      "DECLAR_EXPORT_TYPES_CONDITION_NOT_FIRST",
      "DECLAR_EXPORT_NESTED_CONDITIONS_UNSUPPORTED",
    ]);
  });

  test("ignores null export entries", () => {
    const result = discoverPackageEntrypoints({
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
        "./internal": null,
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.entrypoints).toHaveLength(1);
    expect(result.entrypoints[0]?.exportPath).toBe(".");
  });

  test("warns about unsupported package exports shape", () => {
    const result = discoverPackageEntrypoints({
      exports: 123,
    });

    expect(result.entrypoints).toEqual([]);
    expect(getDiagnosticCodes(result)).toEqual(["DECLAR_EXPORT_UNSUPPORTED_SHAPE"]);
  });
});
