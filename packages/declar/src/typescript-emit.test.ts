import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import ts from "typescript";

import type { DeclarDeclarationBundleHost } from "./bundle-declarations";
import { emitTypeScriptDeclarations } from "./typescript-emit";

const rootExportPackageJson = {
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  },
};

async function createFixturePackage(): Promise<string> {
  const packageDir = await mkdtemp(join(tmpdir(), "declar-emit-"));

  await mkdir(join(packageDir, "src"), { recursive: true });
  await writeFile(
    join(packageDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "Bundler",
          rootDir: "src",
          target: "ES2022",
        },
        include: ["src/**/*.ts", "src/**/*.mts", "src/**/*.cts"],
      },
      null,
      2,
    ),
  );

  return packageDir;
}

async function writePackageJson(packageDir: string, packageJson: Record<string, unknown>) {
  await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJson, null, 2));
}

function createBrokenBundleHost(packageDir: string): DeclarDeclarationBundleHost {
  const declarationPath = resolve(packageDir, "dist", "index.d.ts");

  return {
    fileExists: async (path) => path === declarationPath,
    readDirectory: async () => [declarationPath],
    readFile: async () => "export type Broken = MissingBundledSymbol;\n",
    writeFile: async (path, contents) => {
      await writeFile(path, contents);
    },
  };
}

