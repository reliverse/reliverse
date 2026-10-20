import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveGrDurablePrivatePath } from "./private-root";
import {
  beginGrWorkTurn,
  finishGrWorkTurn,
  inspectGrWorkTurn,
  supersedeGrWorkTurn,
  summarizeGrWorkTurn,
  previewGrWorkTurnRecovery,
  recoverInterruptedGrWorkTurn,
} from "./work-turn";
const effects = ["filesystem.read", "git.read", "git.write", "artifact.write"] as const;
const roots: string[] = [];
async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(
    [
      "git",
      "--no-pager",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { cwd: root, env: { ...process.env, GIT_EDITOR: "true" }, stdout: "pipe", stderr: "pipe" },
  );
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code) throw Error(err);
  return out;
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-two-zed-"));
  roots.push(root);
  await git(root, "init", "-q");
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "owned.txt"), "baseline\n");
  return root;
}
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
test("external Zed actors run independently in different repositories without Rse WorkTurn, inference or Harness Session", async () => {
  const [a, b] = await Promise.all([fixture(), fixture()]);
  const turns = await Promise.all([
    beginGrWorkTurn({
      root: a,
      id: "same-local-id",
      actor: "zed-a-declared",
      scope: ["src"],
      grantedEffects: effects,
    }),
    beginGrWorkTurn({
      root: b,
      id: "same-local-id",
      actor: "zed-b-declared",
      scope: ["src"],
      grantedEffects: effects,
    }),
  ]);
  expect(turns[0]!.baseline.repository.fingerprint).not.toBe(
    turns[1]!.baseline.repository.fingerprint,
  );
  expect(turns[0]!.baseline.snapshotFingerprint).not.toBe(turns[1]!.baseline.snapshotFingerprint);
  for (const turn of turns) {
    expect(summarizeGrWorkTurn(turn)).not.toHaveProperty("principalId");
    expect(turn).not.toHaveProperty("authenticationSession");
    expect(turn).not.toHaveProperty("rseWorkTurnId");
    expect(turn).not.toHaveProperty("harnessSessionId");
  }
  await Promise.all([
    writeFile(path.join(a, "src", "owned.txt"), "only-a\n"),
    writeFile(path.join(b, "src", "owned.txt"), "only-b\n"),
  ]);
  const done = await Promise.all([
    finishGrWorkTurn({ root: a, grantedEffects: effects }),
    finishGrWorkTurn({ root: b, grantedEffects: effects }),
  ]);
  expect(done[0]!.artifacts!.manifest).not.toBe(done[1]!.artifacts!.manifest);
  expect(done[0]!.artifacts!.patchFingerprint).not.toBe(done[1]!.artifacts!.patchFingerprint);
  expect(await readFile(done[0]!.artifacts!.forward, "utf8")).not.toContain("only-b");
  expect(await readFile(done[1]!.artifacts!.reverse, "utf8")).not.toContain("only-a");
});
test("a second writer in one repository is refused, including concurrent begin", async () => {
  const root = await fixture();
  const results = await Promise.allSettled([
    beginGrWorkTurn({ root, id: "zed-a", actor: "a", grantedEffects: effects }),
    beginGrWorkTurn({ root, id: "zed-b", actor: "b", grantedEffects: effects }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))!.state).toBe("active");
});
test("retained interrupted mutation lock permits inspection but is never stolen", async () => {
  const root = await fixture();
  const turn = await beginGrWorkTurn({
    root,
    id: "interrupted",
    actor: "declared-owner",
    grantedEffects: effects,
  });
  const storage = await resolveGrDurablePrivatePath(root, ["work-turns"]),
    lock = path.join(storage, "mutation.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "retained.txt"), "do not steal\n");
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))!.id).toBe(turn.id);
  await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow("locked");
  expect(await readFile(path.join(lock, "retained.txt"), "utf8")).toBe("do not steal\n");
});
test("HEAD drift and staged-index drift refuse finish without rewriting begin history", async () => {
  for (const mode of ["head", "index"] as const) {
    const root = await fixture();
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "baseline");
    const turn = await beginGrWorkTurn({
      root,
      id: mode,
      actor: "declared",
      scope: ["src"],
      grantedEffects: effects,
    });
    const begin = await resolveGrDurablePrivatePath(root, ["work-turns", turn.id, "begin.json"]),
      bytes = await readFile(begin);
    await writeFile(path.join(root, "src", "owned.txt"), "drift\n");
    await git(root, "add", "src/owned.txt");
    if (mode === "head") await git(root, "commit", "-qm", "other writer");
    await expect(finishGrWorkTurn({ root, grantedEffects: effects })).rejects.toThrow(
      "HEAD or real index changed",
    );
    expect(await readFile(begin)).toEqual(bytes);
    expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))!.state).toBe("active");
  }
});
test("same-HEAD dirty-index interruption cannot borrow accepted-HEAD supersession", async () => {
  const root = await fixture();
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "baseline");
  await beginGrWorkTurn({
    root,
    id: "old-writer",
    actor: "stopped-declared-writer",
    grantedEffects: effects,
  });
  await writeFile(path.join(root, "src", "owned.txt"), "staged work\n");
  await git(root, "add", "src/owned.txt");
  const index = await readFile(path.join(root, ".git", "index"));
  await expect(
    supersedeGrWorkTurn({
      root,
      acceptedHead: true,
      rationale: "Fixture stopped writer",
      grantedEffects: effects,
    }),
  ).rejects.toThrow("real index");
  expect(await readFile(path.join(root, ".git", "index"))).toEqual(index);
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))!.state).toBe("active");
});
test("interrupted recovery preserves dirty index and original history with exact retry", async () => {
  const root = await fixture();
  const turn = await beginGrWorkTurn({
    root,
    id: "stopped",
    actor: "original",
    grantedEffects: effects,
  });
  const beginPath = await resolveGrDurablePrivatePath(root, ["work-turns", turn.id, "begin.json"]);
  const beginBytes = await readFile(beginPath);
  await writeFile(path.join(root, "src", "owned.txt"), "staged interrupted work\n");
  await git(root, "add", "src/owned.txt");
  const indexBytes = await readFile(path.join(root, ".git", "index"));
  const preview = await previewGrWorkTurnRecovery({ root, grantedEffects: effects });
  const options = {
    root,
    grantedEffects: effects,
    workTurnId: turn.id,
    turnFingerprint: preview.turnFingerprint,
    observedFingerprint: preview.observed.snapshotFingerprint,
    writerStopped: true as const,
    actor: "recovering-declared",
    rationale: "Previous writer was stopped.",
  };
  await expect(
    recoverInterruptedGrWorkTurn({ ...options, writerStopped: false as unknown as true }),
  ).rejects.toThrow("stopped-writer");
  const lock = await resolveGrDurablePrivatePath(root, ["work-turns", "mutation.lock"]);
  await mkdir(lock);
  await expect(recoverInterruptedGrWorkTurn(options)).rejects.toThrow("locked");
  await rm(lock, { recursive: true });
  const recovered = await recoverInterruptedGrWorkTurn(options);
  expect(recovered.state).toBe("superseded");
  expect(recovered.baseline).toEqual(turn.baseline);
  expect(recovered.actor).toBe("original");
  expect(recovered.artifacts).toBeUndefined();
  expect(recovered.result).toBeUndefined();
  expect(recovered.supersession).toBeUndefined();
  expect(await readFile(beginPath)).toEqual(beginBytes);
  expect(await readFile(path.join(root, ".git", "index"))).toEqual(indexBytes);
  expect(await recoverInterruptedGrWorkTurn(options)).toEqual(recovered);
  await expect(recoverInterruptedGrWorkTurn({ ...options, actor: "another" })).rejects.toThrow(
    "retry",
  );
  const successor = await beginGrWorkTurn({
    root,
    id: "successor",
    actor: "recovering-declared",
    grantedEffects: effects,
  });
  expect(successor.baseline.indexTree).toEqual(preview.observed.indexTree);
  expect((await finishGrWorkTurn({ root, grantedEffects: effects })).artifacts?.changedPaths).toBe(
    0,
  );
});

