import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePublishableTargets } from "./validation";

describe("publish validation", () => {
  test("keeps only publishable targets and reports skipped reasons", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const okDir = join(root, "packages", "ok");
    const privateDir = join(root, "packages", "private");
    const missingDistDir = join(root, "packages", "missing-dist");
    await mkdir(join(okDir, "dist"), { recursive: true });
    await mkdir(privateDir, { recursive: true });
    await mkdir(missingDistDir, { recursive: true });

    await writeFile(
      join(okDir, "package.json"),
      JSON.stringify({ name: "ok", type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );
    await writeFile(
      join(privateDir, "package.json"),
      JSON.stringify({
        name: "private",
        private: true,
        type: "module",
        publishConfig: { access: "public" },
      }),
      "utf8",
    );
    await writeFile(
      join(missingDistDir, "package.json"),
      JSON.stringify({ name: "missing-dist", type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      publishFrom: "dist",
      targets: [
        { cwd: okDir, label: "packages/ok" },
        { cwd: privateDir, label: "packages/private" },
        { cwd: missingDistDir, label: "packages/missing-dist" },
      ],
    });

    expect(result.publishable).toEqual([
      expect.objectContaining({ label: "packages/ok", packageName: "ok" }),
    ]);
    expect(result.skipped).toEqual([
      {
        label: "packages/private",
        reason: 'package.json has "private": true (npm publish is blocked)',
      },
      {
        label: "packages/missing-dist",
        reason: expect.stringContaining("missing publish directory:"),
      },
    ]);
  });

  test("ignores @repo scoped packages before publish eligibility checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const pkgDir = join(root, "packages", "repo-only");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@repo/hidden", type: "module", publishConfig: { access: "public" } }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      publishFrom: "dist",
      targets: [{ cwd: pkgDir, label: "packages/repo-only" }],
    });

    expect(result.publishable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        label: "packages/repo-only",
        reason: "package @repo/hidden is ignored by workspace policy",
      },
    ]);
  });

  test("requires declared declaration artifacts for TypeScript packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const okDir = join(root, "packages", "typed-ok");
    const missingTypesDir = join(root, "packages", "typed-missing");
    const missingMetadataDir = join(root, "packages", "typed-no-types");
    const sourceTypesDir = join(root, "packages", "typed-source-types");
    await mkdir(join(okDir, "dist"), { recursive: true });
    await mkdir(join(missingTypesDir, "dist"), { recursive: true });
    await mkdir(join(missingMetadataDir, "dist"), { recursive: true });
    await mkdir(join(sourceTypesDir, "src"), { recursive: true });
    await mkdir(join(sourceTypesDir, "dist"), { recursive: true });

    const basePackageJson = { type: "module", publishConfig: { access: "public" } };
    await writeFile(join(okDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(
      join(okDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "typed-ok",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      }),
      "utf8",
    );
    await writeFile(join(okDir, "dist", "index.d.ts"), "export declare const ok = 1;\n", "utf8");
    await writeFile(join(okDir, "dist", "index.js"), "export const ok = 1;\n", "utf8");

    await writeFile(join(missingTypesDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(
      join(missingTypesDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "typed-missing",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      }),
      "utf8",
    );

    await writeFile(join(missingMetadataDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(
      join(missingMetadataDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "typed-no-types",
        exports: { ".": { import: "./dist/index.js" } },
      }),
      "utf8",
    );

    await writeFile(join(sourceTypesDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(join(sourceTypesDir, "src", "index.ts"), "export const sourceTyped = 1;\n", "utf8");
    await writeFile(
      join(sourceTypesDir, "dist", "index.d.ts"),
      "export declare const sourceTyped = 1;\n",
      "utf8",
    );
    await writeFile(join(sourceTypesDir, "dist", "index.js"), "export const sourceTyped = 1;\n", "utf8");
    await writeFile(
      join(sourceTypesDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "typed-source-types",
        bin: { typed: "./src/index.ts" },
        sideEffects: ["./src/index.ts"],
        devDependencies: { "@types/bun": "catalog:", typescript: "catalog:" },
        exports: { ".": { types: "./src/index.ts", import: "./dist/index.js" } },
      }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      publishFrom: "dist",
      targets: [
        { cwd: okDir, label: "packages/typed-ok" },
        { cwd: missingTypesDir, label: "packages/typed-missing" },
        { cwd: missingMetadataDir, label: "packages/typed-no-types" },
        { cwd: sourceTypesDir, label: "packages/typed-source-types" },
      ],
    });

    expect(result.publishable).toMatchObject([
      { label: "packages/typed-ok", packageName: "typed-ok" },
      {
        label: "packages/typed-source-types",
        packageName: "typed-source-types",
        packageRecord: {
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
          bin: { typed: "dist/index.js" },
          sideEffects: ["./dist/index.js"],
          types: "./dist/index.d.ts",
        },
      },
    ]);
    expect(result.publishable[1]?.packageRecord).not.toHaveProperty("devDependencies");
    expect(result.skipped).toEqual([
      {
        label: "packages/typed-missing",
        reason: expect.stringContaining("missing declaration artifacts"),
      },
      {
        label: "packages/typed-no-types",
        reason: "missing declaration targets in package.json for TypeScript package",
      },
    ]);
  });

  test("requires publish package file references to exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const okDir = join(root, "packages", "files-ok");
    const brokenDir = join(root, "packages", "files-broken");
    await mkdir(join(okDir, "dist"), { recursive: true });
    await mkdir(join(brokenDir, "dist"), { recursive: true });

    const basePackageJson = { type: "module", publishConfig: { access: "public" } };
    await writeFile(
      join(okDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "files-ok",
        bin: { ok: "dist/cli.js" },
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./cli": "./dist/cli.js",
        },
        main: "./dist/index.js",
      }),
      "utf8",
    );
    await writeFile(join(okDir, "dist", "index.js"), "export const ok = 1;\n", "utf8");
    await writeFile(join(okDir, "dist", "index.d.ts"), "export declare const ok = 1;\n", "utf8");
    await writeFile(join(okDir, "dist", "cli.js"), "#!/usr/bin/env bun\n", "utf8");

    await writeFile(
      join(brokenDir, "package.json"),
      JSON.stringify({
        ...basePackageJson,
        name: "files-broken",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./missing": "./dist/missing.js",
        },
      }),
      "utf8",
    );
    await writeFile(join(brokenDir, "dist", "index.d.ts"), "export declare const broken = 1;\n", "utf8");

    const result = await resolvePublishableTargets({
      publishFrom: "dist",
      targets: [
        { cwd: okDir, label: "packages/files-ok" },
        { cwd: brokenDir, label: "packages/files-broken" },
      ],
    });

    expect(result.publishable).toMatchObject([{ label: "packages/files-ok" }]);
    expect(result.skipped).toEqual([
      {
        label: "packages/files-broken",
        reason: expect.stringContaining("missing publish file references"),
      },
    ]);
    expect(result.skipped[0]?.reason).toContain("exports[.].import:./dist/index.js");
    expect(result.skipped[0]?.reason).toContain("exports[./missing]:./dist/missing.js");
  });

  test("single bundle publish metadata rewrites root runtime entries to dist/index.js", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const pkgDir = join(root, "plugins", "single-root");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const single = 1;\n", "utf8");
    await writeFile(join(pkgDir, "dist", "index.js"), "export const single = 1;\n", "utf8");
    await writeFile(join(pkgDir, "dist", "index.d.ts"), "export declare const single = 1;\n", "utf8");
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "single-root",
        type: "module",
        publishConfig: { access: "public" },
        exports: { ".": { types: "./src/index.ts", import: "./src/index.ts" } },
        main: "./src/index.ts",
      }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      bundleStrategy: "single",
      publishFrom: "dist",
      targets: [{ cwd: pkgDir, label: "plugins/single-root" }],
    });

    expect(result.skipped).toEqual([]);
    expect(result.publishable[0]?.packageRecord).toMatchObject({
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
  });

  test("single bundle publish policy rejects subpath exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-validation-"));
    const pkgDir = join(root, "packages", "single-subpaths");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(pkgDir, "dist", "index.js"), "export const root = 1;\n", "utf8");
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "single-subpaths",
        type: "module",
        publishConfig: { access: "public" },
        exports: {
          ".": "./dist/index.js",
          "./extra": "./dist/index.js",
        },
      }),
      "utf8",
    );

    const result = await resolvePublishableTargets({
      bundleStrategy: "single",
      publishFrom: "dist",
      targets: [{ cwd: pkgDir, label: "packages/single-subpaths" }],
    });

    expect(result.publishable).toEqual([]);
    expect(result.skipped).toEqual([
      {
        label: "packages/single-subpaths",
        reason: expect.stringContaining("bundle strategy single requires package exports"),
      },
    ]);
  });
});
