import { afterAll, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  captureGrSnapshotSandboxResult,
  cleanupGrSnapshotSandbox,
  createGrPatch,
  createGrSnapshot,
  diffGrSnapshots,
  materializeGrSnapshotSandbox,
  parseGrSandboxCleanupReceipt,
  parseGrSnapshotSandbox,
} from "./index";

const roots = new Set<string>();
const containers = new Set<string>();
const snapshotEffects = ["filesystem.read", "git.read", "git.write"] as const;
const sandboxEffects = ["filesystem.read", "filesystem.write", "git.read", "git.write"] as const;
const cleanupEffects = ["filesystem.read", "filesystem.write", "git.read"] as const;

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
  const root = await mkdtemp(path.join(tmpdir(), "reliverse-gr-sandbox-fixture-"));
  roots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "gr-sandbox@reliverse.local"]);
  await git(root, ["config", "user.name", "GR Sandbox Fixture"]);
  await Promise.all([
    writeFile(path.join(root, ".gitignore"), "/.private/\n"),
    writeFile(path.join(root, "format.ts"), "const value={answer:42}\n"),
    writeFile(path.join(root, "other.txt"), "other\n"),
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

async function liveGitIdentity(
  root: string,
): Promise<{ head: string; refs: string; index: Uint8Array }> {
  return {
    head: (await git(root, ["rev-parse", "HEAD"])).trim(),
    refs: await git(root, ["show-ref"]),
    index: await indexBytes(root),
  };
}

async function dirtyBaseline(root: string) {
  await writeFile(path.join(root, "other.txt"), "unstaged user change\n");
  await writeFile(path.join(root, "staged.txt"), "staged user change\n");
  await git(root, ["add", "staged.txt"]);
  await writeFile(path.join(root, "untracked.txt"), "untracked user change\n");
  await mkdir(path.join(root, ".private"));
  await writeFile(path.join(root, ".private", "secret.txt"), "must stay private\n");
  return await createGrSnapshot({
    root,
    role: "baseline",
    dirtyPolicy: "capture",
    grantedEffects: snapshotEffects,
  });
}

async function materialize(root: string, baseline: Awaited<ReturnType<typeof dirtyBaseline>>) {
  const sandbox = await materializeGrSnapshotSandbox({
    root,
    baseline,
    grantedEffects: sandboxEffects,
  });
  containers.add(sandbox.containerRoot);
  return sandbox;
}

afterAll(async () => {
  await Promise.all(
    [...containers, ...roots].map((target) => rm(target, { force: true, recursive: true })),
  );
});

describe("GR snapshot sandbox", () => {
  test("materializes an exact dirty baseline without changing live Git or exposing ignored files", async () => {
    const root = await createRepository();
    const baseline = await dirtyBaseline(root);
    const before = await liveGitIdentity(root);
    const liveFormat = await readFile(path.join(root, "format.ts"), "utf8");

    const sandbox = await materialize(root, baseline);
    expect(parseGrSnapshotSandbox(sandbox)).toEqual(sandbox);
    expect(await readFile(path.join(sandbox.workspaceRoot, "other.txt"), "utf8")).toBe(
      "unstaged user change\n",
    );
    expect(await readFile(path.join(sandbox.workspaceRoot, "staged.txt"), "utf8")).toBe(
      "staged user change\n",
    );
    expect(await readFile(path.join(sandbox.workspaceRoot, "untracked.txt"), "utf8")).toBe(
      "untracked user change\n",
    );
    expect(
      Bun.file(path.join(sandbox.workspaceRoot, ".private", "secret.txt")).exists(),
    ).resolves.toBe(false);
    expect(Bun.file(path.join(sandbox.workspaceRoot, ".git")).exists()).resolves.toBe(false);

    const unchanged = await captureGrSnapshotSandboxResult({
      root,
      baseline,
      sandbox,
      allowedChangedPaths: [],
      grantedEffects: sandboxEffects,
    });
    expect(unchanged.worktreeTree).toEqual(baseline.worktreeTree);
    expect(unchanged.origin).toMatchObject({
      kind: "snapshot-sandbox",
      baselineSnapshotId: baseline.snapshotId,
      materializationId: sandbox.materializationId,
    });
    expect(await liveGitIdentity(root)).toEqual(before);
    expect(await readFile(path.join(root, "format.ts"), "utf8")).toBe(liveFormat);
  });

  test("captures only an allowed formatter delta relative to the dirty baseline", async () => {
    const root = await createRepository();
    const baseline = await dirtyBaseline(root);
    const before = await liveGitIdentity(root);
    const sandbox = await materialize(root, baseline);

    await writeFile(
      path.join(sandbox.workspaceRoot, "format.ts"),
      "const value = { answer: 42 };\n",
    );
    const result = await captureGrSnapshotSandboxResult({
      root,
      baseline,
      sandbox,
      allowedChangedPaths: ["format.ts"],
      grantedEffects: sandboxEffects,
    });
    const diff = await diffGrSnapshots(baseline, result, { grantedEffects: ["git.read"] });
    expect(diff.files.map((file) => file.path)).toEqual(["format.ts"]);

    const patch = await createGrPatch(baseline, result, { grantedEffects: ["git.read"] });
    expect(patch.forward.content).toContain("format.ts");
    expect(patch.forward.content).not.toContain("other.txt");
    expect(patch.forward.content).not.toContain("staged.txt");
    expect(patch.forward.content).not.toContain("untracked.txt");
    expect(await liveGitIdentity(root)).toEqual(before);
    expect(await readFile(path.join(root, "format.ts"), "utf8")).toBe("const value={answer:42}\n");
  });

  test("rejects ignored and other out-of-scope writes despite Git ignore rules", async () => {
    const root = await createRepository();
    const baseline = await dirtyBaseline(root);
    const sandbox = await materialize(root, baseline);

    await mkdir(path.join(sandbox.workspaceRoot, ".private"));
    await writeFile(path.join(sandbox.workspaceRoot, ".private", "formatter-cache.json"), "{}\n");
    await expect(
      captureGrSnapshotSandboxResult({
        root,
        baseline,
        sandbox,
        allowedChangedPaths: ["format.ts"],
        grantedEffects: sandboxEffects,
      }),
    ).rejects.toMatchObject({
      code: "GR_SANDBOX_PATH_DENIED",
      details: { denied: [".private/formatter-cache.json"] },
    });
  });

  test("rejects out-of-scope mode, deletion, and symlink changes", async () => {
    const root = await createRepository();
    const baseline = await dirtyBaseline(root);
    const sandbox = await materialize(root, baseline);

    await chmod(path.join(sandbox.workspaceRoot, "script.sh"), 0o755);
    await rm(path.join(sandbox.workspaceRoot, "other.txt"));
    await symlink("format.ts", path.join(sandbox.workspaceRoot, "linked.ts"));
    await expect(
      captureGrSnapshotSandboxResult({
        root,
        baseline,
        sandbox,
        allowedChangedPaths: ["format.ts"],
        grantedEffects: sandboxEffects,
      }),
    ).rejects.toMatchObject({
      code: "GR_SANDBOX_PATH_DENIED",
      details: { denied: ["linked.ts", "other.txt", "script.sh"] },
    });
  });

  test("refuses marker-tampered cleanup and emits repeatable cleanup receipts", async () => {
    const root = await createRepository();
    const baseline = await dirtyBaseline(root);
    const sandbox = await materialize(root, baseline);
    const marker = await readFile(sandbox.ownershipMarker, "utf8");

    await writeFile(sandbox.ownershipMarker, "{}\n");
    const refused = await cleanupGrSnapshotSandbox({
      root,
      sandbox,
      grantedEffects: cleanupEffects,
    });
    expect(refused.status).toBe("failed");
    expect(await lstat(sandbox.containerRoot)).toBeDefined();
    expect(parseGrSandboxCleanupReceipt(refused)).toEqual(refused);

    await writeFile(sandbox.ownershipMarker, marker);
    const removed = await cleanupGrSnapshotSandbox({
      root,
      sandbox,
      grantedEffects: cleanupEffects,
    });
    expect(removed.status).toBe("removed");
    expect(Bun.file(sandbox.containerRoot).exists()).resolves.toBe(false);

    const repeated = await cleanupGrSnapshotSandbox({
      root,
      sandbox,
      grantedEffects: cleanupEffects,
    });
    expect(repeated.status).toBe("already-absent");
    expect(parseGrSandboxCleanupReceipt(repeated)).toEqual(repeated);
  });
});
