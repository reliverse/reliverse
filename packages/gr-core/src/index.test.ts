import { afterAll, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGrPatch,
  createGrRecoveryCapsule,
  createGrSnapshot,
  diffGrSnapshots,
  fingerprintGrJson,
  inspectGrWorkspace,
  materializeGrPatch,
  materializeGrRecoveryCapsule,
  materializeGrRestoreReceipt,
  materializeGrSnapshot,
  parseGrPatch,
  parseGrRestoreReceipt,
  restoreGrRecoveryCapsule,
} from "./index";

const roots = new Set<string>();
const gitReadEffects = ["filesystem.read", "git.read"] as const;
const snapshotEffects = ["filesystem.read", "git.read", "git.write"] as const;
const restoreEffects = ["filesystem.read", "filesystem.write", "git.read", "git.write"] as const;

async function git(root: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["git", "-c", "color.ui=false", "-c", "core.pager=cat", ...args], {
    cwd: root,
    env: { ...globalThis.process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", PAGER: "cat" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    Bun.readableStreamToText(process.stdout),
    Bun.readableStreamToText(process.stderr),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reliverse-gr-fixture-"));
  roots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "gr-fixture@reliverse.local"]);
  await git(root, ["config", "user.name", "GR Fixture"]);
  await Promise.all([
    writeFile(path.join(root, ".gitignore"), "/.private/\n"),
    writeFile(path.join(root, "tracked.txt"), "before\n"),
    writeFile(path.join(root, "rename-me.txt"), "rename content\n"),
    writeFile(path.join(root, "script.sh"), "#!/bin/sh\necho fixture\n"),
  ]);
  await chmod(path.join(root, "script.sh"), 0o644);
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "Initialize fixture"]);
  return root;
}

async function indexBytes(root: string): Promise<Uint8Array> {
  const indexPath = (await git(root, ["rev-parse", "--git-path", "index"])).trim();
  return readFile(path.resolve(root, indexPath));
}

afterAll(async () => {
  await Promise.all([...roots].map((root) => rm(root, { force: true, recursive: true })));
});

