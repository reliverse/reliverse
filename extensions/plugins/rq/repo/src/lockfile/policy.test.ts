import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectLockfilePolicy } from "./policy";

test("Bun lock validation includes root dependency metadata, not just child workspaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-root-lock-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        private: true,
        workspaces: ["packages/*"],
        dependencies: { example: "1.0.0" },
      }),
    );
    await writeFile(
      path.join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "fixture", dependencies: { example: "1.0.0" } } },
        packages: {},
      }),
    );
    expect((await inspectLockfilePolicy(root)).findings).toHaveLength(0);
    await writeFile(
      path.join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "fixture", dependencies: { example: "2.0.0" } } },
        packages: {},
      }),
    );
    expect(
      (await inspectLockfilePolicy(root)).findings.some(
        (f) => f.path === "package.json" && f.ruleId === "repo.lockfile.workspace-metadata",
      ),
    ).toBe(true);
    await writeFile(
      path.join(root, "bun.lock"),
      JSON.stringify({ lockfileVersion: 1, workspaces: {}, packages: {} }),
    );
    expect(
      (await inspectLockfilePolicy(root)).findings.some((f) =>
        f.message.includes("root workspace"),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
