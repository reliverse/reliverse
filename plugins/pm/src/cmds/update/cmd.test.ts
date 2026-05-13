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

function mockNpmLatest(version = "1.2.3") {
  const fetchMock = mock(
    async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest: version },
          time: { [version]: "2026-05-01T00:00:00.000Z" },
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

function mockNpmVersions(versions: Record<string, object>, latest: string) {
  const fetchMock = mock(
    async () =>
      new Response(
        JSON.stringify({
          "dist-tags": { latest },
          versions,
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
  test("json preview output contract stays stable", async () => {
    const restoreFetch = mockNpmLatest("1.2.3");

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { "contract-update-demo": "^1.0.0" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, resultCalls } = createCtx(dir, {
          args: ["contract-update-demo"],
        });

        await command.handler(ctx as never);

        expect(resultCalls).toHaveLength(1);
        expect(resultCalls[0]?.command).toBe("pm update");
        expect(resultCalls[0]?.value).toEqual({
          actions: [
            {
              action: "updated",
              nextSpecifier: "^1.2.3",
              packageName: "contract-update-demo",
              previousSpecifier: "^1.0.0",
              reason: "selected newest stable overall using smart latest strategy",
              resolutionStrategy: "smart-latest-stable",
              safeDecision: undefined,
              section: "dependencies",
              source: "target",
              targetLabel: "demo",
            },
          ],
          apply: false,
          controls: {
            ignoredPackages: [],
            onlyPackages: [],
            section: undefined,
            versionPolicy: undefined,
          },
          executionPlan: {
            changedManifests: 1,
            install: {
              command: "bun install",
              cwd: dir,
              enabled: true,
              verification: "bun.lock",
            },
            recursive: false,
            rootCatalogChanged: false,
            scannedManifests: 1,
          },
          install: {
            command: "bun install",
            cwd: dir,
            enabled: true,
            executed: false,
          },
          latest: true,
          preview: true,
          recursive: false,
          safeLatest: false,
          safeLatestPolicy: undefined,
          smart: true,
          strategy: {
            label: "smart-latest-stable",
            text: "newest stable overall (smart)",
          },
          summary: {
            missing: 0,
            noop: 0,
            skipped: 0,
            updated: 1,
          },
          target: {
            cwd: dir,
            label: "demo",
            manifestPath: join(dir, "package.json"),
          },
          targets: [
            {
              cwd: dir,
              label: "demo",
              manifestPath: join(dir, "package.json"),
            },
          ],
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
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { "contract-update-text-demo": "^1.0.0" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, textLines } = createCtx(dir, {
          args: ["contract-update-text-demo"],
          mode: "text",
        });

        await command.handler(ctx as never);

        expect(textLines).toEqual([
          "pm update preview",
          "Target: demo",
          "Strategy: newest stable overall (smart).",
          "Summary: 1 update(s), 0 unchanged, 0 skipped, 0 missing.",
          "Manifest scan: 1 changed / 1 scanned.",
          "Execution plan after --apply",
          "- manifests: 1 changed / 1 scanned",
          "- writes: 1 manifest/catalog file(s) + bun.lock snapshot",
          `- install: bun install (${dir})`,
          "- verify: bun.lock after install",
          "Planned specifier changes:",
          "- demo (dependencies)",
          "  contract-update-text-demo: ^1.0.0 -> ^1.2.3",
        ]);
      });
    } finally {
      restoreFetch();
    }
  });

  test("text preview explains non-safe-latest strategy decisions", async () => {
    const restoreFetch = mockNpmLatest("1.2.3");

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^1.0.0" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, textLines } = createCtx(dir, {
          args: ["demo"],
          mode: "text",
          options: { explain: true },
        });

        await command.handler(ctx as never);

        expect(textLines).toContain("Strategy decisions:");
        expect(textLines).toContain(
          "- demo (dependencies) :: demo :: selected newest stable overall using smart latest strategy",
        );
      });
    } finally {
      restoreFetch();
    }
  });

  test("text preview compacts large grouped diffs", async () => {
    const restoreFetch = mockNpmLatest("1.2.3");

    try {
      await withTempProject(async (dir) => {
        const dependencies = Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`large-demo-${index + 1}`, "^1.0.0"]),
        );
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, textLines } = createCtx(dir, { mode: "text" });

        await command.handler(ctx as never);

        expect(textLines).toContain("- demo (dependencies) (10 update(s))");
        expect(textLines).toContain("  large-demo-7: ^1.0.0 -> ^1.2.3");
        expect(textLines).toContain("  … 2 more update(s); use --json for the full action list");
        expect(textLines).not.toContain("  large-demo-8: ^1.0.0 -> ^1.2.3");
      });
    } finally {
      restoreFetch();
    }
  });

  test("filters discovery with --section, --ignore, and --only", async () => {
    const restoreFetch = mockNpmVersions(
      {
        "1.0.0": {},
        "1.1.0": {},
        "2.0.0": {},
      },
      "2.0.0",
    );

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify(
            {
              name: "demo",
              version: "0.0.0",
              dependencies: {
                keep: "^1.0.0",
                ignored: "^1.0.0",
              },
              devDependencies: {
                keep: "^1.0.0",
              },
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        const { ctx, resultCalls } = createCtx(dir, {
          options: {
            ignore: "ignored",
            only: "keep,ignored",
            section: "dependencies",
          },
        });

        await command.handler(ctx as never);

        const payload = resultCalls[0]?.value as {
          actions: Array<{ packageName: string; section?: string }>;
          controls: { ignoredPackages: string[]; onlyPackages: string[]; section?: string };
        };
        expect(payload.controls).toMatchObject({
          ignoredPackages: ["ignored"],
          onlyPackages: ["keep", "ignored"],
          section: "dependencies",
        });
        expect(payload.actions).toEqual([
          expect.objectContaining({ packageName: "keep", section: "dependencies" }),
        ]);
      });
    } finally {
      restoreFetch();
    }
  });

  test("applies version policy controls", async () => {
    const restoreFetch = mockNpmVersions(
      {
        "1.2.3": {},
        "1.2.4": {},
        "1.3.0": {},
        "2.0.0": {},
      },
      "2.0.0",
    );

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { "policy-demo": "^1.2.3" } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, resultCalls } = createCtx(dir, {
          args: ["policy-demo"],
          options: { patchOnly: true },
        });

        await command.handler(ctx as never);

        const payload = resultCalls[0]?.value as {
          actions: Array<{ nextSpecifier?: string; resolutionStrategy?: string }>;
          controls: { versionPolicy?: string };
        };
        expect(payload.controls.versionPolicy).toBe("patch-only");
        expect(payload.actions[0]).toMatchObject({
          nextSpecifier: "^1.2.4",
          resolutionStrategy: "patch-only",
        });
      });
    } finally {
      restoreFetch();
    }
  });

  test("rejects conflicting version policy controls", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^1.0.0" } }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir, {
        args: ["demo"],
        options: { major: false, patchOnly: true },
      });

      await expect(command.handler(ctx as never)).rejects.toThrow(/Choose only one/);
    });
  });

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
        expect(text).toMatch(/skipped 1\.3\.0: recentlyPublished:\d+d<7d/);
        expect(text).toContain("skipped 1.2.0: deprecated");
        expect(text).toContain("skipped 1.1.0: installScript");
        expect(text).toMatch(/accepted 1\.0\.0: age:\d+d, npmMetadataOk/);
      });
    } finally {
      restoreFetch();
    }
  });

  test("safe-latest reads rse.config.json and lets CLI flags override config policy", async () => {
    const restoreFetch = mockNpmPackument();

    try {
      await withTempProject(async (dir) => {
        await writeFile(
          join(dir, "package.json"),
          `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^0.9.0" } }, null, 2)}\n`,
          "utf8",
        );
        await writeFile(
          join(dir, "rse.config.json"),
          `${JSON.stringify({ pm: { safeLatest: { allowFreshScopes: [], minimumReleaseAgeDays: 20, maxFallbackDepth: 4 } } }, null, 2)}\n`,
          "utf8",
        );

        const { ctx, resultCalls } = createCtx(dir, {
          args: ["demo"],
          options: { age: "7d", safeLatest: true },
        });

        await command.handler(ctx as never);

        const payload = resultCalls[0]?.value as {
          actions: Array<{ safeDecision?: { selected?: string } }>;
          safeLatestPolicy: { maxFallbackDepth: number; minimumReleaseAgeDays: number };
        };
        expect(payload.safeLatestPolicy).toMatchObject({
          maxFallbackDepth: 4,
          minimumReleaseAgeDays: 7,
        });
        expect(payload.actions[0]?.safeDecision?.selected).toBe("1.0.0");
      });
    } finally {
      restoreFetch();
    }
  });

  test("normalizes Socket middle severity alias from CLI", async () => {
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
          options: { safeLatest: true, socketSeverityThreshold: "middle" },
        });

        await command.handler(ctx as never);

        const payload = resultCalls[0]?.value as {
          safeLatestPolicy: { socket: { severityThreshold: string } };
        };
        expect(payload.safeLatestPolicy.socket.severityThreshold).toBe("medium");
      });
    } finally {
      restoreFetch();
    }
  });

  test("rejects invalid Socket severity threshold", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^1.0.0" } }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir, {
        args: ["demo"],
        options: { safeLatest: true, socketSeverityThreshold: "severe" },
      });

      await expect(command.handler(ctx as never)).rejects.toThrow(
        /Invalid --socket-severity-threshold/,
      );
    });
  });

  test("explains where missing requested packages were searched", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        join(dir, "package.json"),
        `${JSON.stringify({ name: "demo", version: "0.0.0", dependencies: { demo: "^1.0.0" } }, null, 2)}\n`,
        "utf8",
      );
      const { ctx } = createCtx(dir, {
        args: ["missing"],
        options: { ignore: "ignored", section: "devDependencies" },
      });

      await expect(command.handler(ctx as never)).rejects.toThrow(
        /Searched 1 manifest\(s\) in section devDependencies\. Ignored: ignored\./,
      );
    });
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
