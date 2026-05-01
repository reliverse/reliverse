import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";

import { emitTypeScriptDeclarations } from "./typescript-emit";

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
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  return packageDir;
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
        packageJson: {
          exports: {
            ".": {
              types: "./dist/index.d.ts",
              import: "./dist/index.js",
            },
          },
        },
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
        packageJson: {
          exports: {
            ".": {
              types: "./dist/index.d.ts",
              import: "./dist/index.js",
            },
          },
        },
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
});
