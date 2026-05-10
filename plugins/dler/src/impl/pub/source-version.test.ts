import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncPackageJsonVersion } from "./source-version";

describe("publish source version sync", () => {
  test("updates the real package.json before publish when the publish version changes", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "dler-pub-source-version-"));
    const packageJsonPath = join(packageRoot, "package.json");
    await writeFile(
      packageJsonPath,
      `${JSON.stringify({ name: "demo", version: "1.0.0", type: "module" }, null, 2)}\n`,
      "utf8",
    );

    const result = await syncPackageJsonVersion(packageRoot, "1.0.1");

    expect(result).toEqual({
      packageJsonPath,
      previousVersion: "1.0.0",
      updated: true,
      version: "1.0.1",
    });
    await expect(readFile(packageJsonPath, "utf8")).resolves.toBe(
      `${JSON.stringify({ name: "demo", version: "1.0.1", type: "module" }, null, 2)}\n`,
    );
  });

  test("does not rewrite package.json when the version already matches", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "dler-pub-source-version-"));
    const packageJsonPath = join(packageRoot, "package.json");
    const manifest = `${JSON.stringify({ name: "demo", version: "1.0.0" }, null, 2)}\n`;
    await writeFile(packageJsonPath, manifest, "utf8");

    const result = await syncPackageJsonVersion(packageRoot, "1.0.0");

    expect(result).toEqual({
      packageJsonPath,
      previousVersion: "1.0.0",
      updated: false,
      version: "1.0.0",
    });
    await expect(readFile(packageJsonPath, "utf8")).resolves.toBe(manifest);
  });
});
