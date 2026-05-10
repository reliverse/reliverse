import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  explainMissingPackageBuildCommand,
  resolvePackageBuildCommand,
} from "./package-build-command";

describe("package build command", () => {
  test("uses node-targeted bun build for workspace packages with src/index.ts", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "demo");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "package.json"), '{"name":"demo"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const demo = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/demo" }),
    ).resolves.toEqual({
      argv: ["bun", "build", "./src/index.ts", "--outdir", "./dist", "--target", "node"],
      bundleStrategy: "split",
      display: "bun build ./src/index.ts --outdir ./dist --target node",
    });
  });

  test("externalizes runtime dependencies for package libraries", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "declar-like");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "declar-like",
        dependencies: { "jsonc-parser": "catalog:" },
        peerDependencies: { typescript: ">=5.6" },
      }),
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "index.ts"), "export const demo = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/declar-like" }),
    ).resolves.toEqual({
      argv: [
        "bun",
        "build",
        "./src/index.ts",
        "--outdir",
        "./dist",
        "--target",
        "node",
        "--external",
        "jsonc-parser",
        "--external",
        "typescript",
      ],
      bundleStrategy: "split",
      display:
        "bun build ./src/index.ts --outdir ./dist --target node --external jsonc-parser --external typescript",
    });
  });

  test("includes plugin command entrypoints in split generated bun builds", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "plugins", "demo");
    await mkdir(join(pkgDir, "src", "cmds", "demo", "sub"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["plugins/*"] } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "package.json"), '{"name":"demo-plugin"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const demo = 1;\n", "utf8");
    await writeFile(
      join(pkgDir, "src", "cmds", "demo", "sub", "cmd.ts"),
      "export default 1;\n",
      "utf8",
    );

    await expect(
      resolvePackageBuildCommand(
        { cwd: pkgDir, label: "plugins/demo" },
        { bundleStrategy: "split" },
      ),
    ).resolves.toEqual({
      argv: [
        "bun",
        "build",
        "./src/index.ts",
        "./src/cmds/demo/sub/cmd.ts",
        "--outdir",
        "./dist",
        "--target",
        "bun",
        "--root",
        "./src",
      ],
      bundleStrategy: "split",
      display:
        "bun build ./src/index.ts ./src/cmds/demo/sub/cmd.ts --outdir ./dist --target bun --root ./src",
    });
  });

  test("uses single-file bun build for plugin targets in auto mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "plugins", "single");
    await mkdir(join(pkgDir, "src", "cmds", "single"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["plugins/*"] } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "package.json"), '{"name":"single-plugin"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const single = 1;\n", "utf8");
    await writeFile(join(pkgDir, "src", "cmds", "single", "cmd.ts"), "export default 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "plugins/single" }),
    ).resolves.toEqual({
      argv: ["bun", "build", "./src/index.ts", "--outfile", "./dist/index.js", "--target", "bun"],
      bundleStrategy: "single",
      display: "bun build ./src/index.ts --outfile ./dist/index.js --target bun",
    });
  });

  test("externalizes host and TypeScript toolchain dependencies for plugins", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "plugins", "dler-like");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["plugins/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "dler-like",
        dependencies: {
          "@reliverse/declar": "workspace:*",
          "@reliverse/rempts": "workspace:*",
          "jsonc-parser": "catalog:",
          typescript: "catalog:",
        },
      }),
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "index.ts"), "export const single = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "plugins/dler-like" }),
    ).resolves.toEqual({
      argv: [
        "bun",
        "build",
        "./src/index.ts",
        "--outfile",
        "./dist/index.js",
        "--target",
        "bun",
        "--external",
        "@reliverse/rempts",
        "--external",
        "typescript",
      ],
      bundleStrategy: "single",
      display:
        "bun build ./src/index.ts --outfile ./dist/index.js --target bun --external @reliverse/rempts --external typescript",
    });
  });

  test("uses a chained desktop build when vite and electrobun configs exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const appDir = join(root, "apps", "desktop");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["apps/*"] } }),
      "utf8",
    );
    await writeFile(join(appDir, "package.json"), '{"name":"desktop"}\n', "utf8");
    await writeFile(join(appDir, "vite.config.ts"), "export default {};\n", "utf8");
    await writeFile(join(appDir, "electrobun.config.ts"), "export default {};\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: appDir, label: "apps/desktop" }),
    ).resolves.toEqual({
      argv: ["sh", "-lc", "bun x vite build && bun x electrobun build"],
      display: "bun x vite build && bun x electrobun build",
    });
  });

  test("builds package entrypoints discovered from package exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "envlike");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ exports: { "./api": "./src/api.ts", "./vite": "./src/vite.ts" } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "api.ts"), "export const api = 1;\n", "utf8");
    await writeFile(join(pkgDir, "src", "vite.ts"), "export const vite = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/envlike" }),
    ).resolves.toEqual({
      argv: [
        "bun",
        "build",
        "./src/api.ts",
        "./src/vite.ts",
        "--outdir",
        "./dist",
        "--target",
        "node",
        "--root",
        "./src",
      ],
      bundleStrategy: "split",
      display: "bun build ./src/api.ts ./src/vite.ts --outdir ./dist --target node --root ./src",
    });
  });

  test("can force single-file bun build for package libraries", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "singlelib");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ exports: { ".": "./src/index.ts", "./extra": "./src/extra.ts" } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "index.ts"), "export const index = 1;\n", "utf8");
    await writeFile(join(pkgDir, "src", "extra.ts"), "export const extra = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand(
        { cwd: pkgDir, label: "packages/singlelib" },
        { bundleStrategy: "single" },
      ),
    ).resolves.toEqual({
      argv: ["bun", "build", "./src/index.ts", "--outfile", "./dist/index.js", "--target", "node"],
      bundleStrategy: "single",
      display: "bun build ./src/index.ts --outfile ./dist/index.js --target node",
    });
  });

  test("ignores wildcard export patterns and keeps concrete entrypoints", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "patterned");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ exports: { ".": "./src/index.ts", "./*": "./src/*.ts" } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "index.ts"), "export const patterned = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/patterned" }),
    ).resolves.toEqual({
      argv: ["bun", "build", "./src/index.ts", "--outdir", "./dist", "--target", "node"],
      bundleStrategy: "split",
      display: "bun build ./src/index.ts --outdir ./dist --target node",
    });
  });

  test("uses root index entrypoints for package-style libraries without src/index.ts", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "billinglike");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ exports: { ".": "./index.ts" } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "index.ts"), "export const billing = 1;\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/billinglike" }),
    ).resolves.toEqual({
      argv: ["bun", "build", "./index.ts", "--outdir", "./dist", "--target", "node"],
      bundleStrategy: "split",
      display: "bun build ./index.ts --outdir ./dist --target node",
    });
  });

  test("uses tsgo for convex packages", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "convexlike");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "package.json"), '{"name":"convexlike"}\n', "utf8");
    await writeFile(join(pkgDir, "convex.json"), "{}\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/convexlike" }),
    ).resolves.toEqual({
      argv: ["bun", "x", "tsgo"],
      display: "bun x tsgo",
    });
  });

  test("uses typecheck for expo mobile apps", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const appDir = join(root, "apps", "mobilelike");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["apps/*"] } }),
      "utf8",
    );
    await writeFile(join(appDir, "package.json"), '{"name":"mobilelike"}\n', "utf8");
    await writeFile(join(appDir, "app.config.ts"), "export default {};\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: appDir, label: "apps/mobilelike" }),
    ).resolves.toEqual({
      argv: ["bun", "typecheck"],
      display: "bun typecheck",
    });
  });

  test("explains missing package-library entrypoints with a specific reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const pkgDir = join(root, "packages", "empty");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(join(pkgDir, "package.json"), '{"name":"empty"}\n', "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: pkgDir, label: "packages/empty" }),
    ).resolves.toBeNull();
    await expect(
      explainMissingPackageBuildCommand({ cwd: pkgDir, label: "packages/empty" }),
    ).resolves.toBe(
      "unsupported package shape: package target is missing src/index.ts, root index entrypoints, and manifest entrypoints",
    );
  });

  test("explains incomplete desktop app shape with a specific reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-command-"));
    const appDir = join(root, "apps", "desktop-broken");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["apps/*"] } }),
      "utf8",
    );
    await writeFile(join(appDir, "package.json"), '{"name":"desktop-broken"}\n', "utf8");
    await writeFile(join(appDir, "electrobun.config.ts"), "export default {};\n", "utf8");

    await expect(
      resolvePackageBuildCommand({ cwd: appDir, label: "apps/desktop-broken" }),
    ).resolves.toBeNull();
    await expect(
      explainMissingPackageBuildCommand({ cwd: appDir, label: "apps/desktop-broken" }),
    ).resolves.toBe(
      "unsupported package shape: electrobun config detected without a matching vite config",
    );
  });
});
