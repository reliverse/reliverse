import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import command from "./cmd";

function createCtx(cwd: string, options: Record<string, unknown> = {}) {
  const resultCalls: Array<{ value: unknown; command?: string | undefined }> = [];
  const textLines: string[] = [];
  const errorLines: string[] = [];

  return {
    ctx: {
      args: ["zod"],
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
      options: { cwd, ...options },
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
        result: (value: unknown, commandName?: string) =>
          resultCalls.push({ value, command: commandName }),
      },
    },
    errorLines,
    resultCalls,
    textLines,
  };
}

describe("pm add command", () => {
  test("fails at command level when bun.lock is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pm-add-command-test-"));

    try {
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0" }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir);

      await expect(command.handler(ctx as never)).rejects.toThrow(/expected bun\.lock/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("fails at command level when a legacy Bun lockfile is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pm-add-command-test-"));

    try {
      await writeFile(join(dir, "bun.lock"), "", "utf8");
      await writeFile(join(dir, "bun.lockb"), "", "utf8");
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0" }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir);

      await expect(command.handler(ctx as never)).rejects.toThrow(/bun\.lockb/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
