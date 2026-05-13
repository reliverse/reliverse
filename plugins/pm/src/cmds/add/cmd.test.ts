import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import command from "./cmd";

interface TestCtxOptions {
  readonly args?: readonly string[] | undefined;
  readonly mode?: "json" | "text" | undefined;
  readonly options?: Record<string, unknown> | undefined;
}

function createCtx(cwd: string, options: TestCtxOptions = {}) {
  const resultCalls: Array<{ value: unknown; command?: string | undefined }> = [];
  const textLines: string[] = [];
  const errorLines: string[] = [];

  return {
    ctx: {
      args: [...(options.args ?? ["zod"])],
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
      options: { cwd, ...(options.options ?? {}) },
      safety: {
        apply: options.options?.apply === true,
        effects: [],
        preview: options.options?.apply !== true,
        requiresApply: true,
        assertApplied(effect?: string) {
          if (options.options?.apply === true) return;
          throw new Error(`requires --apply${effect ? ` for ${effect}` : ""}`);
        },
      },
      out: (...values: unknown[]) => textLines.push(values.join(" ")),
      output: {
        mode: options.mode ?? "json",
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

async function withTempProject<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pm-add-command-test-"));

  try {
    await writeFile(join(dir, "bun.lock"), "", "utf8");
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function mockNpmLatest(version = "1.2.3") {
  const fetchMock = mock(
    async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest: version },
          versions: { [version]: {} },
        }),
        { status: 200 },
      ),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

afterEach(() => {
  mock.restore();
});

describe("pm add command", () => {
  test("json preview output contract stays stable", async () => {
    const restoreFetch = mockNpmLatest("1.2.3");

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0" }, null, 2)}\n`,
          "utf8",
        );
        const { ctx, resultCalls } = createCtx(dir, {
          args: ["contract-add-demo"],
          options: { dev: true },
        });

        await command.handler(ctx as never);

        expect(resultCalls).toHaveLength(1);
        expect(resultCalls[0]?.command).toBe("pm add");
        expect(resultCalls[0]?.value).toEqual({
          actions: [
            {
              action: "added",
              nextSpecifier: "^1.2.3",
              packageName: "contract-add-demo",
              section: "devDependencies",
              usesCatalog: false,
            },
          ],
          apply: false,
          install: {
            command: "bun install",
            cwd: dir,
            enabled: true,
            executed: false,
          },
          preview: true,
          section: "devDependencies",
          summary: {
            added: 1,
            skipped: 0,
            unchanged: 0,
          },
          target: {
            catalogName: undefined,
            cwd: dir,
            label: "demo",
            manifestPath: join(dir, "package.json"),
            usesCatalog: false,
          },
        });
      });
    } finally {
      restoreFetch();
    }
  });

  test("text preview output contract stays stable", async () => {
    const restoreFetch = mockNpmLatest("1.2.3");

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0" }, null, 2)}\n`,
          "utf8",
        );
        const { ctx, textLines } = createCtx(dir, {
          args: ["contract-add-text-demo"],
          mode: "text",
          options: { dev: true },
        });

        await command.handler(ctx as never);

        expect(textLines).toEqual([
          "pm add preview",
          "Target: demo",
          "Section: devDependencies",
          "Summary: 1 added, 0 unchanged, 0 skipped.",
          "+ contract-add-text-demo ^1.2.3 (devDependencies)",
          "Install step: bun install (after --apply)",
        ]);
      });
    } finally {
      restoreFetch();
    }
  });

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
