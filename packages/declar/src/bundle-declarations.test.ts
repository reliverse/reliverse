import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleTypeScriptDeclarations } from "./bundle-declarations";
import type { DeclarEntrypoint } from "./types";

function createEntrypoint(typesPath = "./dist/index.d.ts"): DeclarEntrypoint {
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

async function createTempPackage(): Promise<string> {
  return mkdtemp(join(tmpdir(), "declar-bundle-"));
}

describe("bundleTypeScriptDeclarations", () => {
  test("inlines local declaration re-exports into the entrypoint declaration file", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        [
          'export { createAnswer } from "./answer";',
          'export type { Answer } from "./answer";',
        ].join("\n"),
      );
      await writeFile(
        join(packageDir, "dist", "answer.d.ts"),
        [
          "export interface Answer {",
          "  readonly value: number;",
          "}",
          "export declare function createAnswer(): Answer;",
        ].join("\n"),
      );

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint()],
        packageDir,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.bundles).toHaveLength(1);

      const contents = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(contents).toContain("export interface Answer");
      expect(contents).toContain("export declare function createAnswer(): Answer;");
      expect(contents).not.toContain('from "./answer"');
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("keeps external imports while bundling local declaration files", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        [
          'import type { External } from "external-package";',
          'import type { Local } from "./local";',
          "export declare function useValue(value: Local, external: External): void;",
        ].join("\n"),
      );
      await writeFile(
        join(packageDir, "dist", "local.d.ts"),
        ["export interface Local {", "  readonly id: string;", "}"].join("\n"),
      );

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint()],
        packageDir,
      });

      expect(result.diagnostics).toEqual([]);

      const contents = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(contents).toContain('import type { External } from "external-package";');
      expect(contents).toContain("export interface Local");
      expect(contents).not.toContain('from "./local"');
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("reports pattern targets because bundle output needs concrete files", async () => {
    const result = await bundleTypeScriptDeclarations({
      entrypoints: [createEntrypoint("./dist/*.d.ts")],
      host: {
        readFile: async () => "",
        writeFile: async () => {},
      },
      packageDir: "/repo/packages/declar",
    });

    expect(result.bundles).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: "DECLAR_BUNDLE_PATTERN_TARGET_UNSUPPORTED",
        message:
          "Export . declares pattern target ./dist/*.d.ts, but declaration bundling needs a concrete declaration file target.",
        path: ["package.json", "exports", "."],
        severity: "error",
      },
    ]);
  });
});
