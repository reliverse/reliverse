import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDeclarDeclarationLayer } from "./declaration-layer";

async function createPackageFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dler-declar-"));
  const packageDir = join(root, "packages", "demo");
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

describe("dler Declar declaration layer", () => {
  test("emits declarations for source package exports", async () => {
    const packageDir = await createPackageFixture();

    try {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "demo",
          type: "module",
          exports: {
            ".": "./src/index.ts",
          },
        }),
      );
      await writeFile(join(packageDir, "src", "index.ts"), "export const demo: number = 1;\n");

      const result = await runDeclarDeclarationLayer({ cwd: packageDir, label: "packages/demo" });

      expect(result.ok).toBe(true);
      expect(result.skippedReason).toBeUndefined();
      expect(result.emittedFiles).toEqual([join(packageDir, "dist", "index.d.ts")]);
      await expect(readFile(join(packageDir, "dist", "index.d.ts"), "utf8")).resolves.toContain(
        "export declare const demo: number;",
      );
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("emits only public declaration entrypoints and ignores test files", async () => {
    const packageDir = await createPackageFixture();

    try {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "demo",
          type: "module",
          exports: {
            ".": "./src/index.ts",
            "./cli": "./src/cli.ts",
          },
        }),
      );
      await writeFile(join(packageDir, "src", "index.ts"), "export const demo: number = 1;\n");
      await writeFile(join(packageDir, "src", "cli.ts"), "export const cli: string = 'cli';\n");
      await writeFile(join(packageDir, "src", "index.test.ts"), "export const testOnly = true;\n");

      const result = await runDeclarDeclarationLayer({ cwd: packageDir, label: "packages/demo" });

      expect(result.ok).toBe(true);
      expect(result.emittedFiles.toSorted()).toEqual([
        join(packageDir, "dist", "cli.d.ts"),
        join(packageDir, "dist", "index.d.ts"),
      ]);
      await expect(readFile(join(packageDir, "dist", "index.test.d.ts"), "utf8")).rejects.toThrow();
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });

  test("skips packages without tsconfig", async () => {
    const packageDir = await mkdtemp(join(tmpdir(), "dler-declar-skip-"));

    try {
      await writeFile(join(packageDir, "package.json"), '{"name":"skip"}\n');

      await expect(
        runDeclarDeclarationLayer({ cwd: packageDir, label: "packages/skip" }),
      ).resolves.toEqual({
        diagnostics: [],
        emittedFiles: [],
        ok: true,
        skippedReason: "missing tsconfig.json",
      });
    } finally {
      await rm(packageDir, { force: true, recursive: true });
    }
  });
});
