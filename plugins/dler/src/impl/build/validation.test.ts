import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveBuildableTargets } from "./validation";

describe("build validation", () => {
  test("keeps only targets with a build script and reports skipped reasons", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-validation-"));
    const okDir = join(root, "packages", "ok");
    const noScriptDir = join(root, "packages", "no-script");
    const badJsonDir = join(root, "packages", "bad-json");
    await mkdir(okDir, { recursive: true });
    await mkdir(noScriptDir, { recursive: true });
    await mkdir(badJsonDir, { recursive: true });

    await writeFile(join(okDir, "package.json"), '{"scripts":{"build":"bun build src/index.ts"}}\n', "utf8");
    await writeFile(join(noScriptDir, "package.json"), '{"scripts":{"test":"bun test"}}\n', "utf8");
    await writeFile(join(badJsonDir, "package.json"), '{not-json}\n', "utf8");

    const result = await resolveBuildableTargets({
      script: "build",
      targets: [
        { cwd: okDir, label: "packages/ok" },
        { cwd: noScriptDir, label: "packages/no-script" },
        { cwd: badJsonDir, label: "packages/bad-json" },
        { cwd: join(root, "packages", "missing"), label: "packages/missing" },
      ],
    });

    expect(result.buildable).toEqual([
      expect.objectContaining({ cwd: okDir, label: "packages/ok", script: "build" }),
    ]);
    expect(result.skipped).toEqual([
      { label: "packages/no-script", reason: "missing scripts.build" },
      { label: "packages/bad-json", reason: "invalid package.json" },
      { label: "packages/missing", reason: "missing package.json" },
    ]);
  });
});
