import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import command from "./cmd";

function createColors() {
  return {
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
  };
}

function createJsonCtx(cwd: string, options: Record<string, unknown>) {
  const resultCalls: Array<{ value: unknown; command?: string | undefined }> = [];
  const textLines: string[] = [];
  const errorLines: string[] = [];

  return {
    ctx: {
      cliPluginNames: ["dler"],
      colors: createColors(),
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
      colors: createColors(),
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

async function createFakeBin(root: string, name: string, body: string) {
  const binDir = join(root, "node_modules", ".bin");
  await mkdir(binDir, { recursive: true });
  const binPath = join(binDir, name);
  await writeFile(binPath, body, "utf8");
  await chmod(binPath, 0o755);
}

async function createWorkspacePackage(
  root: string,
  label: string,
  packageJson: Record<string, unknown> = { name: label },
) {
  const dir = join(root, label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(packageJson)}\n`, "utf8");
  await writeFile(join(dir, "tsconfig.json"), '{"compilerOptions":{"types":["bun"]}}\n', "utf8");
  return dir;
}

async function createSharedTsconfigPackage(root: string) {
  const dir = join(root, "node_modules", "@repo", "tsconfig");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@repo/tsconfig",
      exports: { "./ts-only.json": "./ts-only.json" },
    }),
    "utf8",
  );
  await writeFile(join(dir, "ts-only.json"), '{"compilerOptions":{"types":["bun"]}}\n', "utf8");
}

describe("dler tsc command", () => {
  test("text preview supports a non-monorepo current directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(join(root, "package.json"), '{"name":"solo"}\n', "utf8");
    await writeFile(join(root, "tsconfig.json"), '{"compilerOptions":{"types":["bun"]}}\n', "utf8");

    const { ctx, textLines } = createTextCtx(root, {});

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("dler tsc preview");
    expect(text).toContain("Runner: tsgo --noEmit fallback: tsc --noEmit");
    expect(text).toContain("Targets: 1 planned, 0 skipped");
    expect(text).toContain("Planned");
    expect(text).toContain("No typecheck executed. Pass --apply to run the planned checks.");
  });

  test("json preview keeps a stable machine-readable shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await mkdir(join(root, "packages", "missing-config"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/ok");
    await writeFile(
      join(root, "packages", "missing-config", "package.json"),
      '{"name":"missing-config"}\n',
      "utf8",
    );

    const { ctx, resultCalls } = createJsonCtx(root, {
      targets: "packages/ok,packages/missing-config",
    });

    await command.handler(ctx as never);

    expect(resultCalls[0]?.command).toBe("dler tsc");
    expect(resultCalls[0]?.value).toEqual({
      apply: false,
      bunx: false,
      concurrency: 5,
      executedTargets: [],
      fallbackRunner: "tsc",
      ok: true,
      plannedTargets: [{ cwd: join(root, "packages", "ok"), label: "packages/ok" }],
      preview: true,
      runner: "tsgo",
      runnerMode: "auto",
      skipped: [{ label: "packages/missing-config", reason: "missing tsconfig.json" }],
      skippedTargets: [{ label: "packages/missing-config", reason: "missing tsconfig.json" }],
      steps: [
        { command: "tsgo --noEmit", cwd: join(root, "packages", "ok"), label: "packages/ok" },
      ],
      targets: ["packages/ok", "packages/missing-config"],
    });
  });

  test("accepts bun types inherited through tsconfig package extends", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await createSharedTsconfigPackage(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    const packageDir = await createWorkspacePackage(root, "packages/ok");
    await writeFile(
      join(packageDir, "tsconfig.json"),
      '{"extends":"@repo/tsconfig/ts-only.json","compilerOptions":{}}\n',
      "utf8",
    );

    const { ctx, textLines } = createTextCtx(root, { targets: "packages/ok" });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("Targets: 1 planned, 0 skipped");
    expect(text).toContain("packages/ok");
  });

  test("rejects tsconfig chains without bun compiler types", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    const packageDir = await createWorkspacePackage(root, "packages/missing-bun");
    await writeFile(
      join(packageDir, "tsconfig.json"),
      '{"compilerOptions":{"types":[]}}\n',
      "utf8",
    );

    const { ctx, textLines } = createTextCtx(root, { targets: "packages/missing-bun" });

    await expect(command.handler(ctx as never)).rejects.toThrow(
      "EXIT 1: No TypeScript targets remain after validation.",
    );

    const text = textLines.join("\n");
    expect(text).toContain("Targets: 0 planned, 1 skipped");
    expect(text).toContain('tsconfig.json must include compilerOptions.types with "bun"');
  });

  test("apply runs tsgo for each planned target", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/ok");
    await createFakeBin(root, "tsgo", '#!/bin/sh\necho "tsgo ok $*"\n');

    const { ctx, textLines } = createTextCtx(root, { apply: true, targets: "packages/ok" });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("dler tsc");
    expect(text).toContain("Targets: 1 passed, 0 failed, 0 skipped");
    expect(text).toContain("Checked\n  packages/ok  tsgo");
    expect(text).toContain("Typecheck passed.");
    expect(text).toContain("Use --verbose for durations and process output.");
    expect(text).not.toContain("tsgo ok");
  });

  test("apply falls back to tsc when tsgo is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/ok");
    await createFakeBin(root, "tsc", '#!/bin/sh\necho "tsc fallback $*"\n');

    const { ctx, textLines } = createTextCtx(root, {
      apply: true,
      targets: "packages/ok",
      verbose: true,
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("packages/ok  tsc --noEmit (");
    expect(text).toContain("fallback");
    expect(text).toContain("stdout:");
    expect(text).toContain("tsc fallback --noEmit");
  });

  test("runner tsc uses tsc directly instead of tsgo fallback mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/ok");
    await createFakeBin(root, "tsgo", '#!/bin/sh\necho "should not run"\nexit 7\n');
    await createFakeBin(root, "tsc", '#!/bin/sh\necho "direct tsc $*"\n');

    const { ctx, textLines } = createTextCtx(root, {
      apply: true,
      runner: "tsc",
      targets: "packages/ok",
      verbose: true,
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("packages/ok  tsc --noEmit (");
    expect(text).toContain("direct tsc --noEmit");
    expect(text).toContain("Use --json for the full machine-readable result.");
    expect(text).not.toContain("Use --verbose for durations and process output.");
    expect(text).not.toContain("fallback");
    expect(text).not.toContain("should not run");
  });

  test("bunx renders runner through bunx", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/ok");

    const { ctx, textLines } = createTextCtx(root, {
      bunx: true,
      runner: "tsc",
      targets: "packages/ok",
      verbose: true,
    });

    await command.handler(ctx as never);

    const text = textLines.join("\n");
    expect(text).toContain("Mode: bunx");
    expect(text).toContain("Runner: bunx --silent tsc --noEmit");
    expect(text).toContain("packages/ok  bunx --silent tsc --noEmit");
  });

  test("apply surfaces failed typecheck output even without verbose", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-tsc-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }),
      "utf8",
    );
    await createWorkspacePackage(root, "packages/bad");
    await createFakeBin(root, "tsgo", '#!/bin/sh\necho "type error" >&2\nexit 2\n');

    const { ctx, textLines } = createTextCtx(root, { apply: true, targets: "packages/bad" });

    await expect(command.handler(ctx as never)).rejects.toThrow(
      "EXIT 1: Typecheck failed for packages/bad with tsgo --noEmit (exit 2).",
    );

    const text = textLines.join("\n");
    expect(text).toContain("Targets: 0 passed, 1 failed, 0 skipped");
    expect(text).toContain("stderr:");
    expect(text).toContain("type error");
    expect(text).toContain("Typecheck failed.");
  });
});
