import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { hasGlobMagic, resolveArchiveInput, resolveArchiveInputs } from "./glob";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "relpack-glob-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("archive glob resolution", () => {
  test("detects glob magic", () => {
    expect(hasGlobMagic("./relpack-*.zip")).toBe(true);
    expect(hasGlobMagic("./relpack-0.0.6.zip")).toBe(false);
  });

  test("resolves one matching glob", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "relpack-0.0.6.zip"), "zip");

      const result = await resolveArchiveInput(dir, ["./relpack-*.zip"]);

      expect(result.archive).toBe("./relpack-0.0.6.zip");
      expect(result.matches).toEqual(["./relpack-0.0.6.zip"]);
      expect(result.usedGlob).toBe(true);
      expect(result.selectedBy).toBe("single-match");
    });
  });

  test("selects highest version-like filename when a glob has multiple matches", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "relpack-0.0.5.zip"), "zip");
      await writeFile(path.join(dir, "relpack-0.0.10.zip"), "zip");
      await writeFile(path.join(dir, "relpack-0.0.6.zip"), "zip");

      const result = await resolveArchiveInput(dir, ["./relpack-*.zip"]);

      expect(result.archive).toBe("./relpack-0.0.10.zip");
      expect(result.matches).toEqual([
        "./relpack-0.0.5.zip",
        "./relpack-0.0.6.zip",
        "./relpack-0.0.10.zip",
      ]);
      expect(result.selectedBy).toBe("highest-version");
    });
  });

  test("handles shell-expanded glob args by selecting the highest version", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "relpack-0.0.5.zip"), "zip");
      await writeFile(path.join(dir, "relpack-0.0.6.zip"), "zip");

      const result = await resolveArchiveInput(dir, ["./relpack-0.0.5.zip", "./relpack-0.0.6.zip"]);

      expect(result.archive).toBe("./relpack-0.0.6.zip");
      expect(result.matches).toEqual(["./relpack-0.0.5.zip", "./relpack-0.0.6.zip"]);
      expect(result.usedGlob).toBe(true);
      expect(result.selectedBy).toBe("highest-version");
    });
  });

  test("supports recursive star-star globs", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "releases", "nested"), { recursive: true });
      await writeFile(path.join(dir, "releases", "nested", "relpack-0.0.6.zip"), "zip");

      const result = await resolveArchiveInput(dir, ["./releases/**/*.zip"]);

      expect(result.archive).toBe("./releases/nested/relpack-0.0.6.zip");
      expect(result.matches).toEqual(["./releases/nested/relpack-0.0.6.zip"]);
    });
  });

  test("groups shell-expanded versioned archives by package-like filename", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-glob-group-"));
    try {
      await writeFile(path.join(dir, "rse-0.1.0.zip"), "old rse");
      await writeFile(path.join(dir, "rse-0.1.1.zip"), "new rse");
      await writeFile(path.join(dir, "relpack-0.1.0.zip"), "old relpack");
      await writeFile(path.join(dir, "relpack-0.1.1.zip"), "new relpack");

      const resolution = await resolveArchiveInputs(dir, [
        "./rse-0.1.0.zip",
        "./rse-0.1.1.zip",
        "./relpack-0.1.0.zip",
        "./relpack-0.1.1.zip",
      ]);

      expect(resolution.archives.map((archive) => archive.archive)).toEqual([
        "./rse-0.1.1.zip",
        "./relpack-0.1.1.zip",
      ]);
      expect(resolution.groupedShellExpansion).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
