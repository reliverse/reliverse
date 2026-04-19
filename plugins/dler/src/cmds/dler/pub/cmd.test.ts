import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
        stdout: { bold: (value: string) => value, green: (value: string) => value },
      },
      cwd,
      env: process.env,
      err: (...values: unknown[]) => errorLines.push(values.join(" ")),
      exit(code: number, message: string): never {
        throw new Error(`EXIT ${code}: ${message}`);
      },
      options,
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
        stdout: { bold: (value: string) => value, green: (value: string) => value },
      },
      cwd,
      env: process.env,
      err: (...values: unknown[]) => errorLines.push(values.join(" ")),
      exit(code: number, message: string): never {
        throw new Error(`EXIT ${code}: ${message}`);
      },
      options,
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
      dryRun: true,
      prebuild: false,
      publishFrom: "dist",
      targets: "packages/private-pkg",
    });

    await command.handler(ctx as never);

    expect(resultCalls).toHaveLength(1);
    expect(resultCalls[0]?.command).toBe("dler pub");
    expect(resultCalls[0]?.value).toMatchObject({
      dryRun: true,
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
      dryRun: true,
      prebuild: false,
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
          reason: expect.stringContaining("unsafe dependency specifiers for publish: foo@workspace:*") ,
        },
      ],
      summary: { failed: 0, planned: 1, published: 0, skipped: 1 },
    });
  });

  test("text output surfaces prebuild failures clearly", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-"));
    const pkgDir = join(root, "packages", "broken");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "broken", type: "module", publishConfig: { access: "public" }, scripts: { build: "bun --eval \"console.error('prebuild boom'); process.exit(1)\"" } }, null, 2)}\n`,
      "utf8",
    );

    const { ctx, errorLines } = createTextCtx(root, {
      dryRun: true,
      prebuild: true,
      targets: "packages/broken",
    });

    await expect(command.handler(ctx as never)).rejects.toThrow(
      "EXIT 1: Prebuild failed for packages/broken (exit 1). Fix the build or use --no-prebuild.",
    );

    expect(errorLines.some((line) => line.includes("prebuild boom"))).toBe(true);
  });

  test("text output includes publish-from, package name, total duration, and summary", async () => {
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
      dryRun: true,
      prebuild: false,
      publishFrom: "dist",
      targets: "packages/ok",
    });

    await command.handler(ctx as never);

    expect(textLines.some((line) => line.includes("Publish from: dist"))).toBe(true);
    expect(textLines.some((line) => line.includes("Prepared: packages/ok (ok-pkg) in"))).toBe(true);
    expect(textLines.some((line) => line.includes("Total duration:"))).toBe(true);
    expect(textLines.some((line) => line.includes("Summary: 1 prepared, 0 failed, 0 skipped."))).toBe(true);
  });
});
