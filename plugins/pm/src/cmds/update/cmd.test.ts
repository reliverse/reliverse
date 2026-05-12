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
      args: [...(options.args ?? [])],
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
      options: {
        cwd,
        ...(options.options ?? {}),
      },
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
  const dir = await mkdtemp(join(tmpdir(), "pm-update-command-test-"));

  try {
    await writeFile(join(dir, "bun.lock"), "", "utf8");
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function mockNpmPackument() {
  const fetchMock = mock(
    async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest: "1.3.0" },
          time: {
            "1.0.0": "2026-04-01T00:00:00.000Z",
            "1.1.0": "2026-05-01T00:00:00.000Z",
            "1.2.0": "2026-05-02T00:00:00.000Z",
            "1.3.0": "2026-05-11T00:00:00.000Z",
          },
          versions: {
            "1.0.0": {},
            "1.1.0": { scripts: { postinstall: "node postinstall.js" } },
            "1.2.0": { deprecated: "bad release" },
            "1.3.0": {},
          },
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

describe("pm update command", () => {
  test("json safe-latest preview reports selected version and skipped candidates", async () => {
    const restoreFetch = mockNpmPackument();

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^0.9.0" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, resultCalls } = createCtx(dir, {
          args: ["demo"],
          options: { age: "7d", safeLatest: true },
        });

        await command.handler(ctx as never);

        expect(resultCalls).toHaveLength(1);
        expect(resultCalls[0]?.command).toBe("pm update");
        expect(resultCalls[0]?.value).toMatchObject({
          apply: false,
          preview: true,
          safeLatest: true,
          summary: { updated: 1 },
          strategy: { label: "safe-latest" },
        });

        const payload = resultCalls[0]?.value as {
          actions: Array<{
            nextSpecifier?: string;
            packageName: string;
            safeDecision?: { selected?: string; skipped: Array<{ version: string }> };
          }>;
        };
        expect(payload.actions[0]).toMatchObject({
          action: "updated",
          nextSpecifier: "^1.0.0",
          packageName: "demo",
          safeDecision: {
            npmLatest: "1.3.0",
            selected: "1.0.0",
            skipped: [{ version: "1.3.0" }, { version: "1.2.0" }, { version: "1.1.0" }],
          },
        });
      });
    } finally {
      restoreFetch();
    }
  });

  test("text safe-latest preview explains decision trail", async () => {
    const restoreFetch = mockNpmPackument();

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^0.9.0" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, textLines } = createCtx(dir, {
          args: ["demo"],
          mode: "text",
          options: { age: "7d", explain: true, safeLatest: true },
        });

        await command.handler(ctx as never);

        const text = textLines.join("\n");
        expect(text).toContain("pm update preview");
        expect(text).toContain("Strategy: newest stable version passing Rse safe-latest policy.");
        expect(text).toContain("demo: ^0.9.0 -> ^1.0.0");
        expect(text).toContain("Safe-latest decisions:");
        expect(text).toContain("skipped 1.3.0: recentlyPublished:1d<7d");
        expect(text).toContain("skipped 1.2.0: deprecated");
        expect(text).toContain("skipped 1.1.0: installScript");
        expect(text).toContain("accepted 1.0.0: age:41d, npmMetadataOk");
      });
    } finally {
      restoreFetch();
    }
  });

  test("fails at command level when bun.lock is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pm-update-command-test-"));

    try {
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^1.0.0" } }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir, { args: ["demo"], options: { safeLatest: true } });

      await expect(command.handler(ctx as never)).rejects.toThrow(/expected bun\.lock/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
