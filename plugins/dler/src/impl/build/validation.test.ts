import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveBuildableTargets } from "./validation";

describe("build validation", () => {
  test("keeps targets with valid manifests and reports manifest-level skipped reasons", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-validation-"));
    const okDir = join(root, "packages", "ok");
    const badJsonDir = join(root, "packages", "bad-json");
    await mkdir(join(okDir, "src"), { recursive: true });
    const noScriptDir = join(root, "packages", "no-script");
    await mkdir(join(noScriptDir, "src"), { recursive: true });
    await mkdir(badJsonDir, { recursive: true });

    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }), "utf8");
    await writeFile(join(okDir, "package.json"), '{"name":"ok"}\n', "utf8");
    await writeFile(join(okDir, "src", "index.ts"), 'export const ok = 1;\n', "utf8");
    await writeFile(join(noScriptDir, "package.json"), '{"name":"no-script"}\n', "utf8");
    await writeFile(join(noScriptDir, "src", "index.ts"), 'export const noScript = 1;\n', "utf8");
    await writeFile(join(badJsonDir, "package.json"), '{not-json}\n', "utf8");

    const result = await resolveBuildableTargets({
      targets: [
        { cwd: okDir, label: "packages/ok" },
        { cwd: noScriptDir, label: "packages/no-script" },
        { cwd: badJsonDir, label: "packages/bad-json" },
        { cwd: join(root, "packages", "missing"), label: "packages/missing" },
      ],
    });

    expect(result.buildable).toEqual([
      expect.objectContaining({ cwd: okDir, label: "packages/ok" }),
      expect.objectContaining({ cwd: noScriptDir, label: "packages/no-script" }),
    ]);
    expect(result.skipped).toEqual([
      { label: "packages/bad-json", reason: "invalid package.json" },
      { label: "packages/missing", reason: "missing package.json" },
    ]);
  });

  test("ignores @repo scoped packages even when a generated build command exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-validation-"));
    const pkgDir = join(root, "packages", "repo-only");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }), "utf8");
    await writeFile(join(pkgDir, "package.json"), '{"name":"@repo/hidden"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), 'export const hidden = 1;\n', "utf8");

    const result = await resolveBuildableTargets({
      targets: [{ cwd: pkgDir, label: "packages/repo-only" }],
    });

    expect(result.buildable).toEqual([]);
    expect(result.skipped).toEqual([
      { label: "packages/repo-only", reason: "package @repo/hidden is ignored by workspace policy" },
    ]);
  });
});
