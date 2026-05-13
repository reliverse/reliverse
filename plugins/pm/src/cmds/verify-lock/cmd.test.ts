import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBunLockfilePath } from "../../lockfile";
import command from "./cmd";

function createCtx(cwd: string, options: Record<string, unknown> = {}) {
  const resultCalls: Array<{ value: unknown; command?: string | undefined }> = [];
  const textLines: string[] = [];

  return {
    ctx: {
      args: [],
      colors: {
        stdout: {
          bold: (value: string) => value,
          cyan: (value: string) => value,
          green: (value: string) => value,
        },
      },
      cwd,
      env: process.env,
      err: () => undefined,
      exit(code: number, message: string): never {
        throw new Error(`EXIT ${code}: ${message}`);
      },
      options: { cwd, ...options },
      safety: {
        apply: false,
        effects: [],
        preview: true,
        requiresApply: false,
        assertApplied: () => undefined,
      },
      out: (...values: unknown[]) => textLines.push(values.join(" ")),
      output: {
        mode: "json",
        data: (value: unknown) => resultCalls.push({ value, command: "data" }),
        result: (value: unknown, commandName?: string) =>
          resultCalls.push({ value, command: commandName }),
      },
    },
    resultCalls,
    textLines,
  };
}

async function withTempProject<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pm-verify-lock-command-test-"));

  try {
    await writeFile(join(dir, "package.json"), '{"name":"demo"}\n', "utf8");
    await writeFile(
      getBunLockfilePath(dir),
      `{
        "lockfileVersion": 1,
        "packages": {
          "demo": ["demo@1.0.0", "", {}, "sha512-demo"]
        }
      }`,
      "utf8",
    );
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("pm verify-lock command", () => {
  test("returns JSON verification payload", async () => {
    await withTempProject(async (dir) => {
      const { ctx, resultCalls } = createCtx(dir);

      await command.handler(ctx as never);

      expect(resultCalls[0]?.command).toBe("pm verify-lock");
      expect(resultCalls[0]?.value).toMatchObject({
        checkedPackages: 1,
        ok: true,
      });
    });
  });
});
