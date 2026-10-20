import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runRequiredGrGit } from "./git";
import { resolveGrDurablePrivatePath } from "./private-root";
import {
  beginGrWorkTurn,
  extendGrWorkTurnScope,
  finishGrWorkTurn,
  inspectGrWorkTurn,
  previewGrWorkTurnIndexReconciliation,
  reconcileGrWorkTurnIndex,
} from "./work-turn";

const effects = ["filesystem.read", "git.read", "git.write", "artifact.write"] as const;
const roots: string[] = [];
async function git(root: string, ...args: string[]) {
  return runRequiredGrGit(
    root,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { env: { GIT_EDITOR: "true" } },
  );
}
async function fixture(committed = true) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-index-event-"));
  roots.push(root);
  await git(root, "init", "-q");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await writeFile(path.join(root, "src/owned.txt"), "base\n");
  if (committed) {
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "base");
  }
  return root;
}
async function previewOptions(root: string) {
  const p = await previewGrWorkTurnIndexReconciliation({ root, grantedEffects: effects });
  return {
    root,
    grantedEffects: effects,
    workTurnId: p.workTurnId,
    turnFingerprint: p.turnFingerprint,
    observedFingerprint: p.observed.snapshotFingerprint,
    actor: "writer",
    rationale: "Owner confirmed accidental Zed Stage All.",
    indexChangeConfirmed: true as const,
  };
}
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

test("confirmed Stage All preserves partial staged/dirty baseline, index bytes, begin history and original WT delta", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "src/owned.txt"), "owner staged\n");
  await git(root, "add", "src/owned.txt");
  await writeFile(path.join(root, "src/owned.txt"), "owner dirty\n");
  const turn = await beginGrWorkTurn({
    root,
    id: "ongoing",
    actor: "writer",
    scope: ["src"],
    grantedEffects: effects,
  });
  const begin = await resolveGrDurablePrivatePath(root, ["work-turns", turn.id, "begin.json"]),
    originalBegin = await readFile(begin);
  await writeFile(path.join(root, "src/owned.txt"), "owner dirty\nagent change\n");
  await writeFile(path.join(root, "src/binary.bin"), Buffer.from([0, 255, 1, 4]));
  await git(root, "add", "-A");
  const originalIndex = await readFile(path.join(root, ".git/index"));
  const head = await git(root, "rev-parse", "HEAD");
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow("real index");
  const options = await previewOptions(root);
  const result = await reconcileGrWorkTurnIndex(options);
  expect(result.turn.baseline).toEqual(turn.baseline);
  expect(result.turn.state).toBe("active");
  expect(await reconcileGrWorkTurnIndex(options)).toEqual(result);
  await expect(
    reconcileGrWorkTurnIndex({ ...options, rationale: "different intent" }),
  ).rejects.toThrow("retry");
  expect(await readFile(begin)).toEqual(originalBegin);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(originalIndex);
  expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(2);
  const patch = await readFile(done.artifacts!.forward, "utf8");
  expect(patch).toContain("+agent change");
  expect(patch).not.toContain("+owner dirty");
  expect(patch).toContain("GIT binary patch");
  expect(
    JSON.parse(await readFile(done.artifacts!.manifest, "utf8")).indexReconciliations,
  ).toHaveLength(1);
});

test("index acknowledgment does not expand source scope", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "scope-ack-only",
    actor: "writer",
    scope: ["src"],
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "outside.txt"), "other owner work\n");
  await git(root, "add", "-A");
  await reconcileGrWorkTurnIndex(await previewOptions(root));
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(0);
  expect(await readFile(done.artifacts!.forward, "utf8")).not.toContain("outside.txt");
  expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe("other owner work\n");
});

test("explicit scope extension captures reviewed out-of-scope changes", async () => {
  const root = await fixture();
  await beginGrWorkTurn({
    root,
    id: "scope-extension",
    actor: "writer",
    scope: ["src"],
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "outside.txt"), "other owner work\n");
  await git(root, "add", "-A");
  await reconcileGrWorkTurnIndex(await previewOptions(root));
  await extendGrWorkTurnScope({
    root,
    paths: ["outside.txt"],
    rationale: "Explicit owner scope addition.",
    grantedEffects: effects,
  });
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  expect(done.artifacts?.changedPaths).toBe(1);
  expect(await readFile(done.artifacts!.forward, "utf8")).toContain("outside.txt");
});

test("later staging is rejected until a new pinned acknowledgment; earlier receipts remain intact", async () => {
  const root = await fixture();
  const initial = await beginGrWorkTurn({
    root,
    id: "repeat",
    actor: "writer",
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "src/owned.txt"), "first\n");
  await git(root, "add", "-A");
  const firstOptions = await previewOptions(root),
    first = await reconcileGrWorkTurnIndex(firstOptions);
  await writeFile(path.join(root, "src/owned.txt"), "second\n");
  await git(root, "add", "-A");
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow("real index");
  await expect(reconcileGrWorkTurnIndex(firstOptions)).rejects.toThrow("observation changed");
  const second = await reconcileGrWorkTurnIndex(await previewOptions(root));
  expect(second.turn.indexReconciliations).toHaveLength(2);
  expect(second.turn.indexReconciliations?.[0]).toEqual(first.receipt);
  expect(second.receipt.previousIndexTree).toBe(first.receipt.observed.indexTree.oid);
  expect(second.turn.baseline).toEqual(initial.baseline);
});

