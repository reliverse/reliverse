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

describe("dler build command", () => {
  test("dry-run json includes skipped targets summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-"));
    await mkdir(join(root, "plugins", "dler"), { recursive: true });
    await writeFile(
      join(root, "plugins", "dler", "package.json"),
      JSON.stringify({ scripts: { build: "bun build src/index.ts" } }),
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      dryRun: true,
      provider: "bun",
      targets: "plugins/dler,plugins/missing",
    });

    await command.handler(ctx as never);

    expect(resultCalls).toHaveLength(1);
    expect(resultCalls[0]?.command).toBe("dler build");
    expect(resultCalls[0]?.value).toMatchObject({
      dryRun: true,
      executedTargets: [],
      ok: true,
      plannedTargets: [{ label: "plugins/dler" }],
      skipped: [{ label: "plugins/missing" }],
      skippedTargets: [{ label: "plugins/missing" }],
      summary: { failed: 0, planned: 1, skipped: 1, succeeded: 0 },
    });
  });

  test("dry-run skips directories without package.json or build script", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-"));
    await mkdir(join(root, "plugins", "ok"), { recursive: true });
    await mkdir(join(root, "plugins", "no-script"), { recursive: true });
    await writeFile(
      join(root, "plugins", "ok", "package.json"),
      JSON.stringify({ scripts: { build: "bun build src/index.ts" } }),
      "utf8",
    );
    await writeFile(
      join(root, "plugins", "no-script", "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      dryRun: true,
      provider: "bun",
      targets: "plugins/ok,plugins/no-script,plugins/missing",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.value).toMatchObject({
      plannedTargets: [{ label: "plugins/ok" }],
      skippedTargets: [
        { label: "plugins/missing", reason: expect.stringContaining("not a directory:") },
        { label: "plugins/no-script", reason: "missing scripts.build" },
      ],
      summary: { failed: 0, planned: 1, skipped: 2, succeeded: 0 },
    });
  });

  test("fails early on unknown provider with a clear message", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-"));
    const { ctx } = createJsonCtx(root, {
      dryRun: true,
      provider: "webpack",
      targets: "plugins/dler",
    });

    await expect(command.handler(ctx as never)).rejects.toThrow(
      'EXIT 1: Unknown build provider "webpack". Available providers: bun.',
    );
  });

  test("text output failure path includes summary and target logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-"));
    const pkgDir = join(root, "plugins", "broken");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ scripts: { build: "bun --eval \"console.error('boom'); process.exit(1)\"" } }),
      "utf8",
    );

    const { ctx, errorLines, textLines } = createTextCtx(root, {
      provider: "bun",
      targets: "plugins/broken",
    });

    await expect(command.handler(ctx as never)).rejects.toThrow(
      "EXIT 1: Build failed for plugins/broken. Re-run with --targets plugins/broken for a narrower retry.",
    );

    expect(textLines.some((line) => line.includes("Provider: bun"))).toBe(true);
    expect(textLines.some((line) => line.includes("Failed: plugins/broken"))).toBe(true);
    expect(textLines.some((line) => line.includes("Total duration:"))).toBe(true);
    expect(textLines.some((line) => line.includes("Summary: 0 built, 1 failed, 0 skipped."))).toBe(true);
    expect(errorLines.some((line) => line.includes("boom"))).toBe(true);
  });
});
