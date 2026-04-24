import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPrebuildPlanForPackage } from "./prebuild";

describe("publish prebuild", () => {
  test("creates a one-target shared build plan for the package", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-pub-prebuild-"));
    const pkgDir = join(root, "packages", "demo");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }), "utf8");
    await writeFile(join(pkgDir, "package.json"), '{"name":"demo"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const demo = 1;\n", "utf8");

    const plan = await createPrebuildPlanForPackage(pkgDir, "packages/demo");

    expect(plan.provider).toBe("bun");
    expect(plan.plannedTargets).toHaveLength(1);
    expect(plan.plannedTargets[0]).toMatchObject({
      cwd: pkgDir,
      label: "packages/demo",
      packageCommand: { display: expect.stringContaining("bun build ./src/index.ts") },
    });
    expect(plan.executionTargets).toHaveLength(1);
    expect(plan.executionTargets[0]).toMatchObject({
      cwd: pkgDir,
      label: "packages/demo",
      displayCommand: expect.stringContaining("internal-runner.ts"),
    });
  });
});
