import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import command from "./cmd";

function createJsonCtx(
  cwd: string,
  options: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
) {
  const resultCalls: Array<{ value: unknown; command?: string | undefined }> = [];
  const textLines: string[] = [];
  const errorLines: string[] = [];

  return {
    ctx: {
      cliPluginNames: ["dler"],
      colors: {
        stderr: { bold: (value: string) => value, yellow: (value: string) => value },
        stdout: {
          bold: (value: string) => value,
          cyan: (value: string) => value,
          dim: (value: string) => value,
          gray: (value: string) => value,
          green: (value: string) => value,
          magenta: (value: string) => value,
          yellow: (value: string) => value,
        },
      },
      cwd,
      env,
      err: (...values: unknown[]) => errorLines.push(values.join(" ")),
      exit(code: number, message: string): never {
        throw new Error(`EXIT ${code}: ${message}`);
      },
      options,
      safety: {
        apply: options.apply === true,
        effects: [],
        preview: options.apply !== true,
        requiresApply: true,
        assertApplied(effect?: string) {
          if (options.apply === true) return;
          throw new Error(`requires --apply${effect ? ` for ${effect}` : ""}`);
        },
      },
      out: (...values: unknown[]) => textLines.push(values.join(" ")),
      output: {
        mode: "json" as const,
        data: (value: unknown) => resultCalls.push({ value, command: "data" }),
        result: (value: unknown, command?: string) => resultCalls.push({ value, command }),
      },
    },
    errorLines,
    resultCalls,
    textLines,
  };
}

function createTextCtx(cwd: string, options: Record<string, unknown>) {
  const textLines: string[] = [];
  const errorLines: string[] = [];

  return {
    ctx: {
      cliPluginNames: ["dler"],
      colors: {
        stderr: { bold: (value: string) => value, yellow: (value: string) => value },
        stdout: {
          bold: (value: string) => value,
          cyan: (value: string) => value,
          dim: (value: string) => value,
          gray: (value: string) => value,
          green: (value: string) => value,
          magenta: (value: string) => value,
          yellow: (value: string) => value,
        },
      },
      cwd,
      env: process.env,
      err: (...values: unknown[]) => errorLines.push(values.join(" ")),
      exit(code: number, message: string): never {
        throw new Error(`EXIT ${code}: ${message}`);
      },
      options,
      safety: {
        apply: options.apply === true,
        effects: [],
        preview: options.apply !== true,
        requiresApply: true,
        assertApplied(effect?: string) {
          if (options.apply === true) return;
          throw new Error(`requires --apply${effect ? ` for ${effect}` : ""}`);
        },
      },
      out: (...values: unknown[]) => textLines.push(values.join(" ")),
      output: {
        mode: "text" as const,
        data: () => undefined,
        result: () => undefined,
      },
    },
    errorLines,
    textLines,
  };
}

