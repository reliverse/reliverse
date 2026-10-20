import { afterAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderFileStage } from "@reliverse/rse-handoff/files";

import {
  beginGrWorkTurn,
  extendGrWorkTurnScope,
  finishGrWorkTurn,
  inspectGrWorkTurn,
  previewGrWorkTurnScopeExtension,
  summarizeGrWorkTurn,
  createGrSnapshot,
  supersedeGrWorkTurn,
} from "./index";
const roots: string[] = [];
const effects = ["filesystem.read", "git.read", "git.write", "artifact.write"] as const;
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code) throw new Error(err);
  return out;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-wt-test-"));
  roots.push(root);
  await git(root, "init", "-q");
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await writeFile(path.join(root, "owned.txt"), "preexisting dirty bytes\n");
  return root;
}
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
test("dirty baseline excludes existing dirt and preserves real index; completed patches roundtrip", async () => {
  const root = await fixture();
  await git(root, "add", ".gitignore");
  const index = await readFile(path.join(root, ".git/index"));
  const begin = await beginGrWorkTurn({
    root,
    id: "test-wt1",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await expect(
    beginGrWorkTurn({ root, id: "test-wt2", actor: "fixture", grantedEffects: effects }),
  ).rejects.toThrow("already active");
  await writeFile(path.join(root, "owned.txt"), "new work turn bytes\n");
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(1);
  expect(done.baseline.snapshotId).toBe(begin.baseline.snapshotId);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  const forward = await readFile(done.artifacts!.forward, "utf8");
  expect(forward).toContain("-preexisting dirty bytes");
  expect(forward).not.toContain("diff --git a/.gitignore");
  await git(root, "apply", done.artifacts!.reverse);
  expect(await readFile(path.join(root, "owned.txt"), "utf8")).toBe("preexisting dirty bytes\n");
  await git(root, "apply", done.artifacts!.forward);
  expect(await readFile(path.join(root, "owned.txt"), "utf8")).toBe("new work turn bytes\n");
  expect(await finishGrWorkTurn({ root, grantedEffects: effects })).toEqual(done);
});
test("finish captures only owned changes and leaves unrelated dirt untouched", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "test-wt1",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "owned.txt"), "owned update\n");
  await writeFile(path.join(root, "outside.txt"), "other writer\n");
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(1);
  const forward = await readFile(done.artifacts!.forward, "utf8");
  expect(forward).toContain("diff --git a/owned.txt b/owned.txt");
  expect(forward).not.toContain("outside.txt");
  expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe("other writer\n");
});

test("rename and copy changes cannot cross a Work Turn scope boundary", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "test-wt-cross-scope-move",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await rename(path.join(root, "owned.txt"), path.join(root, "outside.txt"));
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow(
    "crossing its declared scope",
  );
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))?.state).toBe("active");
});

test("index changes still fail closed and keep active evidence", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "test-wt-index-change",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await git(root, "add", "owned.txt");
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow(
    "index changed",
  );
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))?.state).toBe("active");
});
test("scope extension is previewable, append-only, exact-path-bound, and auditable", async () => {
  const root = await fixture();
  const begin = await beginGrWorkTurn({
    root,
    id: "scope-extension-wt",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "owned.txt"), "owned change\\n");
  await writeFile(path.join(root, "outside.txt"), "additional observed change\\n");
  const plan = await previewGrWorkTurnScopeExtension({
    root,
    paths: ["outside.txt"],
    rationale: "Include the reviewed evidence path discovered during this Work Turn.",
    grantedEffects: effects,
  });
  expect(plan).toMatchObject({
    workTurnId: begin.id,
    currentScope: ["owned.txt"],
    addedPaths: ["outside.txt"],
  });
  const result = await extendGrWorkTurnScope({
    root,
    paths: ["outside.txt"],
    rationale: plan.rationale,
    grantedEffects: effects,
  });
  expect(result.turn.scope).toEqual(["outside.txt", "owned.txt"]);
  expect(result.turn.scopeExtensions).toEqual([result.extension]);
  expect(summarizeGrWorkTurn(result.turn).scopeExtensions).toEqual([
    expect.objectContaining({ id: result.extension.id, addedPaths: ["outside.txt"] }),
  ]);
  expect(
    await readFile(
      path.join(
        root,
        ".private",
        "reliverse",
        "gr",
        "work-turns",
        begin.id,
        `${result.extension.id}.json`,
      ),
      "utf8",
    ),
  ).toContain(result.extension.observedSnapshotId);
  const retried = await extendGrWorkTurnScope({
    root,
    paths: ["outside.txt"],
    rationale: plan.rationale,
    grantedEffects: effects,
  });
  expect(retried.extension).toEqual(result.extension);
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(2);
});

