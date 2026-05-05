import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { diffArchiveWithOutput } from "./diff";
import { packArchive } from "./pack";
import { unpackArchive } from "./unpack";
import { verifyArchive } from "./verify";
import { buildIgnoredNames } from "../ignore";

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "relpack-010-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "junk"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "node_modules", "junk", "skip.txt"), "skip\n");
  return root;
}

describe("manifest, verify, diff, and rollback", () => {
  test("pack embeds a manifest and verify checks it", async () => {
    const cwd = await createFixture();
    const ctx = { cwd, env: process.env };
    const output = path.join(cwd, "artifact.zip");
    const ignoredNames = buildIgnoredNames({ includeDefaultIgnores: true });

    const packed = await packArchive(
      { cwd, inputs: ["."], output, format: "zip", overwrite: "files", dryRun: false, ignoredNames },
      ctx,
    );

    expect(packed.exitCode).toBe(0);
    expect(packed.manifest?.packageName).toBe("fixture");
    expect(packed.skipped.some((entry) => entry.matchedName === "node_modules")).toBe(true);

    const verified = await verifyArchive({ cwd, archive: output, format: "zip" }, ctx);
    expect(verified.ok).toBe(true);
    expect(verified.manifest.version).toBe("1.0.0");
  });

  test("diff reports added and removed paths", async () => {
    const cwd = await createFixture();
    const ctx = { cwd, env: process.env };
    const output = path.join(cwd, "artifact.zip");
    const target = path.join(cwd, "out");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "old.txt"), "old\n");

    await packArchive(
      {
        cwd,
        inputs: ["package.json", "src"],
        output,
        format: "zip",
        overwrite: "files",
        dryRun: false,
        ignoredNames: [],
      },
      ctx,
    );

    const diff = await diffArchiveWithOutput({ cwd, archive: output, outputDir: "out", format: "zip" }, ctx);
    expect(diff.added).toContain("package.json");
    expect(diff.removed).toContain("old.txt");
  });

  test("rollback restores backup when post-check fails", async () => {
    const cwd = await createFixture();
    const ctx = { cwd, env: process.env };
    const output = path.join(cwd, "artifact.zip");
    const target = path.join(cwd, "out");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "keep.txt"), "original");

    await packArchive(
      {
        cwd,
        inputs: ["package.json"],
        output,
        format: "zip",
        overwrite: "files",
        dryRun: false,
        ignoredNames: [],
      },
      ctx,
    );

    await expect(
      unpackArchive(
        {
          cwd,
          archive: output,
          outputDir: "out",
          format: "zip",
          overwrite: "files",
          cleanOutput: true,
          backup: true,
          rollbackOnFail: true,
          postCheckCommand: "false",
          dryRun: false,
        },
        ctx,
      ),
    ).rejects.toThrow();

    expect(await readFile(path.join(target, "keep.txt"), "utf8")).toBe("original");
  });
});
