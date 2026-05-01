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

  test("deduplicates external imports and identical declaration blocks", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        [
          'import type { External } from "external-package";',
          'export type { LocalA } from "./a";',
          'export type { LocalB } from "./b";',
        ].join("\n"),
      );
      await writeFile(
        join(packageDir, "dist", "a.d.ts"),
        [
          'import type { External } from "external-package";',
          "export interface Shared { readonly value: External; }",
          "export interface LocalA { readonly shared: Shared; }",
        ].join("\n"),
      );
      await writeFile(
        join(packageDir, "dist", "b.d.ts"),
        [
          'import type { External } from "external-package";',
          "export interface Shared { readonly value: External; }",
          "export interface LocalB { readonly shared: Shared; }",
        ].join("\n"),
      );

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint()],
        packageDir,
      });

      expect(result.diagnostics).toEqual([]);

      const contents = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(contents.match(/import type \{ External \} from "external-package";/g)).toHaveLength(
        1,
      );
      expect(contents.match(/export interface Shared/g)).toHaveLength(1);
      expect(contents).toContain("export interface LocalA");
      expect(contents).toContain("export interface LocalB");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("reports unsafe declaration name collisions", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        [
          'export type { Value } from "./a";',
          'export type { Value as OtherValue } from "./b";',
        ].join("\n"),
      );
      await writeFile(join(packageDir, "dist", "a.d.ts"), "export type Value = string;");
      await writeFile(join(packageDir, "dist", "b.d.ts"), "export type Value = number;");

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint()],
        packageDir,
        write: false,
      });

      expect(result.diagnostics).toEqual([
        {
          code: "DECLAR_BUNDLE_NAME_COLLISION",
          message: `Declaration bundling found multiple incompatible declarations named Value while bundling ${join(
            packageDir,
            "dist",
            "index.d.ts",
          )}.`,
          path: [join(packageDir, "dist", "index.d.ts"), "Value"],
          severity: "error",
        },
      ]);
      expect(result.bundles[0]?.contents).toContain("export type Value = string;");
      expect(result.bundles[0]?.contents).toContain("export type Value = number;");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("can strip declarations marked as internal or private", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        [
          "/** Public API. */",
          "export interface PublicApi {",
          "  readonly value: string;",
          "}",
          "/** @internal */",
          "export interface InternalApi {",
          "  readonly value: string;",
          "}",
          "/**",
          " * @private",
          " */",
          "export declare function privateHelper(): void;",
          "/** @internal */ export declare const sameLineInternal: string;",
          "export declare const stillPublic: string;",
        ].join("\n"),
      );

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint()],
        packageDir,
        stripInternal: true,
      });

      expect(result.diagnostics).toEqual([]);

      const contents = await readFile(join(packageDir, "dist", "index.d.ts"), "utf8");

      expect(contents).toContain("export interface PublicApi");
      expect(contents).not.toContain("InternalApi");
      expect(contents).not.toContain("privateHelper");
      expect(contents).not.toContain("sameLineInternal");
      expect(contents).toContain("stillPublic");
      expect(contents).not.toContain("@internal");
      expect(contents).not.toContain("@private");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("bundles ESM and CJS declaration entrypoints separately", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(join(packageDir, "dist", "index.d.mts"), 'export type { ESM } from "./esm";');
      await writeFile(join(packageDir, "dist", "index.d.cts"), 'export type { CJS } from "./cjs";');
      await writeFile(
        join(packageDir, "dist", "esm.d.mts"),
        "export interface ESM { readonly format: 'esm'; }",
      );
      await writeFile(
        join(packageDir, "dist", "cjs.d.cts"),
        "export interface CJS { readonly format: 'cjs'; }",
      );

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

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [entrypoint],
        packageDir,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.bundles.map((bundle) => bundle.path).sort()).toEqual([
        join(packageDir, "dist", "index.d.cts"),
        join(packageDir, "dist", "index.d.mts"),
      ]);

      await expect(readFile(join(packageDir, "dist", "index.d.mts"), "utf8")).resolves.toContain(
        "export interface ESM",
      );
      await expect(readFile(join(packageDir, "dist", "index.d.cts"), "utf8")).resolves.toContain(
        "export interface CJS",
      );
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("expands pattern declaration targets into concrete bundle outputs", async () => {
    const packageDir = await createTempPackage();

    try {
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(
        join(packageDir, "dist", "index.d.ts"),
        "export interface RootPatternApi { readonly root: true; }",
      );
      await writeFile(
        join(packageDir, "dist", "cli.d.ts"),
        "export interface CliPatternApi { readonly cli: true; }",
      );

      const result = await bundleTypeScriptDeclarations({
        banner: false,
        entrypoints: [createEntrypoint("./dist/*.d.ts")],
        packageDir,
        write: false,
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.bundles.map((bundle) => bundle.path).sort()).toEqual([
        join(packageDir, "dist", "cli.d.ts"),
        join(packageDir, "dist", "index.d.ts"),
      ]);
      expect(result.bundles.map((bundle) => bundle.contents).join("\n")).toContain(
        "RootPatternApi",
      );
      expect(result.bundles.map((bundle) => bundle.contents).join("\n")).toContain("CliPatternApi");
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("reports pattern targets when they cannot be expanded to concrete files", async () => {
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
          "Export . declares pattern target ./dist/*.d.ts, but Declar could not resolve it to concrete declaration files for bundling.",
        path: ["package.json", "exports", "."],
        severity: "error",
      },
    ]);
  });
});
