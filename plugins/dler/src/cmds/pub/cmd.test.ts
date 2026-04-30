import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import command from "./cmd";

function createJsonCtx(cwd: string, options: Record<string, unknown>) {
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
    expect(text).toContain("npm");
    expect(text).toContain("Use --json for the full machine-readable result.");
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
