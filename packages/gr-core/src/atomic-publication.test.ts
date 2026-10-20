import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { publishGrArtifactAtomically } from "./atomic-publication";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gr-atomic-publication-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("publishes a complete artifact only after the temporary writer succeeds", async () => {
  const root = await tempRoot();
  const output = path.join(root, "bundle.tar.zst");

  const result = await publishGrArtifactAtomically({
    output,
    writeTemporary: async (temporaryOutput) => {
      expect(await Bun.file(output).exists()).toBe(false);

      await writeFile(temporaryOutput, "complete artifact\n");

      expect(await Bun.file(output).exists()).toBe(false);

      return { digest: "fixture-digest" };
    },
  });

  expect(result).toEqual({
    output,
    value: { digest: "fixture-digest" },
  });
  expect(await readFile(output, "utf8")).toBe("complete artifact\n");

  const names = await readdir(root);
  expect(names).toEqual(["bundle.tar.zst"]);
});

test("removes a partial temporary artifact and leaves final output absent on writer failure", async () => {
  const root = await tempRoot();
  const output = path.join(root, "bundle.tar.zst");

  await expect(
    publishGrArtifactAtomically({
      output,
      writeTemporary: async (temporaryOutput) => {
        await writeFile(temporaryOutput, "partial artifact\n");
        throw new Error("synthetic archive failure");
      },
    }),
  ).rejects.toThrow("synthetic archive failure");

  expect(await Bun.file(output).exists()).toBe(false);

  const names = await readdir(root);
  expect(names).toEqual([]);
});

test("never overwrites an existing final artifact", async () => {
  const root = await tempRoot();
  const output = path.join(root, "bundle.tar.zst");

  await writeFile(output, "historical artifact\n");

  let writerCalled = false;

  await expect(
    publishGrArtifactAtomically({
      output,
      writeTemporary: async () => {
        writerCalled = true;
      },
    }),
  ).rejects.toThrow("already exists");

  expect(writerCalled).toBe(false);
  expect(await readFile(output, "utf8")).toBe("historical artifact\n");
});
