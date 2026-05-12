import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectSnapshots, restoreSnapshots, withSnapshotRollback } from "./lib";
import { getBunLockfilePath } from "./lockfile";

async function withTempProject<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pm-transaction-test-"));

  try {
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("pm transaction snapshots", () => {
  test("restore bun.lock alongside package manifests", async () => {
    await withTempProject(async (dir) => {
      const manifestPath = join(dir, "package.json");
      const lockfilePath = getBunLockfilePath(dir);

      await writeFile(manifestPath, '{"dependencies":{"a":"1.0.0"}}\n', "utf8");
      await writeFile(lockfilePath, "original lock\n", "utf8");

      const snapshots = await collectSnapshots([manifestPath, lockfilePath]);

      await writeFile(manifestPath, '{"dependencies":{"a":"2.0.0"}}\n', "utf8");
      await writeFile(lockfilePath, "mutated lock\n", "utf8");

      await restoreSnapshots(snapshots);

      expect(await readFile(manifestPath, "utf8")).toBe('{"dependencies":{"a":"1.0.0"}}\n');
      expect(await readFile(lockfilePath, "utf8")).toBe("original lock\n");
    });
  });

  test("withSnapshotRollback restores all snapshots when any transaction step throws", async () => {
    await withTempProject(async (dir) => {
      const manifestPath = join(dir, "package.json");
      const lockfilePath = getBunLockfilePath(dir);

      await writeFile(manifestPath, '{"dependencies":{"a":"1.0.0"}}\n', "utf8");
      await writeFile(lockfilePath, "original lock\n", "utf8");

      await expect(
        withSnapshotRollback([manifestPath, lockfilePath], async () => {
          await writeFile(manifestPath, '{"dependencies":{"a":"2.0.0"}}\n', "utf8");
          await writeFile(lockfilePath, "mutated lock\n", "utf8");
          throw new Error("simulated partial failure");
        }),
      ).rejects.toThrow("simulated partial failure");

      expect(await readFile(manifestPath, "utf8")).toBe('{"dependencies":{"a":"1.0.0"}}\n');
      expect(await readFile(lockfilePath, "utf8")).toBe("original lock\n");
    });
  });
});
