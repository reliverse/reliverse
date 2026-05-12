import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSupportedBunLockfileProject, getBunLockfilePath } from "./lockfile";

async function withTempProject<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pm-lockfile-test-"));

  try {
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("Bun lockfile project guard", () => {
  test("accepts projects with bun.lock only", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "bun.lock"), "", "utf8");

      await expect(assertSupportedBunLockfileProject(dir)).resolves.toBeUndefined();
      expect(getBunLockfilePath(dir)).toBe(join(dir, "bun.lock"));
    });
  });

  test("rejects projects without bun.lock", async () => {
    await withTempProject(async (dir) => {
      await expect(assertSupportedBunLockfileProject(dir)).rejects.toThrow(/expected bun\.lock/);
    });
  });

  test("rejects bun.lockb and other package-manager lockfiles", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "bun.lock"), "", "utf8");
      await writeFile(join(dir, "bun.lockb"), "", "utf8");
      await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf8");

      await expect(assertSupportedBunLockfileProject(dir)).rejects.toThrow(
        /bun\.lockb.*pnpm-lock\.yaml/,
      );
    });
  });

  test("ignores nested lockfiles in node_modules and .git", async () => {
    await withTempProject(async (dir) => {
      await writeFile(join(dir, "bun.lock"), "", "utf8");
      await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(dir, ".git"), { recursive: true });
      await writeFile(join(dir, "node_modules", "pkg", "package-lock.json"), "", "utf8");
      await writeFile(join(dir, ".git", "yarn.lock"), "", "utf8");

      await expect(assertSupportedBunLockfileProject(dir)).resolves.toBeUndefined();
    });
  });
});