describe("GR Git workspace foundation", () => {
  test("path-scoped baseline tolerates an absent new file and captures its later creation", async () => {
    const root = await createRepository();
    const beforeIndex = await indexBytes(root);
    const target = "new/proof.txt";
    await mkdir(path.join(root, "new"));
    const baseline = await createGrSnapshot({
      root,
      role: "baseline",
      scope: { kind: "paths", paths: [target] },
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    expect(await indexBytes(root)).toEqual(beforeIndex);
    await writeFile(path.join(root, target), "proof");
    const result = await createGrSnapshot({
      root,
      role: "result",
      scope: baseline.scope,
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    const patch = await createGrPatch(baseline, result, { grantedEffects: ["git.read"] });
    expect(patch.diff.files.map((file) => file.path)).toEqual([target]);
    expect(await indexBytes(root)).toEqual(beforeIndex);
  });

  test("path-scoped baseline still stages deletion of a tracked missing file", async () => {
    const root = await createRepository();
    await rm(path.join(root, "tracked.txt"));
    const snapshot = await createGrSnapshot({
      root,
      role: "baseline",
      scope: { kind: "paths", paths: ["tracked.txt"] },
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    expect(snapshot.worktreeTree.oid).not.toBe(snapshot.indexTree.oid);
  });
  test("inspects staged, unstaged, and untracked state with explicit grants", async () => {
    const root = await createRepository();
    await expect(inspectGrWorkspace(root)).rejects.toMatchObject({ code: "GR_NOT_AUTHORIZED" });

    const clean = await inspectGrWorkspace(root, { grantedEffects: gitReadEffects });
    expect(clean.summary).toMatchObject({ dirty: false, staged: 0, unstaged: 0, untracked: 0 });
    expect(clean.head.state).toBe("attached");

    await writeFile(path.join(root, "tracked.txt"), "unstaged\n");
    await writeFile(path.join(root, "staged.txt"), "staged\n");
    await git(root, ["add", "staged.txt"]);
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");
    await mkdir(path.join(root, ".private"));
    await writeFile(path.join(root, ".private", "ignored.txt"), "ignored\n");

    const inspection = await inspectGrWorkspace(root, { grantedEffects: gitReadEffects });
    expect(inspection.summary).toMatchObject({ dirty: true, staged: 1, unstaged: 1, untracked: 1 });
    expect(inspection.entries.map((entry) => entry.path)).toEqual([
      "staged.txt",
      "tracked.txt",
      "untracked.txt",
    ]);
    expect(inspection.entries.some((entry) => entry.path.startsWith(".private/"))).toBe(false);
    await expect(
      createGrSnapshot({ root, role: "explicit", grantedEffects: snapshotEffects }),
    ).rejects.toMatchObject({
      code: "GR_WORKSPACE_DIRTY",
    });

    const beforeIndex = await indexBytes(root);
    const snapshot = await createGrSnapshot({
      root,
      role: "explicit",
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    expect(snapshot.coverage.ignored).toBe("denied");
    expect(snapshot.retention).toBe("ephemeral");
    expect(await indexBytes(root)).toEqual(beforeIndex);
  });

  test("creates exact snapshots, binary patches, recovery, and reversible restore", async () => {
    const root = await createRepository();
    const baseline = await createGrSnapshot({
      root,
      role: "baseline",
      grantedEffects: snapshotEffects,
    });
    const realIndex = await indexBytes(root);

    await writeFile(path.join(root, "tracked.txt"), "after\n");
    await rename(path.join(root, "rename-me.txt"), path.join(root, "renamed.txt"));
    await writeFile(path.join(root, "binary.bin"), new Uint8Array([0, 1, 2, 3, 255]));
    await chmod(path.join(root, "script.sh"), 0o755);

    const result = await createGrSnapshot({
      root,
      role: "result",
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    expect(await indexBytes(root)).toEqual(realIndex);

    const diff = await diffGrSnapshots(baseline, result, { grantedEffects: ["git.read"] });
    expect(diff.files.map((file) => file.path)).toEqual([
      "binary.bin",
      "renamed.txt",
      "script.sh",
      "tracked.txt",
    ]);
    expect(diff.files.find((file) => file.path === "binary.bin")?.binary).toBe(true);
    expect(diff.files.find((file) => file.path === "renamed.txt")).toMatchObject({
      kind: "rename",
      originalPath: "rename-me.txt",
    });
    expect(diff.files.find((file) => file.path === "script.sh")?.kind).toBe("mode");

    const patch = await createGrPatch(baseline, result, { grantedEffects: ["git.read"] });
    expect(patch.forward.content).toContain("GIT binary patch");
    expect(patch.reverse.content.length).toBeGreaterThan(0);
    expect(() => parseGrPatch({ ...patch, patchId: "gr-patch-tampered" })).toThrow(
      "fingerprint or ID",
    );
    const capsule = createGrRecoveryCapsule(patch);
    expect(capsule.profile).toBe("patch-only");

    const snapshotPaths = await materializeGrSnapshot(root, baseline, ["artifact.write"]);
    const patchPaths = await materializeGrPatch(root, patch, ["artifact.write"]);
    const recoveryPaths = await materializeGrRecoveryCapsule(root, capsule, ["artifact.write"]);
    expect(Bun.file(snapshotPaths.manifest).exists()).resolves.toBe(true);
    expect(Bun.file(patchPaths.files.changesPatch!).exists()).resolves.toBe(true);
    const patchManifest = JSON.parse(await readFile(patchPaths.manifest, "utf8")) as Record<
      string,
      unknown
    >;
    expect(patchManifest).toMatchObject({
      schemaVersion: "gr.patch-artifact-manifest.v0",
      artifact: { kind: "patch", id: patch.patchId, fingerprint: patch.patchFingerprint },
      files: {
        forward: { path: "changes.patch", fingerprint: patch.forward.fingerprint },
        reverse: { path: "reverse.patch", fingerprint: patch.reverse.fingerprint },
      },
    });
    expect(JSON.stringify(patchManifest)).not.toContain("GIT binary patch");
    expect(Bun.file(recoveryPaths.manifest).exists()).resolves.toBe(true);
    await expect(materializeGrPatch(root, patch, ["artifact.write"])).rejects.toMatchObject({
      code: "GR_ARTIFACT_EXISTS",
    });

    const reverseReceipt = await restoreGrRecoveryCapsule({
      root,
      capsule,
      direction: "reverse",
      authorization: { kind: "trusted-caller", source: "synthetic restore test" },
      grantedEffects: restoreEffects,
      runId: "restore-reverse-001",
      createdAt: "2026-07-24T03:00:00.000Z",
    });
    expect(reverseReceipt.status).toBe("succeeded");
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("before\n");
    expect(await readFile(path.join(root, "rename-me.txt"), "utf8")).toBe("rename content\n");
    expect(Bun.file(path.join(root, "renamed.txt")).exists()).resolves.toBe(false);
    expect(Bun.file(path.join(root, "binary.bin")).exists()).resolves.toBe(false);
    expect((await lstat(path.join(root, "script.sh"))).mode & 0o111).toBe(0);
    expect(await indexBytes(root)).toEqual(realIndex);
    expect(() =>
      parseGrRestoreReceipt({ ...reverseReceipt, createdAt: "2026-07-24T03:00:01.000Z" }),
    ).toThrow("fingerprint");
    const { receiptFingerprint: _receiptFingerprint, ...semanticReceipt } = reverseReceipt;
    const unsafeSemanticReceipt = {
      ...semanticReceipt,
      files: [{ path: "../escape", status: "restored" }],
    };
    expect(() =>
      parseGrRestoreReceipt({
        ...unsafeSemanticReceipt,
        receiptFingerprint: fingerprintGrJson(unsafeSemanticReceipt, "gr.restore-receipt.v0"),
      }),
    ).toThrow("schema");
    const receiptPaths = await materializeGrRestoreReceipt(root, reverseReceipt, [
      "artifact.write",
    ]);
    expect(Bun.file(receiptPaths.manifest).exists()).resolves.toBe(true);

    const forwardReceipt = await restoreGrRecoveryCapsule({
      root,
      capsule,
      direction: "forward",
      authorization: { kind: "trusted-caller", source: "synthetic restore test" },
      grantedEffects: restoreEffects,
      runId: "restore-forward-001",
      createdAt: "2026-07-24T03:01:00.000Z",
    });
    expect(forwardReceipt.status).toBe("succeeded");
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("after\n");
    expect(await readFile(path.join(root, "renamed.txt"), "utf8")).toBe("rename content\n");
    expect(await readFile(path.join(root, "binary.bin"))).toEqual(Buffer.from([0, 1, 2, 3, 255]));
    expect((await lstat(path.join(root, "script.sh"))).mode & 0o111).not.toBe(0);
    expect(await indexBytes(root)).toEqual(realIndex);
  });

  test("fails stale restore before mutation and requires authorization", async () => {
    const root = await createRepository();
    const baseline = await createGrSnapshot({
      root,
      role: "baseline",
      grantedEffects: snapshotEffects,
    });
    await writeFile(path.join(root, "tracked.txt"), "planned result\n");
    const result = await createGrSnapshot({
      root,
      role: "result",
      dirtyPolicy: "capture",
      grantedEffects: snapshotEffects,
    });
    const capsule = createGrRecoveryCapsule(
      await createGrPatch(baseline, result, { grantedEffects: ["git.read"] }),
    );

    await expect(
      restoreGrRecoveryCapsule({
        root,
        capsule,
        direction: "reverse",
        grantedEffects: restoreEffects,
        runId: "restore-unauthorized",
        createdAt: "2026-07-24T03:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "GR_NOT_AUTHORIZED" });

    await writeFile(path.join(root, "unrelated.txt"), "concurrent\n");
    const receipt = await restoreGrRecoveryCapsule({
      root,
      capsule,
      direction: "reverse",
      authorization: { kind: "trusted-caller", source: "synthetic stale test" },
      grantedEffects: restoreEffects,
      runId: "restore-stale-001",
      createdAt: "2026-07-24T03:03:00.000Z",
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.preflight.failure?.code).toBe("GR_STALE_STATE");
    expect(receipt.files.every((file) => file.status === "not-run")).toBe(true);
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("planned result\n");
    expect(await readFile(path.join(root, "unrelated.txt"), "utf8")).toBe("concurrent\n");
  });

  test("rejects non-repositories and symlink roots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "reliverse-gr-nonrepo-"));
    const link = `${directory}-link`;
    roots.add(directory);
    roots.add(link);
    await expect(
      inspectGrWorkspace(directory, { grantedEffects: gitReadEffects }),
    ).rejects.toMatchObject({ code: "GR_NOT_REPOSITORY" });
    await symlink(directory, link, "dir");
    await expect(
      inspectGrWorkspace(link, { grantedEffects: gitReadEffects }),
    ).rejects.toMatchObject({ code: "GR_PATH_UNSAFE" });
  });
});
