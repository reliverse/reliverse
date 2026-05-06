import { describe, expect, test } from "bun:test";
import { access, lstat, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RelpackError } from "./error";
import { cleanOutputDirectory, deleteExistingFile } from "./fs";

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("filesystem helpers", () => {
  test("deleteExistingFile removes a regular file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-delete-file-"));
    const file = path.join(dir, "archive.zip");
    await writeFile(file, "zip-ish");

    await deleteExistingFile(file);

    expect(await exists(file)).toBe(false);
  });

  test("deleteExistingFile refuses directories", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-delete-dir-"));
    const nestedDir = path.join(dir, "archive.zip");
    await mkdir(nestedDir);

    await expect(deleteExistingFile(nestedDir)).rejects.toBeInstanceOf(RelpackError);
    expect(await exists(nestedDir)).toBe(true);
  });

  test("cleanOutputDirectory removes an existing output directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-clean-output-"));
    const outputDir = path.join(dir, "plugins", "relpack");
    const oldFile = path.join(outputDir, "old.txt");
    await mkdir(outputDir, { recursive: true });
    await writeFile(oldFile, "old");

    await cleanOutputDirectory(outputDir, dir);

    expect(await exists(outputDir)).toBe(false);
  });

  test("cleanOutputDirectory treats missing output directory as a no-op", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-clean-missing-"));
    const outputDir = path.join(dir, "plugins", "relpack");

    await cleanOutputDirectory(outputDir, dir);

    expect(await exists(outputDir)).toBe(false);
  });

  test("cleanOutputDirectory refuses the current working directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-clean-cwd-"));

    await expect(cleanOutputDirectory(dir, dir)).rejects.toBeInstanceOf(RelpackError);
    expect(await exists(dir)).toBe(true);
  });

  test("cleanOutputDirectory refuses paths outside the current workspace", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "relpack-clean-workspace-"));
    const outside = await mkdtemp(path.join(tmpdir(), "relpack-clean-outside-"));

    await expect(cleanOutputDirectory(outside, workspace)).rejects.toBeInstanceOf(RelpackError);
    expect(await exists(outside)).toBe(true);
  });

  test("cleanOutputDirectory refuses symlinks", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relpack-clean-symlink-"));
    const target = path.join(dir, "target");
    const link = path.join(dir, "link");
    await mkdir(target);
    await symlink(target, link);

    await expect(cleanOutputDirectory(link, dir)).rejects.toBeInstanceOf(RelpackError);
    const info = await lstat(link);
    expect(info.isSymbolicLink()).toBe(true);
  });
});