test("scope extension refuses paths not changed since baseline and private paths", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "scope-extension-invalid-wt",
    actor: "fixture",
    scope: ["owned.txt"],
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "outside.txt"), "observed\\n");
  await expect(
    previewGrWorkTurnScopeExtension({
      root,
      paths: ["not-changed.txt"],
      rationale: "Must not add an unchanged path.",
      grantedEffects: effects,
    }),
  ).rejects.toThrow("exact paths changed since baseline");
  await expect(
    previewGrWorkTurnScopeExtension({
      root,
      paths: [".private/secret.json"],
      rationale: "Private paths must remain excluded.",
      grantedEffects: effects,
    }),
  ).rejects.toThrow("Private paths");
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))?.scope).toEqual([
    "owned.txt",
  ]);
});

test("workspace-scoped turns cannot be accidentally narrowed by a scope extension", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "workspace-scope-wt",
    actor: "fixture",
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "outside.txt"), "workspace-wide change\\n");
  await expect(
    previewGrWorkTurnScopeExtension({
      root,
      paths: ["outside.txt"],
      rationale: "Workspace scope already includes this path.",
      grantedEffects: effects,
    }),
  ).rejects.toThrow("already covers every public path");
});

test("bootstrap baseline and optional global stage binding are explicit", async () => {
  const root = await fixture();
  const gh = await fixture();
  await mkdir(path.join(gh, "stages"), { recursive: true });
  await mkdir(path.join(gh, ".config"), { recursive: true });
  await writeFile(
    path.join(gh, ".config", "handoff.json"),
    JSON.stringify({
      global: true,
      scope: "global",
      handoffId: "fixture",
      lifecycle: "linear",
    }),
  );
  await writeFile(
    path.join(gh, "stages", "decomposition.md"),
    renderFileStage({
      id: "decomposition",
      header: { status: "active", sequence: 1 },
      body: "A global coordination task.\n",
    }),
  );
  const baseline = await createGrSnapshot({
    root,
    role: "baseline",
    dirtyPolicy: "capture",
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "owned.txt"), "bootstrap\n");
  const turn = await beginGrWorkTurn({
    root,
    id: "test-wt1",
    actor: "fixture",
    baseline,
    handoffRoot: gh,
    grantedEffects: effects,
  });
  expect(turn.handoff).toMatchObject({
    global: true,
    handoffId: "fixture",
    stageId: "decomposition",
    stageOrder: 1,
  });
  expect((await finishGrWorkTurn({ root, grantedEffects: effects })).artifacts?.changedPaths).toBe(
    1,
  );
  await expect(
    beginGrWorkTurn({ root: gh, id: "test", actor: "fixture", baseline, grantedEffects: effects }),
  ).rejects.toThrow("this repository");
});
test("missing grants, unsafe IDs and private scopes are refused", async () => {
  const root = await fixture();
  await expect(beginGrWorkTurn({ root, id: "x", actor: "a" })).rejects.toMatchObject({
    code: "GR_NOT_AUTHORIZED",
  });
  await expect(
    beginGrWorkTurn({ root, id: "../x", actor: "a", grantedEffects: effects }),
  ).rejects.toThrow();
  await expect(
    beginGrWorkTurn({ root, id: "x", actor: "a", scope: [".private"], grantedEffects: effects }),
  ).rejects.toThrow("Private paths");
});

test("supersedes a stale turn at a descendant accepted HEAD and starts clean recovery evidence", async () => {
  const root = await fixture();
  await git(root, "config", "user.email", "fixture@example.com");
  await git(root, "config", "user.name", "Fixture");
  await git(root, "add", ".gitignore", "owned.txt");
  await git(root, "commit", "-qm", "initial");
  await beginGrWorkTurn({ root, id: "stale-wt", actor: "fixture", grantedEffects: effects });
  await writeFile(path.join(root, "accepted.txt"), "accepted upstream\n");
  await git(root, "add", "accepted.txt");
  await git(root, "commit", "-qm", "accepted head advances");
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow(
    "HEAD or real index changed",
  );

  const stale = await supersedeGrWorkTurn({
    root,
    acceptedHead: true,
    rationale: "The descendant commit is the accepted coordination baseline.",
    grantedEffects: effects,
  });
  expect(stale.state).toBe("superseded");
  expect(stale.supersession?.acceptedBaseline.origin.kind).toBe("accepted-revision");

  const recovery = await beginGrWorkTurn({
    root,
    id: "recovery-wt",
    actor: "fixture",
    acceptedHead: true,
    grantedEffects: effects,
  });
  expect(recovery.baseline.origin.kind).toBe("accepted-revision");
  await writeFile(path.join(root, "owned.txt"), "recovery work\n");
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  const forward = await readFile(done.artifacts!.forward, "utf8");
  expect(forward).toContain("recovery work");
  expect(forward).not.toContain("accepted upstream");
});