test("preview pins refuse worktree/index drift, another actor, missing confirmation and cross-repository replay", async () => {
  const root = await fixture(),
    other = await fixture();
  for (const r of [root, other]) {
    await beginGrWorkTurn({ root: r, id: "same-id", actor: "writer", grantedEffects: effects });
    await writeFile(path.join(r, "src/owned.txt"), "staged\n");
    await git(r, "add", "-A");
  }
  const options = await previewOptions(root);
  await expect(reconcileGrWorkTurnIndex({ ...options, actor: "other" })).rejects.toThrow(
    "declared writer",
  );
  await expect(
    reconcileGrWorkTurnIndex({ ...options, indexChangeConfirmed: false as unknown as true }),
  ).rejects.toThrow("confirmed");
  await expect(reconcileGrWorkTurnIndex({ ...options, root: other })).rejects.toThrow("stale");
  await writeFile(path.join(root, "src/owned.txt"), "new worktree bytes\n");
  await expect(reconcileGrWorkTurnIndex(options)).rejects.toThrow("stale");
  expect(
    (await inspectGrWorkTurn({ root, grantedEffects: effects }))?.indexReconciliations,
  ).toBeUndefined();
});

test("HEAD drift and retained mutation locks cannot be acknowledged as staging", async () => {
  const root = await fixture();
  await beginGrWorkTurn({ root, id: "locked", actor: "writer", grantedEffects: effects });
  await writeFile(path.join(root, "src/owned.txt"), "staged\n");
  await git(root, "add", "-A");
  const options = await previewOptions(root),
    lock = await resolveGrDurablePrivatePath(root, ["work-turns", "mutation.lock"]);
  await mkdir(lock);
  await expect(reconcileGrWorkTurnIndex(options)).rejects.toThrow("locked");
  await rm(lock, { recursive: true });
  await git(root, "commit", "-qm", "different HEAD");
  await expect(previewOptions(root)).rejects.toThrow("HEAD drift");
  await expect(reconcileGrWorkTurnIndex(options)).rejects.toThrow("HEAD drift");
});

test("unborn repository staging reconciliation preserves unborn HEAD", async () => {
  const root = await fixture(false);
  await beginGrWorkTurn({ root, id: "unborn", actor: "writer", grantedEffects: effects });
  await writeFile(path.join(root, "src/owned.txt"), "unborn work\n");
  await git(root, "add", "-A");
  const result = await reconcileGrWorkTurnIndex(await previewOptions(root));
  expect(result.turn.baseline.head.commit).toBeUndefined();
  expect((await finishGrWorkTurn({ root, grantedEffects: effects })).artifacts?.changedPaths).toBe(
    1,
  );
});

test("turn-history drift invalidates a preview and receipt-chain tampering is rejected", async () => {
  const root = await fixture();
  await beginGrWorkTurn({ root, id: "history", actor: "writer", grantedEffects: effects });
  await expect(previewOptions(root)).rejects.toThrow("No unacknowledged index change");
  await writeFile(path.join(root, "src/owned.txt"), "history change\n");
  await git(root, "add", "-A");
  const options = await previewOptions(root);
  const current = await resolveGrDurablePrivatePath(root, ["work-turns", "current.json"]);
  const turn = JSON.parse(await readFile(current, "utf8"));
  turn.scope = ["src"];
  await writeFile(current, JSON.stringify(turn));
  await expect(reconcileGrWorkTurnIndex(options)).rejects.toThrow("stale");
  const reconciled = await reconcileGrWorkTurnIndex(await previewOptions(root));
  const corrupted = JSON.parse(JSON.stringify(reconciled.turn));
  corrupted.indexReconciliations[0].previousIndexTree = "invalid-index";
  await writeFile(current, JSON.stringify(corrupted));
  await expect(inspectGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow(
    "index-reconciliation receipt",
  );
});

test("source CLI previews and applies only exact confirmed pins, without changing real index", async () => {
  const root = await fixture();
  await beginGrWorkTurn({ root, id: "cli", actor: "writer", grantedEffects: effects });
  await writeFile(path.join(root, "src/owned.txt"), "cli change\n");
  await git(root, "add", "-A");
  const index = await readFile(path.join(root, ".git/index"));
  async function invoke(args: string[]) {
    const cli = path.resolve(import.meta.dir, "../../../apps/cli/gr/src/cli.ts");
    const child = Bun.spawn(
      [process.execPath, cli, "wt", "reconcile-index", "--root", root, "--json", ...args],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  }
  const preview = await invoke([]);
  expect(preview.code, preview.stderr).toBe(0);
  const p = JSON.parse(preview.stdout).data;
  expect((await invoke(["--apply"])).code).toBe(2);
  const applied = await invoke([
    "--apply",
    "--index-change-confirmed",
    "--actor",
    "writer",
    "--rationale",
    "Owner confirmed Stage All.",
    "--work-turn-id",
    p.workTurnId,
    "--turn-fingerprint",
    p.turnFingerprint,
    "--observed-fingerprint",
    p.observedFingerprint,
  ]);
  expect(applied.code, applied.stdout + applied.stderr).toBe(0);
  expect(JSON.parse(applied.stdout).data.gitStateChanged).toBe(false);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
});