describe("dler pub command", () => {
  test("json result reports skipped ineligible packages with stable summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "private-pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "private-pkg", private: true, type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      publishFrom: "dist",
      targets: "packages/private-pkg",
    });

    await command.handler(ctx as never);

    expect(resultCalls).toHaveLength(1);
    expect(resultCalls[0]?.command).toBe("dler pub");
    expect(resultCalls[0]?.value).toMatchObject({
      executedTargets: [],
      ok: false,
      plannedTargets: [],
      published: [],
      skipped: [
        {
          label: "packages/private-pkg",
          reason: 'package.json has "private": true (npm publish is blocked)',
        },
      ],
      skippedTargets: [
        {
          label: "packages/private-pkg",
          reason: 'package.json has "private": true (npm publish is blocked)',
        },
      ],
      summary: { failed: 0, planned: 1, published: 0, skipped: 1 },
    });
  });

  test("json result skips packages with unsafe publish-time dependency specifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "workspace-pkg");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "workspace-pkg", type: "module", publishConfig: { access: "public" }, dependencies: { foo: "workspace:*" } }, null, 2)}\n`,
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      publishFrom: "dist",
      targets: "packages/workspace-pkg",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      ok: false,
      published: [],
      skippedTargets: [
        {
          label: "packages/workspace-pkg",
          reason: expect.stringContaining(
            "unsafe dependency specifiers for publish: foo@workspace:*",
          ),
        },
      ],
      summary: { failed: 0, planned: 1, published: 0, skipped: 1 },
    });
  });

  test("text output renders concise publish preview and hides npm details by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "ok");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");

    const { ctx, textLines } = createTextCtx(root, {
      publishFrom: "dist",
      targets: "packages/ok",
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("dler pub preview");
    expect(textLines.some((line) => line.includes("Publish from: dist"))).toBe(true);
    expect(text).toContain("Targets: 1 prepared, 0 skipped");
    expect(text).toContain("Prepared\n  packages/ok  ok-pkg");
    expect(text).toContain("No packages published. Pass --apply to publish to npm.");
    expect(text).toContain("Use --verbose or --json to inspect npm output and durations.");
    expect(text).not.toContain("Total duration:");
    expect(text).not.toContain("npm stdout:");
  });

  test("publish preview defaults to dist artifacts without running build", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "ok");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");

    const { ctx, textLines } = createTextCtx(root, {
      targets: "packages/ok",
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("Publish from: dist");
    expect(text).toContain("Targets: 1 prepared, 0 skipped");
    expect(text).not.toContain("Prebuild");
  });

  test("text output shows npm details and durations in verbose mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "ok");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");

    const { ctx, textLines } = createTextCtx(root, {
      publishFrom: "dist",
      targets: "packages/ok",
      verbose: true,
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("Prepared\n  packages/ok  ok-pkg (");
    expect(text).toContain("Command\n  npm publish --access public --dry-run");
    expect(text).toContain("Details");
    expect(text).toContain("Total duration:");
    expect(text).toContain("tarball:");
    expect(text).toContain("dist/index.js");
    expect(text).toContain("npm");
    expect(text).toContain("Use --json for the full machine-readable result.");
  });

  test("json preview includes npm pack dry-run tarball metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const binDir = join(root, "bin");
    const pkgDir = join(root, "packages", "ok");
    await mkdir(binDir, { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");
    await writeFile(
      join(binDir, "npm"),
      `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "pack" ]; then\n  printf '[{"filename":"ok-pkg-1.0.0.tgz","name":"ok-pkg","version":"1.0.0","size":222,"unpackedSize":111,"files":[{"path":"package.json","size":80},{"path":"dist/index.js","size":10}]}]\\n'\n  exit 0\nfi\nif [ "\${1:-}" = "publish" ]; then\n  printf 'publish dry-run ok\\n'\n  exit 0\nfi\necho "unexpected npm args: $*" >&2\nexit 1\n`,
      "utf8",
    );
    await chmod(join(binDir, "npm"), 0o755);

    const { ctx, resultCalls } = createJsonCtx(
      root,
      {
        publishFrom: "dist",
        targets: "packages/ok",
      },
      { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      ok: true,
      published: [
        {
          label: "packages/ok",
          pack: {
            filename: "ok-pkg-1.0.0.tgz",
            packageSize: 222,
            unpackedSize: 111,
            files: [
              { path: "package.json", size: 80 },
              { path: "dist/index.js", size: 10 },
            ],
          },
          stdout: "publish dry-run ok\n",
        },
      ],
    });
  });

  test("pack policy skips tarballs that include source or fixture files", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const binDir = join(root, "bin");
    const pkgDir = join(root, "packages", "dirty");
    await mkdir(binDir, { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "dirty-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");
    await writeFile(
      join(binDir, "npm"),
      `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "pack" ]; then\n  printf '[{"filename":"dirty-pkg-1.0.0.tgz","name":"dirty-pkg","version":"1.0.0","size":333,"files":[{"path":"package.json","size":80},{"path":"dist/index.js","size":10},{"path":"src/index.ts","size":12},{"path":"dist/index.js.map","size":20},{"path":"tests/index.test.js","size":30}]}]\\n'\n  exit 0\nfi\nif [ "\${1:-}" = "publish" ]; then\n  echo "publish should not run" >&2\n  exit 1\nfi\necho "unexpected npm args: $*" >&2\nexit 1\n`,
      "utf8",
    );
    await chmod(join(binDir, "npm"), 0o755);

    const { ctx, resultCalls } = createJsonCtx(
      root,
      {
        publishFrom: "dist",
        targets: "packages/dirty",
      },
      { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      ok: false,
      published: [],
      skippedTargets: [
        {
          label: "packages/dirty",
          reason: expect.stringContaining("pack policy violations"),
        },
      ],
    });
    const reason = (resultCalls[0]?.value as { skipped?: Array<{ reason: string }> }).skipped?.[0]
      ?.reason;
    expect(reason).toContain("source files included: src/index.ts");
    expect(reason).toContain("source maps included: dist/index.js.map");
    expect(reason).toContain("test/fixture files included: tests/index.test.js");
  });

  test("when --targets is omitted at package cwd, pub auto-targets only that package", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "solo");
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "solo-pkg", type: "module", publishConfig: { access: "public" }, dependencies: { foo: "workspace:*" } }, null, 2)}\n`,
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(pkgDir, {
      publishFrom: "dist",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      plannedTargets: [{ label: "packages/solo" }],
      skippedTargets: [
        { label: "packages/solo", reason: expect.stringContaining("unsafe dependency specifiers") },
      ],
      summary: { planned: 1 },
    });
  });

  test("build/pub previews stay aligned on the same package target boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "aligned");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "aligned", type: "module", publishConfig: { access: "public" }, dependencies: { foo: "workspace:*" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "src", "index.ts"), "export const aligned = 1;\n", "utf8");

    const { ctx, resultCalls } = createJsonCtx(pkgDir, {
      publishFrom: "dist",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      plannedTargets: [{ cwd: pkgDir, label: "packages/aligned" }],
      summary: { planned: 1 },
    });
  });

  test("apply syncs the source package version before real publish", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const binDir = join(root, "bin");
    const pkgDir = join(root, "packages", "ok");
    await mkdir(binDir, { recursive: true });
    await mkdir(join(pkgDir, "dist"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.0", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(pkgDir, "dist", "index.js"), "export {}\n", "utf8");
    await writeFile(
      join(binDir, "npm"),
      `#!/usr/bin/env bash\nset -euo pipefail\nif [ "\${1:-}" = "view" ]; then\n  printf '"1.0.0"\\n'\n  exit 0\nfi\nif [ "\${1:-}" = "pack" ]; then\n  printf '[{"filename":"ok-pkg-1.0.1.tgz","name":"ok-pkg","version":"1.0.1","size":123,"unpackedSize":45,"files":[{"path":"package.json","size":2},{"path":"dist/index.js","size":10}]}]\\n'\n  exit 0\nfi\nif [ "\${1:-}" = "publish" ]; then\n  node -e 'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); console.log(pkg.name + "@" + pkg.version);'\n  exit 0\nfi\necho "unexpected npm args: $*" >&2\nexit 1\n`,
      "utf8",
    );
    await chmod(join(binDir, "npm"), 0o755);

    const { ctx, resultCalls } = createJsonCtx(
      root,
      {
        apply: true,
        publishFrom: "dist",
        tag: "latest",
        targets: "packages/ok",
      },
      { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    );

    await command.handler(ctx as never);

    await expect(readFile(join(pkgDir, "package.json"), "utf8")).resolves.toBe(
      `${JSON.stringify({ name: "ok-pkg", version: "1.0.1", type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
    );
    expect(resultCalls[0]?.value).toMatchObject({
      ok: true,
      published: [
        {
          label: "packages/ok",
          packageName: "ok-pkg",
          publishVersion: "1.0.1",
          sourceVersion: "1.0.0",
          pack: {
            filename: "ok-pkg-1.0.1.tgz",
            files: [
              { path: "package.json", size: 2 },
              { path: "dist/index.js", size: 10 },
            ],
          },
          stdout: expect.stringContaining("ok-pkg@1.0.1"),
          versionUpdated: true,
        },
      ],
    });
  });

  test("json preview keeps a stable machine-readable shape when nothing is publishable", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "private-pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "private-pkg", private: true, type: "module", publishConfig: { access: "public" } }, null, 2)}\n`,
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      publishFrom: "dist",
      targets: "packages/private-pkg",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toStrictEqual({
      apply: false,
      bundleStrategy: "auto",
      concurrency: 1,
      preview: true,
      executedTargets: [],
      ok: false,
      plannedTargets: [],
      publishFrom: "dist",
      published: [],
      skipped: [
        {
          label: "packages/private-pkg",
          reason: 'package.json has "private": true (npm publish is blocked)',
        },
      ],
      skippedTargets: [
        {
          label: "packages/private-pkg",
          reason: 'package.json has "private": true (npm publish is blocked)',
        },
      ],
      summary: { failed: 0, planned: 1, published: 0, skipped: 1 },
    });
  });
});