describe("emitTypeScriptDeclarations", () => {
  test("emits declarations with a real TypeScript compiler adapter", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        [
          "export interface DeclarFixture {",
          "  readonly value: number;",
          "}",
          "export function createFixture(value: number): DeclarFixture {",
          "  return { value };",
          "}",
        ].join("\n"),
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics).toEqual([]);
      expect(result.emittedFiles.some((file) => file.endsWith("dist/index.d.ts"))).toBe(true);

      const declaration = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(declaration).toContain("export interface DeclarFixture");
      expect(declaration).toContain("export declare function createFixture");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can limit declaration emit to explicit source files", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const publicValue = 1;\n");
      await writeFile(join(packageDir, "src", "index.test.ts"), "export const testValue = 1;\n");

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        files: [join(packageDir, "src", "index.ts")],
        packageDir,
        packageJson: rootExportPackageJson,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics).toEqual([]);
      expect(result.emittedFiles).toEqual([join(packageDir, "dist", "index.d.ts")]);
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("reports declared package type targets that TypeScript did not emit", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const value = 1;\n");

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        packageDir,
        packageJson: {
          exports: {
            ".": {
              types: "./dist/missing.d.ts",
              import: "./dist/index.js",
            },
          },
        },
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_DECLARATION_TARGET_NOT_EMITTED",
        "DECLAR_DECLARATION_TARGET_MISSING",
      ]);
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can roll up emitted declaration files through the first bundle primitive", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        'export { createAnswer } from "./answer";\nexport type { Answer } from "./answer";\n',
      );
      await writeFile(
        join(packageDir, "src", "answer.ts"),
        [
          "export interface Answer {",
          "  readonly value: number;",
          "}",
          "export function createAnswer(): Answer {",
          "  return { value: 42 };",
          "}",
        ].join("\n"),
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
        rollup: true,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics).toEqual([]);
      expect(result.bundledFiles.some((file) => file.endsWith("dist/index.d.ts"))).toBe(true);

      const declaration = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(declaration).toContain("export interface Answer");
      expect(declaration).toContain("export declare function createAnswer(): Answer;");
      expect(declaration).not.toContain('from "./answer"');
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("checks bundled declaration output with TypeScript", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const value = 1;\n");

      const result = await emitTypeScriptDeclarations({
        bundleHost: createBrokenBundleHost(packageDir),
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
        rollup: true,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.bundledFiles.some((file) => file.endsWith("dist/index.d.ts"))).toBe(true);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_BUNDLE_TYPESCRIPT_CHECK_FAILED",
      ]);
      expect(result.diagnostics[0]?.message).toContain("MissingBundledSymbol");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can skip bundled declaration TypeScript validation explicitly", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const value = 1;\n");

      const result = await emitTypeScriptDeclarations({
        bundleHost: createBrokenBundleHost(packageDir),
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
        rollup: true,
        validateBundledFiles: false,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics).toEqual([]);
      expect(result.bundledFiles.some((file) => file.endsWith("dist/index.d.ts"))).toBe(true);
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("does not update package metadata when bundled declaration validation fails", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const value = 1;\n");
      await writePackageJson(packageDir, {
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      });

      const result = await emitTypeScriptDeclarations({
        bundleHost: createBrokenBundleHost(packageDir),
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
        rollup: true,
        updatePackageJson: true,
      });

      expect(result.packageJsonUpdated).toBe(false);
      expect(result.packageJson).toBeUndefined();
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_BUNDLE_TYPESCRIPT_CHECK_FAILED",
      ]);

      const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));

      expect(packageJson).toEqual({
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      });
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can wire package types after a successful declaration emit", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.ts"), "export const value = 1;\n");
      await writePackageJson(packageDir, {
        exports: {
          ".": {
            import: "./dist/index.js",
          },
        },
      });

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        packageDir,
        packageJson: rootExportPackageJson,
        updatePackageJson: true,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics).toEqual([]);
      expect(result.packageJsonUpdated).toBe(true);
      expect(result.packageJsonPath).toBe(join(packageDir, "package.json"));
      expect(result.packageJson?.types).toBe("./dist/index.d.ts");

      const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));

      expect(packageJson).toEqual({
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
        types: "./dist/index.d.ts",
      });
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can emit declarations through the opt-in fast isolated path", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        [
          "export interface FastFixture {",
          "  readonly value: number;",
          "}",
          "export function createFastFixture(value: number): FastFixture {",
          "  return { value };",
          "}",
        ].join("\n"),
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        fastDeclarations: true,
        packageDir,
        packageJson: rootExportPackageJson,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_FAST_PATH_USED",
      ]);
      expect(result.emittedFiles).toEqual([join(packageDir, "dist", "index.d.ts")]);

      const declaration = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(declaration).toContain("export interface FastFixture");
      expect(declaration).toContain("export declare function createFastFixture");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("falls back to TypeScript emit when isolated declaration emit is unsafe", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        ["export function identity<T>(value: T) {", "  return value;", "}"].join("\n"),
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        fastDeclarations: true,
        packageDir,
        packageJson: rootExportPackageJson,
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX",
      ]);
      expect(result.emittedFiles.some((file) => file.endsWith("dist/index.d.ts"))).toBe(true);

      const declaration = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(declaration).toContain("export declare function identity<T>(value: T): T;");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("fast isolated path validates package exports before accepting output", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        "export const value: number = 1;\n",
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        fastDeclarations: true,
        packageDir,
        packageJson: {
          exports: {
            ".": {
              types: "./dist/missing.d.ts",
              import: "./dist/index.js",
            },
          },
        },
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_FAST_PATH_USED",
        "DECLAR_FAST_PATH_FALLBACK",
        "DECLAR_DECLARATION_TARGET_NOT_EMITTED",
        "DECLAR_DECLARATION_TARGET_MISSING",
      ]);
      expect(result.emittedFiles).toEqual([join(packageDir, "dist", "index.d.ts")]);
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can emit .mts and .cts declarations through the opt-in fast isolated path", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(join(packageDir, "src", "index.mts"), "export const esm: number = 1;\n");
      await writeFile(join(packageDir, "src", "index.cts"), "export const cjs: number = 1;\n");

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        fastDeclarations: true,
        packageDir,
        packageJson: {
          exports: {
            ".": {
              types: "./dist/index.d.mts",
              import: "./dist/index.mjs",
            },
            "./cjs": {
              types: "./dist/index.d.cts",
              require: "./dist/index.cjs",
            },
          },
        },
      });

      expect(result.emitSkipped).toBe(false);
      expect(result.diagnostics.every((diagnostic) => diagnostic.code === "DECLAR_FAST_PATH_USED"))
        .toBe(true);
      expect(result.emittedFiles).toEqual([
        join(packageDir, "dist", "index.d.mts"),
        join(packageDir, "dist", "index.d.cts"),
      ]);
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can make isolated declaration fallback diagnostics fatal", async () => {
    const packageDir = await createFixturePackage();

    try {
      await writeFile(
        join(packageDir, "src", "index.ts"),
        ["export function identity<T>(value: T) {", "  return value;", "}"].join("\n"),
      );

      const result = await emitTypeScriptDeclarations({
        compiler: ts,
        fastDeclarationFallback: "error",
        fastDeclarations: true,
        packageDir,
        packageJson: rootExportPackageJson,
      });

      expect(result.emitSkipped).toBe(true);
      expect(result.emittedFiles).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "DECLAR_FAST_PATH_UNSUPPORTED_SYNTAX",
      ]);
      expect(result.diagnostics[0]?.severity).toBe("error");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });
});
