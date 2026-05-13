import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBunLockfilePath } from "./lockfile";
import { parseBunLockPackages, verifyBunLock } from "./verify-lock";

async function withTempProject<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pm-verify-lock-test-"));

  try {
    return await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe("Bun lockfile verification", () => {
  test("parses resolved registry packages and skips workspace packages", () => {
    const packages = parseBunLockPackages(`{
      "lockfileVersion": 1,
      "packages": {
        "@scope/pkg": ["@scope/pkg@1.2.3", "", {}, "sha512-scoped"],
        "demo": ["demo@2.0.0", "", {}, "sha512-demo"],
        "local": ["local@workspace:packages/local"]
      }
    }`);

    expect(packages).toEqual([
      {
        integrity: "sha512-scoped",
        name: "@scope/pkg",
        resolution: "@scope/pkg@1.2.3",
        version: "1.2.3",
      },
      { integrity: "sha512-demo", name: "demo", resolution: "demo@2.0.0", version: "2.0.0" },
    ]);
  });

  test("reports missing integrity metadata", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        getBunLockfilePath(dir),
        `{
          "lockfileVersion": 1,
          "packages": {
            "demo": ["demo@1.0.0", "", {}]
          }
        }`,
        "utf8",
      );

      const result = await verifyBunLock({ cwd: dir });

      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        { packageName: "demo", reason: "missingIntegrity", severity: "error", version: "1.0.0" },
      ]);
    });
  });

  test("checks the resolved tree with Socket when enabled", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        getBunLockfilePath(dir),
        `{
          "lockfileVersion": 1,
          "packages": {
            "demo": ["demo@1.0.0", "", {}, "sha512-demo"]
          }
        }`,
        "utf8",
      );

      const result = await verifyBunLock({
        cwd: dir,
        socket: true,
        socketChecker: async () => ({
          alerts: [{ category: "malware", severity: "critical", title: "Known malware" }],
          ok: true,
        }),
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toEqual([
        {
          packageName: "demo",
          reason: "socketAlert:critical:malware:Known malware",
          severity: "error",
          version: "1.0.0",
        },
      ]);
    });
  });

  test("only fails unavailable Socket checks when Socket is required", async () => {
    await withTempProject(async (dir) => {
      await writeFile(
        getBunLockfilePath(dir),
        `{
          "lockfileVersion": 1,
          "packages": {
            "demo": ["demo@1.0.0", "", {}, "sha512-demo"]
          }
        }`,
        "utf8",
      );

      const optionalResult = await verifyBunLock({
        cwd: dir,
        socket: true,
        socketChecker: async () => ({
          alerts: [],
          ok: false,
          unavailableReason: "socket cli missing",
        }),
      });
      const requiredResult = await verifyBunLock({
        cwd: dir,
        requireSocket: true,
        socketChecker: async () => ({
          alerts: [],
          ok: false,
          unavailableReason: "socket cli missing",
        }),
      });

      expect(optionalResult.ok).toBe(true);
      expect(requiredResult.ok).toBe(false);
      expect(requiredResult.issues).toEqual([
        {
          packageName: "demo",
          reason: "socketUnavailable:socket cli missing",
          severity: "error",
          version: "1.0.0",
        },
      ]);
    });
  });
});
