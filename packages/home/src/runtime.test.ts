import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function run(
  command: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; stderr: string }> {
  const child = Bun.spawn([...command], { cwd, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  return { exitCode: await child.exited, stderr };
}

import {
  collectReliverseHomeAuthoredPatterns,
  initializeReliverseHomeGit,
  RELIVERSE_HOME_GITIGNORE,
  RELIVERSE_HOME_GITIGNORE_LEGACY_RSE_CONFIG_V0,
  RELIVERSE_HOME_PRE_COMMIT_HOOK,
  RELIVERSE_HOME_PRE_COMMIT_HOOK_LEGACY_RSE_CONFIG_V0,
  renderReliverseHomeGitignore,
} from "./git";
import { applyReliverseHomeInitPlan, inspectReliverseHome, planReliverseHomeInit } from "./runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Reliverse Home", () => {
  test("derives shared Git policy from Home-authored contributions", () => {
    const authored = collectReliverseHomeAuthoredPatterns();
    expect(authored).toContain("principals/prn_*/principal.json");
    expect(authored).toContain("rse/agents/prn_*/agt_*/src/**");
    expect(renderReliverseHomeGitignore()).toContain("!/rse/agents/prn_*/agt_*/src/**");
  });

  test("plans opaque principal paths and applies an idempotent v0 home", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const plan = await planReliverseHomeInit({
      root,
      principalHandle: "Operator",
      displayName: "Owner",
      hostUser: "operator",
    });

    expect(plan.principal.handle).toBe("operator");
    expect(plan.principal.id).toMatch(/^prn_[0-9a-f]{32}$/u);
    expect(plan.directories.some((entry) => entry.endsWith("/rse/agents"))).toBe(true);

    const inspection = await applyReliverseHomeInitPlan(plan);
    expect(inspection.ok).toBe(true);
    expect(inspection.manifest?.defaultPrincipalId).toBe(plan.principal.id);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(
      "rse/agents/prn_*/agt_*/src/**",
    );

    const second = await planReliverseHomeInit({ root, principalHandle: "operator" });
    expect(second.existing).toBe(true);
    expect(second.principal.id).toBe(plan.principal.id);
    expect((await applyReliverseHomeInitPlan(second)).ok).toBe(true);
  });

  test("initializes shared local Git with no remote and the managed hook", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-git-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const plan = await planReliverseHomeInit({ root, principalHandle: "operator" });
    await applyReliverseHomeInitPlan(plan);
    await initializeReliverseHomeGit(root);
    const inspection = await inspectReliverseHome(root);
    expect(inspection.git.initialized).toBe(true);
    expect(inspection.git.remoteCount).toBe(0);
    expect(inspection.git.hooksPath).toBe(".reliverse-hooks");
    expect(inspection.ok).toBe(true);
  });

  test("migrates only the exact generated pre-package-keyed Rse Git policy", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-policy-migration-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const plan = await planReliverseHomeInit({ root, principalHandle: "operator" });
    await applyReliverseHomeInitPlan(plan);
    await writeFile(
      path.join(root, ".gitignore"),
      RELIVERSE_HOME_GITIGNORE_LEGACY_RSE_CONFIG_V0,
    );
    await writeFile(
      path.join(root, ".reliverse-hooks", "pre-commit"),
      RELIVERSE_HOME_PRE_COMMIT_HOOK_LEGACY_RSE_CONFIG_V0,
    );

    await applyReliverseHomeInitPlan(plan);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(
      RELIVERSE_HOME_GITIGNORE,
    );
    expect(await readFile(path.join(root, ".reliverse-hooks", "pre-commit"), "utf8")).toBe(
      RELIVERSE_HOME_PRE_COMMIT_HOOK,
    );
  });

  test("refuses unknown edits to a generated Home Git policy file", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-policy-conflict-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const plan = await planReliverseHomeInit({ root, principalHandle: "operator" });
    await applyReliverseHomeInitPlan(plan);
    await writeFile(path.join(root, ".gitignore"), "# user-authored change\n");

    await expect(applyReliverseHomeInitPlan(plan)).rejects.toThrow(
      "RELIVERSE_HOME_FILE_CONFLICT",
    );
  });

  test("rejects force-staged runtime paths through the managed hook", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-guard-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const plan = await planReliverseHomeInit({ root, principalHandle: "operator" });
    await applyReliverseHomeInitPlan(plan);
    await initializeReliverseHomeGit(root);
    await mkdir(path.join(root, "rse", "state"), { recursive: true });
    await writeFile(path.join(root, "rse", "state", "unsafe.json"), "{}\n");
    expect((await run(["git", "add", "-f", "rse/state/unsafe.json"], root)).exitCode).toBe(0);
    const guarded = await run(["sh", ".reliverse-hooks/pre-commit"], root);
    expect(guarded.exitCode).toBe(1);
    expect(guarded.stderr).toContain("RELIVERSE_HOME_GIT_PATH_DENIED: rse/state/unsafe.json");
  });

  test("reports a missing home without creating it", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "reliverse-home-missing-"));
    roots.push(parent);
    const root = path.join(parent, ".reliverse");
    const inspection = await inspectReliverseHome(root);
    expect(inspection.exists).toBe(false);
    expect(inspection.diagnostics[0]?.code).toBe("RELIVERSE_HOME_MISSING");
  });
});
