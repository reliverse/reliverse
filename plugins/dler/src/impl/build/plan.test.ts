import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBuildPlan } from "./plan";
import { resolveRequestedTargets } from "../shared-targets";

describe("build plan", () => {
  test("creates a plan with orchestrator and package commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-plan-"));
    const pkgDir = join(root, "plugins", "demo");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["plugins/*"] } }), "utf8");
    await writeFile(join(pkgDir, "package.json"), '{"name":"demo"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const demo = 1;\n", "utf8");

    const plan = await createBuildPlan({
      provider: "bun",
      targets: [{ cwd: pkgDir, label: "plugins/demo" }],
    });

    expect(plan.provider).toBe("bun");
    expect(plan.skippedTargets).toEqual([]);
    expect(plan.plannedTargets).toEqual([
      expect.objectContaining({
        cwd: pkgDir,
        label: "plugins/demo",
        orchestratorCommand: expect.objectContaining({ display: expect.stringContaining("internal-runner.ts") }),
        packageCommand: expect.objectContaining({ display: expect.stringContaining("bun build") }),
      }),
    ]);
    expect(plan.executionTargets).toEqual([
      expect.objectContaining({
        cwd: pkgDir,
        label: "plugins/demo",
        displayCommand: expect.stringContaining("internal-runner.ts"),
      }),
    ]);
  });

  test("supports root-cwd planning across multiple workspace targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-plan-"));
    const pluginDir = join(root, "plugins", "alpha");
    const packageDir = join(root, "packages", "beta");
    await mkdir(join(pluginDir, "src"), { recursive: true });
    await mkdir(join(packageDir, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["plugins/*", "packages/*"] } }), "utf8");
    await writeFile(join(pluginDir, "package.json"), '{"name":"alpha"}\n', "utf8");
    await writeFile(join(pluginDir, "src", "index.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(join(packageDir, "package.json"), '{"name":"beta"}\n', "utf8");
    await writeFile(join(packageDir, "src", "index.ts"), "export const beta = 1;\n", "utf8");

    const requestedTargets = await resolveRequestedTargets({ cwd: root, rawTargets: undefined });
    const plan = await createBuildPlan({ provider: "bun", targets: requestedTargets.resolution.resolved });

    expect(requestedTargets.labels).toEqual(["packages/beta", "plugins/alpha"]);
    expect(plan.plannedTargets.map((target) => target.label)).toEqual(["packages/beta", "plugins/alpha"]);
  });

  test("supports package-cwd planning for the single current workspace target", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-plan-"));
    const pkgDir = join(root, "packages", "solo");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }), "utf8");
    await writeFile(join(pkgDir, "package.json"), '{"name":"solo"}\n', "utf8");
    await writeFile(join(pkgDir, "src", "index.ts"), "export const solo = 1;\n", "utf8");

    const requestedTargets = await resolveRequestedTargets({ cwd: pkgDir, rawTargets: undefined });
    const plan = await createBuildPlan({ provider: "bun", targets: requestedTargets.resolution.resolved });

    expect(requestedTargets.labels).toEqual(["packages/solo"]);
    expect(plan.plannedTargets.map((target) => target.label)).toEqual(["packages/solo"]);
  });

  test("keeps explicit-target resolution skips separate from plan-level skips", async () => {
    const root = await mkdtemp(join(tmpdir(), "dler-build-plan-"));
    const okDir = join(root, "packages", "ok");
    const invalidDir = join(root, "packages", "broken");
    await mkdir(join(okDir, "src"), { recursive: true });
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: { packages: ["packages/*"] } }), "utf8");
    await writeFile(join(okDir, "package.json"), '{"name":"ok"}\n', "utf8");
    await writeFile(join(okDir, "src", "index.ts"), "export const ok = 1;\n", "utf8");
    await writeFile(join(invalidDir, "package.json"), '{not-json}\n', "utf8");

    const requestedTargets = await resolveRequestedTargets({
      cwd: root,
      rawTargets: "packages/ok,packages/broken,packages/missing",
    });
    const plan = await createBuildPlan({ provider: "bun", targets: requestedTargets.resolution.resolved });

    expect(requestedTargets.resolution.skipped).toEqual([
      { label: "packages/missing", reason: expect.stringContaining("not a directory:") },
    ]);
    expect(plan.skippedTargets).toEqual([
      { label: "packages/broken", reason: "invalid package.json" },
    ]);
    expect(plan.plannedTargets.map((target) => target.label)).toEqual(["packages/ok"]);
  });
});
