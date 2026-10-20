import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectGrRepositoryVersion } from "./repository-version";
import { createGrSnapshot } from "./snapshot";
import { inspectGrTransitionState } from "./transition-state";
import { finalizeGrVersionedPatch } from "./versioned-patch";

const roots: string[] = [];
const snapshotEffects = ["filesystem.read", "git.read", "git.write"] as const;
const finalizeEffects = [
  "artifact.write",
  "filesystem.read",
  "filesystem.write",
  "git.read",
  "git.write",
] as const;

async function git(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", "-c", "color.ui=false", ...args], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, Bun.readableStreamToText(child.stderr)]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

async function fixture(version = "0.0.168"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gr-versioned-patch-"));
  roots.push(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "gr@reliverse.local"]);
  await git(root, ["config", "user.name", "GR Fixture"]);
  await writeFile(path.join(root, ".gitignore"), "/.private/\n");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "@repo/reliverse-root", version, private: true }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "tracked.txt"), "before\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "baseline"]);
  return root;
}

async function baseline(root: string) {
  return createGrSnapshot({
    root,
    role: "baseline",
    dirtyPolicy: "reject",
    grantedEffects: snapshotEffects,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GR private transition chronology v0", () => {
  test("seeds private chronology from the legacy root semver patch without mutating package.json", async () => {
    const root = await fixture();
    const before = await baseline(root);
    await writeFile(path.join(root, "tracked.txt"), "after\n");

    const result = await finalizeGrVersionedPatch(root, before, {
      grantedEffects: finalizeEffects,
    });

    expect(result.transition).toEqual({
      schemaVersion: "gr.transition.v0",
      sequence: 169,
      transitionId: "grt_000000169",
      repository: {
        packageName: "@repo/reliverse-root",
        artifactName: "reliverse",
        version: "0.0.168",
      },
    });
    expect(
      await inspectGrRepositoryVersion(root, { grantedEffects: ["filesystem.read", "git.read"] }),
    ).toMatchObject({ version: "0.0.168", artifactName: "reliverse" });
    expect(path.basename(result.artifacts.files.changesPatch ?? "")).toBe(
      "reliverse-grt_000000169.patch",
    );
    const patch = await readFile(result.artifacts.files.changesPatch!, "utf8");
    expect(patch).not.toContain('+  "version": "0.0.169"');
    expect(patch).toContain("+after");
    expect(await inspectGrTransitionState(root, { grantedEffects: ["filesystem.read"] })).toEqual({
      schemaVersion: "gr.transition-state.v0",
      repository: { packageName: "@repo/reliverse-root", artifactName: "reliverse" },
      lastSequence: 169,
      initializedFrom: { kind: "legacy-root-semver-patch", version: "0.0.168" },
    });
  });

  test("advances private chronology while repository semver stays stable", async () => {
    const root = await fixture();
    let before = await baseline(root);
    await writeFile(path.join(root, "tracked.txt"), "after-one\n");
    const first = await finalizeGrVersionedPatch(root, before, { grantedEffects: finalizeEffects });
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-qm", "first transition"]);

    before = await baseline(root);
    await writeFile(path.join(root, "tracked.txt"), "after-two\n");
    const second = await finalizeGrVersionedPatch(root, before, {
      grantedEffects: finalizeEffects,
    });

    expect(first.transition.transitionId).toBe("grt_000000169");
    expect(second.transition.transitionId).toBe("grt_000000170");
    expect(second.transition.repository.version).toBe("0.0.168");
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version).toBe(
      "0.0.168",
    );
  });

  test("fails closed when public repository version changes after the baseline", async () => {
    const root = await fixture();
    const before = await baseline(root);
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "@repo/reliverse-root", version: "0.1.0", private: true }, null, 2)}\n`,
    );
    await expect(
      finalizeGrVersionedPatch(root, before, { grantedEffects: finalizeEffects }),
    ).rejects.toMatchObject({ code: "GR_STALE_STATE" });
  });

  test("does not advance private transition state when artifact finalization collides", async () => {
    const root = await fixture();
    const before = await baseline(root);
    await writeFile(path.join(root, "tracked.txt"), "after\n");
    const collision = path.join(root, ".private/reliverse/gr/transitions/reliverse-grt_000000169");
    await mkdir(collision, { recursive: true });

    await expect(
      finalizeGrVersionedPatch(root, before, { grantedEffects: finalizeEffects }),
    ).rejects.toMatchObject({ code: "GR_ARTIFACT_EXISTS" });
    expect(
      await inspectGrTransitionState(root, { grantedEffects: ["filesystem.read"] }),
    ).toBeNull();
    expect(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version).toBe(
      "0.0.168",
    );
  });
});