test("recovery rejects workspace drift and turn drift without retiring evidence", async () => {
  const root = await fixture();
  await beginGrWorkTurn({ root, id: "drift", actor: "original", grantedEffects: effects });
  const preview = await previewGrWorkTurnRecovery({ root, grantedEffects: effects });
  const options = {
    root,
    grantedEffects: effects,
    workTurnId: preview.workTurnId,
    turnFingerprint: preview.turnFingerprint,
    observedFingerprint: preview.observed.snapshotFingerprint,
    writerStopped: true as const,
    actor: "recovering",
    rationale: "Stopped.",
  };
  await expect(
    recoverInterruptedGrWorkTurn({ ...options, turnFingerprint: "wrong" }),
  ).rejects.toThrow("changed since");
  await writeFile(path.join(root, "src", "owned.txt"), "new drift\n");
  await expect(recoverInterruptedGrWorkTurn(options)).rejects.toThrow("changed since");
  expect((await inspectGrWorkTurn({ root, grantedEffects: effects }))?.state).toBe("active");
});

test("portable patches round-trip additions, deletions, renames and binary bytes without mixing manifests", async () => {
  const root = await fixture(),
    before = new Uint8Array([0, 255, 1, 2, 0, 99]);
  await writeFile(path.join(root, "src", "deleted.txt"), "delete me\n");
  await writeFile(path.join(root, "src", "binary.bin"), before);
  await beginGrWorkTurn({
    root,
    id: "file-edges",
    actor: "external-zed",
    scope: ["src"],
    grantedEffects: effects,
  });
  await rename(path.join(root, "src", "owned.txt"), path.join(root, "src", "renamed.txt"));
  await rm(path.join(root, "src", "deleted.txt"));
  await writeFile(path.join(root, "src", "added.txt"), "added\n");
  const after = new Uint8Array([0, 254, 2, 0, 101, 255]);
  await writeFile(path.join(root, "src", "binary.bin"), after);
  const done = await finishGrWorkTurn({ root, grantedEffects: effects });
  const manifest = JSON.parse(await readFile(done.artifacts!.manifest, "utf8"));
  expect(manifest.id).toBe("file-edges");
  expect(manifest.attribution).toBe("cooperative-single-writer");
  expect(await readFile(done.artifacts!.forward, "utf8")).toContain("GIT binary patch");
  await git(root, "apply", done.artifacts!.reverse);
  expect(new Uint8Array(await readFile(path.join(root, "src", "binary.bin")))).toEqual(before);
  expect(await readFile(path.join(root, "src", "owned.txt"), "utf8")).toBe("baseline\n");
  expect(await readFile(path.join(root, "src", "deleted.txt"), "utf8")).toBe("delete me\n");
  await git(root, "apply", done.artifacts!.forward);
  expect(new Uint8Array(await readFile(path.join(root, "src", "binary.bin")))).toEqual(after);
  expect(await readFile(path.join(root, "src", "renamed.txt"), "utf8")).toBe("baseline\n");
});
