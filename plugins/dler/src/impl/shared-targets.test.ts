import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fileExists, parseTargetsOption, resolveDirectoryTargets, resolveRequestedTargets } from "./shared-targets";

describe("shared target helpers", () => {
  test("parseTargetsOption trims, drops empties, and deduplicates while preserving order", () => {
    expect(parseTargetsOption(" packages/a,packages/b, packages/a ,,packages/c ")).toEqual([
      "packages/a",
      "packages/b",
      "packages/c",
    ]);
  });

  test("resolveDirectoryTargets splits valid and skipped labels", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-targets-"));
    await mkdir(join(root, "packages"), { recursive: true });
    await mkdir(join(root, "packages", "ok"), { recursive: true });

    const result = await resolveDirectoryTargets(root, ["packages/ok", "packages/missing"]);

    expect(result.resolved).toEqual([
      {
        cwd: join(root, "packages", "ok"),
        label: "packages/ok",
      },
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.label).toBe("packages/missing");
  });

  test("fileExists reports presence conservatively", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-files-"));
    const file = join(root, "package.json");
    await writeFile(file, "{}\n", "utf8");

    expect(await fileExists(file)).toBe(true);
    expect(await fileExists(join(root, "missing.json"))).toBe(false);
  });

  test("resolveRequestedTargets uses explicit labels when provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-targets-"));
    await mkdir(join(root, "packages", "ok"), { recursive: true });

    const result = await resolveRequestedTargets({
      cwd: root,
      rawTargets: "packages/ok,packages/missing",
    });

    expect(result.labels).toEqual(["packages/ok", "packages/missing"]);
    expect(result.resolution.resolved).toEqual([
      { cwd: join(root, "packages", "ok"), label: "packages/ok" },
    ]);
    expect(result.resolution.skipped).toHaveLength(1);
  });
});
