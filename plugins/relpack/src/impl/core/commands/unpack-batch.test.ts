import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { packArchive } from "./pack";
import { deleteBatchSourceArchives, unpackArchiveBatch } from "./unpack-batch";
import type { CommandContext } from "../types";

async function createBatchFixture(): Promise<{
  readonly root: string;
  readonly ctx: CommandContext;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "relpack-batch-"));
  const ctx = { cwd: root, env: process.env };

  await mkdir(path.join(root, "sources/rse"), { recursive: true });
  await mkdir(path.join(root, "sources/relpack"), { recursive: true });
  await writeFile(path.join(root, "sources/rse/package.json"), '{"name":"@reliverse/rse","version":"0.1.1"}\n');
  await writeFile(path.join(root, "sources/relpack/package.json"), '{"name":"@reliverse/relpack-rse-plugin","version":"0.1.1"}\n');

  await packArchive(
    {
      cwd: root,
      inputs: ["sources/rse"],
      output: "rse-0.1.1.zip",
      overwrite: "never",
      dryRun: false,
      ignoredNames: [],
    },
    ctx,
  );

  await packArchive(
    {
      cwd: root,
      inputs: ["sources/relpack"],
      output: "relpack-0.1.1.zip",
      overwrite: "never",
      dryRun: false,
      ignoredNames: [],
    },
    ctx,
  );

  await mkdir(path.join(root, "apps/rse"), { recursive: true });
  await mkdir(path.join(root, "plugins/relpack"), { recursive: true });
  await writeFile(path.join(root, "apps/rse/old.txt"), "old rse\n");
  await writeFile(path.join(root, "plugins/relpack/old.txt"), "old relpack\n");

  return { root, ctx };
}

describe("batch unpack", () => {
  test("cleans outputs, extracts all archives, runs one post-check, and deletes sources after success", async () => {
    const { root, ctx } = await createBatchFixture();
    try {
      const result = await unpackArchiveBatch(
        {
          cwd: root,
          items: [
            { archive: "rse-0.1.1.zip", outputDir: "apps/rse" },
            { archive: "relpack-0.1.1.zip", outputDir: "plugins/relpack" },
          ],
          overwrite: "files",
          dryRun: false,
          cleanOutput: true,
          backup: true,
          rollbackOnFail: true,
          postCheckCommand:
            "test -f apps/rse/sources/rse/package.json && test -f plugins/relpack/sources/relpack/package.json",
        },
        ctx,
      );

      expect(result.items).toHaveLength(2);
      expect(result.postCheck?.ok).toBe(true);
      expect(result.backupCreated).toBe(true);
      expect(await readFile(path.join(root, "apps/rse/sources/rse/package.json"), "utf8")).toContain("@reliverse/rse");
      expect(await readFile(path.join(root, "plugins/relpack/sources/relpack/package.json"), "utf8")).toContain("relpack");

      const deleted = await deleteBatchSourceArchives(result.items, root);
      expect(deleted).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rolls all outputs back when the batch post-check fails", async () => {
    const { root, ctx } = await createBatchFixture();
    try {
      await expect(
        unpackArchiveBatch(
          {
            cwd: root,
            items: [
              { archive: "rse-0.1.1.zip", outputDir: "apps/rse" },
              { archive: "relpack-0.1.1.zip", outputDir: "plugins/relpack" },
            ],
            overwrite: "files",
            dryRun: false,
            cleanOutput: true,
            backup: true,
            rollbackOnFail: true,
            postCheckCommand: "exit 19",
          },
          ctx,
        ),
      ).rejects.toThrow("Rollback: restored batch output directories");

      expect(await readFile(path.join(root, "apps/rse/old.txt"), "utf8")).toBe("old rse\n");
      expect(await readFile(path.join(root, "plugins/relpack/old.txt"), "utf8")).toBe("old relpack\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
