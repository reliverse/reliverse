import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { digestRprDirectoryTree } from "@reliverse/rpr-toolchain-materialization";

import { restoreGrBundleContinuation } from "./bundle-continuation";
import { resolveGrBundlePolicy } from "./bundle-policy";
import { createGrRepositoryBundle } from "./repository-bundle";
import { inspectGrRepositoryVersion } from "./repository-version";
import { createGrAcceptedRevisionSnapshot, createGrSnapshot } from "./snapshot";
import {
  commitGrTransition,
  inspectGrTransitionState,
  prepareGrTransition,
} from "./transition-state";

const roots = new Set<string>();
async function git(root: string, args: string[]) {
  const p = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [c, e] = await Promise.all([p.exited, Bun.readableStreamToText(p.stderr)]);
  if (c) throw new Error(e);
}
async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-bundle-test-"));
  roots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "test@reliverse.local"]);
  await git(root, ["config", "user.name", "Test"]);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "@repo/demo-root", version: "0.0.7", private: true }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "a.txt"), "a\n");
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs", "START-HERE.md"), "start\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "init"]);
  return root;
}
afterAll(async () => {
  await Promise.all([...roots].map((r) => rm(r, { recursive: true, force: true })));
});

test("GR repository bundle v0 creates a snapshot-bound whole-repository transfer", async () => {
  const root = await repo();
  const snapshot = await createGrSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const out = path.join(root, "bundle.tar.zst");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.schemaVersion).toBe("gr.repository-bundle.v0");
  expect(result.manifest.profile).toBe("handoff");
  expect(result.manifest.repositoryState.kind).toBe("git-projection");
  expect(result.manifest.selection).toEqual({ kind: "workspace" });
  expect(result.manifest.handoff.entries).toContain("docs/START-HERE.md");
  expect(await Bun.file(out).exists()).toBe(true);
  expect(
    JSON.parse(await readFile(`${out.slice(0, -".tar.zst".length)}.receipt.json`, "utf8"))
      .schemaVersion,
  ).toBe("gr.repository-bundle-receipt.v0");
});

test("GR repository bundle v0 supports bounded path selection and verified RPR attachment", async () => {
  const root = await repo();
  const tooling = path.join(root, "tooling-fixture");
  await mkdir(path.join(tooling, "bin"), { recursive: true });
  await mkdir(path.join(tooling, "packages"), { recursive: true });
  await writeFile(path.join(tooling, "bin", "tool"), "tool\n");
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(tooling, "packages")),
    bin: await digestRprDirectoryTree(path.join(tooling, "bin")),
  };
  await writeFile(
    path.join(tooling, "receipt.json"),
    JSON.stringify({
      schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
      compositionId: "rpr:toolchain:sha256:test",
      lockId: "rpr:lock:sha256:test",
      network: "denied",
      target: ".",
      installed: [],
      payloadDigests,
    }),
  );
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    paths: ["docs"],
    tooling: { root: tooling, compositionId: "rpr:toolchain:sha256:test" },
    output: path.join(root, "subset.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.selection).toEqual({ kind: "paths", paths: ["docs"] });
  expect(result.manifest.source.entries).toBe(1);
  expect(result.manifest.tooling.attachments).toHaveLength(1);
  expect(result.manifest.tooling.attachments[0]).toMatchObject({
    kind: "rpr-toolchain-materialization",
    delivery: "embedded",
    required: true,
    role: "operator",
  });
});

test("accepted-revision snapshot ignores cumulative dirty work and bundles the accepted HEAD", async () => {
  const root = await repo();
  await writeFile(path.join(root, "a.txt"), "dirty-new\n");
  await writeFile(path.join(root, "untracked.txt"), "untracked\n");
  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(snapshot.origin.kind).toBe("accepted-revision");
  const out = path.join(root, "accepted.tar.zst");
  await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const outer = path.join(root, "outer");
  await mkdir(outer);
  const unpack = Bun.spawn(["tar", "--zstd", "-xf", out, "-C", outer], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await unpack.exited).toBe(0);
  const read = Bun.spawn(
    ["tar", "-xOf", path.join(outer, "artifacts/repository/source.tar"), "a.txt"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const text = await Bun.readableStreamToText(read.stdout);
  expect(await read.exited).toBe(0);
  expect(text).toBe("a\n");
  expect(await Bun.file(path.join(root, "untracked.txt")).text()).toBe("untracked\n");
});

test("repository bundle bytes are deterministic for one exact snapshot and selection", async () => {
  const root = await repo();
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const a = await createGrRepositoryBundle({
    root,
    snapshot,
    paths: ["docs"],
    output: path.join(root, "a.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  await Bun.sleep(1100);
  const b = await createGrRepositoryBundle({
    root,
    snapshot,
    paths: ["docs"],
    output: path.join(root, "b.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(b.bundleId).toBe(a.bundleId);
  expect(b.manifest.source.sha256).toBe(a.manifest.source.sha256);
  expect(b.archive.sha256).toBe(a.archive.sha256);
});

test("bundle policy carries human UX defaults and global Handoff naming config", async () => {
  const root = await repo();
  await mkdir(path.join(root, ".config"), { recursive: true });
  await writeFile(
    path.join(root, ".config", "gr.json"),
    JSON.stringify(
      {
        bundle: {
          profile: "offline",
          handoff: { enabled: true, global: true, root: "../global-handoff" },
          output: { timestampDirectory: "short", naming: "handoff" },
        },
      },
      null,
      2,
    ),
  );
  const policy = await resolveGrBundlePolicy(root);
  expect(policy.profile).toBe("offline");
  expect(policy.handoff).toEqual({ enabled: true, global: true, root: "../global-handoff" });
  expect(policy.output).toEqual({ timestampDirectory: "short", naming: "handoff" });
});

test("bundle policy excludes .private by default and applies repository glob exclusions from the snapshotted config", async () => {
  const root = await repo();
  await mkdir(path.join(root, ".private", "reliverse", "rse", "plugins", "handoff"), {
    recursive: true,
  });
  await writeFile(path.join(root, ".private", "secret.txt"), "secret\n");
  await writeFile(
    path.join(root, ".private", "reliverse", "rse", "plugins", "handoff", "START-HERE.md"),
    "legacy handoff\n",
  );
  await mkdir(path.join(root, "extensions", "demo", ".private", "receipts"), { recursive: true });
  await writeFile(
    path.join(root, "extensions", "demo", ".private", "receipts", "private.json"),
    "{}\n",
  );
  await mkdir(path.join(root, ".config"), { recursive: true });
  await writeFile(
    path.join(root, ".config", "gr.json"),
    JSON.stringify({ bundle: { exclude: ["docs/**"], history: "none" } }, null, 2),
  );
  await git(root, [
    "add",
    "-f",
    ".private/secret.txt",
    ".private/reliverse/rse/plugins/handoff/START-HERE.md",
    "extensions/demo/.private/receipts/private.json",
  ]);
  await git(root, ["add", ".config/gr.json"]);
  await git(root, ["commit", "-qm", "bundle policy"]);
  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const out = path.join(root, "policy.tar.zst");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.policy.exclude).toContain(".private/**");
  expect(result.manifest.policy.exclude).toContain("**/.private/**");
  expect(result.manifest.policy.exclude).toContain("docs/**");
  expect(result.manifest.history).toEqual({ mode: "none" });
  expect(result.manifest.handoff.entries).toEqual([]);
  const outer = path.join(root, "policy-outer");
  await mkdir(outer);
  const unpack = Bun.spawn(["tar", "--zstd", "-xf", out, "-C", outer], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await unpack.exited).toBe(0);
  const list = Bun.spawn(["tar", "-tf", path.join(outer, "artifacts/repository/source.tar")], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const names = await Bun.readableStreamToText(list.stdout);
  expect(await list.exited).toBe(0);
  expect(names).not.toContain(".private/");
  expect(names).not.toContain("extensions/demo/.private/");
  expect(names).not.toContain("docs/");
  expect(names).toContain(".config/gr.json");
});

test("bundle history projection defaults to refs and commits mode exports all locally-known commit objects without entering source.tar", async () => {
  const root = await repo();
  const snapshotRefs = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const refs = await createGrRepositoryBundle({
    root,
    snapshot: snapshotRefs,
    output: path.join(root, "refs.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(refs.manifest.history.mode).toBe("refs");
  if (refs.manifest.history.mode === "refs")
    expect(refs.manifest.history.entries).toBeGreaterThan(0);

  await mkdir(path.join(root, ".config"), { recursive: true });
  await writeFile(
    path.join(root, ".config", "gr.json"),
    JSON.stringify({ bundle: { history: "commits" } }, null, 2),
  );
  await git(root, ["add", ".config/gr.json"]);
  await git(root, ["commit", "-qm", "commit history config"]);
  const snapshotCommits = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const commits = await createGrRepositoryBundle({
    root,
    snapshot: snapshotCommits,
    output: path.join(root, "commits.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(commits.manifest.history.mode).toBe("commits");
  if (commits.manifest.history.mode === "commits") {
    expect(commits.manifest.history.path).toBe("metadata/gr/commits.ndjson");
    expect(commits.manifest.history.entries).toBeGreaterThanOrEqual(2);
  }
});

test("repository bundle carries checksum-bound GR continuation outside source.tar and restores it through relocated RVS Private topology", async () => {
  const root = await repo();
  const version = await inspectGrRepositoryVersion(root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const prepared = await prepareGrTransition(root, version, {
    grantedEffects: ["filesystem.read"],
  });
  await commitGrTransition(prepared, { grantedEffects: ["filesystem.write"] });
  expect(prepared.transition.sequence).toBe(8);

  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const out = path.join(root, "continuation.tar.zst");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.continuation.kind).toBe("gr-transition-state");
  if (result.manifest.continuation.kind === "gr-transition-state")
    expect(result.manifest.continuation.lastSequence).toBe(8);

  const bundleRoot = path.join(root, "continuation-outer");
  await mkdir(bundleRoot);
  const unpack = Bun.spawn(["tar", "--zstd", "-xf", out, "-C", bundleRoot], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await unpack.exited).toBe(0);
  const sourceList = Bun.spawn(
    ["tar", "-tf", path.join(bundleRoot, "artifacts/repository/source.tar")],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const sourceNames = await Bun.readableStreamToText(sourceList.stdout);
  expect(await sourceList.exited).toBe(0);
  expect(sourceNames).not.toContain(".private/");

  const target = await mkdtemp(path.join(tmpdir(), "gr-bundle-target-"));
  roots.add(target);
  const installSource = Bun.spawn(
    ["tar", "-xf", path.join(bundleRoot, "artifacts/repository/source.tar"), "-C", target],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await installSource.exited).toBe(0);
  const relocatedPrivateRoot = await mkdtemp(path.join(tmpdir(), "gr-relocated-private-"));
  roots.add(relocatedPrivateRoot);
  const topology = { privateRoot: relocatedPrivateRoot };
  const restored = await restoreGrBundleContinuation({
    root: target,
    bundleRoot,
    topology,
    grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
  });
  expect(restored.restored).toBe(true);
  if (!restored.restored) throw new Error(`Expected continuation restore, got ${restored.reason}`);
  expect(restored.statePath.startsWith(relocatedPrivateRoot)).toBe(true);
  const state = await inspectGrTransitionState(target, {
    topology,
    grantedEffects: ["filesystem.read"],
  });
  expect(state?.lastSequence).toBe(8);
  const targetVersion = await inspectGrRepositoryVersion(target, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const next = await prepareGrTransition(target, targetVersion, {
    topology,
    grantedEffects: ["filesystem.read"],
  });
  expect(next.transition.transitionId).toBe("grt_000000009");
  await commitGrTransition(next, { grantedEffects: ["filesystem.write"] });
  const rollbackAttempt = await restoreGrBundleContinuation({
    root: target,
    bundleRoot,
    topology,
    grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
  });
  expect(rollbackAttempt).toMatchObject({
    restored: false,
    reason: "newer-local-state",
    lastSequence: 9,
  });
  expect(
    (await inspectGrTransitionState(target, { topology, grantedEffects: ["filesystem.read"] }))
      ?.lastSequence,
  ).toBe(9);
});

test("GR continuation restore fails closed on tampering and repository identity mismatch", async () => {
  const root = await repo();
  const version = await inspectGrRepositoryVersion(root, {
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const prepared = await prepareGrTransition(root, version, {
    grantedEffects: ["filesystem.read"],
  });
  await commitGrTransition(prepared, { grantedEffects: ["filesystem.write"] });
  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const out = path.join(root, "guarded-continuation.tar.zst");
  await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const bundleRoot = path.join(root, "guarded-outer");
  await mkdir(bundleRoot);
  const unpack = Bun.spawn(["tar", "--zstd", "-xf", out, "-C", bundleRoot], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await unpack.exited).toBe(0);

  const continuationPath = path.join(bundleRoot, "continuation", "gr-transition-state.json");
  const original = await readFile(continuationPath, "utf8");
  await writeFile(continuationPath, original.replace('"lastSequence": 8', '"lastSequence": 99'));
  const target = await mkdtemp(path.join(tmpdir(), "gr-tamper-target-"));
  roots.add(target);
  await writeFile(
    path.join(target, "package.json"),
    `${JSON.stringify({ name: "@repo/demo-root", version: "0.0.7", private: true }, null, 2)}\n`,
  );
  await expect(
    restoreGrBundleContinuation({
      root: target,
      bundleRoot,
      grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
    }),
  ).rejects.toThrow("checksum mismatch");

  await writeFile(continuationPath, original);
  await writeFile(
    path.join(target, "package.json"),
    `${JSON.stringify({ name: "@repo/other-root", version: "0.0.7", private: true }, null, 2)}\n`,
  );
  await expect(
    restoreGrBundleContinuation({
      root: target,
      bundleRoot,
      grantedEffects: ["filesystem.read", "filesystem.write", "git.read"],
    }),
  ).rejects.toThrow("another repository");
});

test("repository bundle without GR transition state records an explicit no-continuation projection", async () => {
  const root = await repo();
  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const out = path.join(root, "no-continuation.tar.zst");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.continuation).toEqual({ kind: "none" });
});

test("sidecar tooling is reusable, optional when absent, and fails closed on digest drift", async () => {
  const root = await repo();
  const tooling = path.join(root, "sidecar-tooling");
  await mkdir(path.join(tooling, "bin"), { recursive: true });
  await mkdir(path.join(tooling, "packages"), { recursive: true });
  await writeFile(path.join(tooling, "bin", "gr"), "gr-binary\n");
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(tooling, "packages")),
    bin: await digestRprDirectoryTree(path.join(tooling, "bin")),
  };
  await writeFile(
    path.join(tooling, "receipt.json"),
    `${JSON.stringify(
      {
        schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
        compositionId: "rpr:toolchain:sha256:sidecar",
        lockId: "rpr:lock:sha256:sidecar",
        network: "denied",
        target: ".",
        installed: [],
        payloadDigests,
      },
      null,
      2,
    )}\n`,
  );
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const outDir = path.join(root, "dist");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: outDir,
    profile: "offline",
    tooling: { root: tooling, delivery: "sidecar", required: false, role: "operator" },
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.archive.path.startsWith(outDir)).toBe(true);
  expect(result.archive.path.endsWith(".tar.zst")).toBe(true);
  const attachment = result.manifest.tooling.attachments[0]!;
  expect(attachment).toMatchObject({ delivery: "sidecar", required: false, role: "operator" });
  if (!attachment.sidecar) throw new Error("expected sidecar");
  const sidecarPath = path.join(outDir, attachment.sidecar.fileName);
  expect(await Bun.file(sidecarPath).exists()).toBe(true);

  const target = path.join(root, "installed-with-sidecar");
  const install = Bun.spawn(["sh", result.installerPath, target, "--isolated"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [installCode, installErr] = await Promise.all([
    install.exited,
    Bun.readableStreamToText(install.stderr),
  ]);
  expect(installCode).toBe(0);
  expect(installErr).toBe("");
  expect(
    await Bun.file(path.join(target, ".reliverse-tooling", "operator", "receipt.json")).exists(),
  ).toBe(true);
  expect(
    JSON.parse(await readFile(path.join(target, ".gr-bundle-install.json"), "utf8")).tooling[0]
      .status,
  ).toBe("installed-isolated");

  await rm(target, { recursive: true, force: true });
  const sidecarBytes = new Uint8Array(await Bun.file(sidecarPath).arrayBuffer());
  await rm(sidecarPath);
  const optional = Bun.spawn(["sh", result.installerPath, target, "--isolated"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await optional.exited).toBe(0);
  expect(
    JSON.parse(await readFile(path.join(target, ".gr-bundle-install.json"), "utf8")).tooling[0]
      .status,
  ).toBe("unavailable");

  await rm(target, { recursive: true, force: true });
  await writeFile(sidecarPath, new Uint8Array([...sidecarBytes, 0]));
  const tampered = Bun.spawn(["sh", result.installerPath, target, "--isolated"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [tamperedCode, tamperedErr] = await Promise.all([
    tampered.exited,
    Bun.readableStreamToText(tampered.stderr),
  ]);
  expect(tamperedCode).not.toBe(0);
  expect(tamperedErr).toContain("GR_BUNDLE_SIDECAR_DIGEST_MISMATCH");
  expect(await Bun.file(target).exists()).toBe(false);
});

test("generated installer rejects escaping repository symlinks without publishing a partial target", async () => {
  const root = await repo();
  await Bun.write(path.join(root, "safe.txt"), "safe\n");
  const symlink = Bun.spawn(["ln", "-s", "../../outside", path.join(root, "escape")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await symlink.exited).toBe(0);
  await git(root, ["add", "safe.txt", "escape"]);
  await git(root, ["commit", "-qm", "unsafe symlink fixture"]);
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: path.join(root, "unsafe.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const target = path.join(root, "unsafe-target");
  const install = Bun.spawn(["sh", result.installerPath, target, "--isolated"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    install.exited,
    Bun.readableStreamToText(install.stderr),
  ]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("GR_BUNDLE_UNSAFE_SYMLINK");
  expect(await Bun.file(target).exists()).toBe(false);
});

test("required sidecar absence fails closed before target publication", async () => {
  const root = await repo();
  const tooling = await mkdtemp(path.join(tmpdir(), "gr-required-sidecar-"));
  roots.add(tooling);
  await mkdir(path.join(tooling, "bin"), { recursive: true });
  await mkdir(path.join(tooling, "packages"), { recursive: true });
  await writeFile(path.join(tooling, "bin", "gr"), "gr\n");
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(tooling, "packages")),
    bin: await digestRprDirectoryTree(path.join(tooling, "bin")),
  };
  await writeFile(
    path.join(tooling, "receipt.json"),
    `${JSON.stringify({ schema: "reliverse.rpr.toolchain-materialization-receipt.v0", compositionId: "rpr:toolchain:sha256:required", lockId: "rpr:lock:sha256:required", network: "denied", target: ".", installed: [], payloadDigests }, null, 2)}\n`,
  );
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: path.join(root, "required.tar.zst"),
    profile: "offline",
    tooling: { root: tooling, delivery: "sidecar", required: true, role: "operator" },
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const attachment = result.manifest.tooling.attachments[0]!;
  if (!attachment.sidecar) throw new Error("expected sidecar");
  await rm(path.join(path.dirname(result.archive.path), attachment.sidecar.fileName));
  const target = path.join(root, "required-target");
  const child = Bun.spawn(["sh", result.installerPath, target, "--isolated"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, Bun.readableStreamToText(child.stderr)]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("GR_BUNDLE_REQUIRED_SIDECAR_MISSING");
  expect(await Bun.file(target).exists()).toBe(false);
});

async function toolingFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-bundle-tooling-"));
  roots.add(root);
  await mkdir(path.join(root, "bin"), { recursive: true });
  await mkdir(path.join(root, "packages"), { recursive: true });
  await writeFile(path.join(root, "bin", "tool"), "tool\n");
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(root, "packages")),
    bin: await digestRprDirectoryTree(path.join(root, "bin")),
  };
  await writeFile(
    path.join(root, "receipt.json"),
    `${JSON.stringify(
      {
        schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
        compositionId: "rpr:toolchain:sha256:fixture",
        lockId: "rpr:lock:sha256:fixture",
        network: "denied",
        target: ".",
        installed: [],
        payloadDigests,
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

async function runShell(script: string, target: string, mode?: "--isolated") {
  const child = Bun.spawn(["sh", script, target, ...(mode ? [mode] : [])], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ]);
  return { exitCode, stdout, stderr };
}

test("embedded tooling preserves relocatable relative symlink identity", async () => {
  const root = await repo();
  const tooling = await mkdtemp(path.join(tmpdir(), "gr-symlink-tooling-"));
  roots.add(tooling);
  await mkdir(path.join(tooling, "bin"), { recursive: true });
  await mkdir(path.join(tooling, "packages", "gr"), { recursive: true });
  await writeFile(path.join(tooling, "packages", "gr", "gr"), "gr\n");
  await symlink("../packages/gr/gr", path.join(tooling, "bin", "gr"));
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(tooling, "packages")),
    bin: await digestRprDirectoryTree(path.join(tooling, "bin")),
  };
  await writeFile(
    path.join(tooling, "receipt.json"),
    `${JSON.stringify(
      {
        schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
        compositionId: "rpr:toolchain:sha256:symlink-fixture",
        lockId: "rpr:lock:sha256:symlink-fixture",
        network: "denied",
        target: ".",
        installed: [],
        payloadDigests,
      },
      null,
      2,
    )}\n`,
  );
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: { root: tooling, role: "operator", delivery: "embedded", required: true },
    output: path.join(root, "symlink-offline.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const attachment = result.manifest.tooling.attachments[0]!;
  const extracted = await mkdtemp(path.join(tmpdir(), "gr-symlink-bundle-"));
  roots.add(extracted);
  const child = Bun.spawn(["tar", "--zstd", "-xf", result.archive.path, "-C", extracted]);
  expect(await child.exited).toBe(0);
  expect(await readlink(path.join(extracted, attachment.path!, "bin", "gr"))).toBe(
    "../packages/gr/gr",
  );
});

test("handoff bundle installs through the generated shell with atomic staging and repository-state projection", async () => {
  const root = await repo();
  const tooling = await toolingFixture();
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const outDir = path.join(root, "dist");
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "handoff",
    tooling: { root: tooling, role: "operator", delivery: "embedded", required: true },
    output: outDir,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(path.dirname(result.archive.path)).toBe(outDir);
  expect(path.basename(result.archive.path)).toContain("gr-bundle-test-");
  expect(result.manifest.repositoryState.kind).toBe("git-projection");

  const target = path.join(root, "restored");
  const installed = await runShell(result.installerPath, target);
  expect(installed.exitCode).toBe(0);
  expect(await Bun.file(path.join(target, "a.txt")).text()).toBe("a\n");
  expect(
    await Bun.file(path.join(target, ".reliverse-tooling", "operator", "bin", "tool")).text(),
  ).toBe("tool\n");
  const receipt = JSON.parse(await Bun.file(path.join(target, ".gr-bundle-install.json")).text());
  expect(receipt.bundleId).toBe(result.bundleId);
  expect(receipt.profile).toBe("handoff");
  expect(receipt.tooling).toEqual([
    expect.objectContaining({
      role: "operator",
      delivery: "embedded",
      status: "installed-isolated",
    }),
  ]);
});

test("optional sidecar may be absent while required or tampered sidecars fail closed before target publication", async () => {
  const root = await repo();
  const tooling = await toolingFixture();
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });

  const optional = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "handoff",
    tooling: { root: tooling, role: "operator", delivery: "sidecar", required: false },
    output: path.join(root, "optional"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const optionalAttachment = optional.manifest.tooling.attachments[0]!;
  expect(optionalAttachment.sidecar).toBeDefined();
  await rm(path.join(path.dirname(optional.archive.path), optionalAttachment.sidecar!.fileName));
  const optionalTarget = path.join(root, "optional-restored");
  const optionalInstall = await runShell(optional.installerPath, optionalTarget);
  expect(optionalInstall.exitCode).toBe(0);
  const optionalReceipt = JSON.parse(
    await Bun.file(path.join(optionalTarget, ".gr-bundle-install.json")).text(),
  );
  expect(optionalReceipt.tooling[0].status).toBe("unavailable");

  const required = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: { root: tooling, role: "operator", delivery: "sidecar", required: true },
    output: path.join(root, "required"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const requiredAttachment = required.manifest.tooling.attachments[0]!;
  const requiredSidecar = path.join(
    path.dirname(required.archive.path),
    requiredAttachment.sidecar!.fileName,
  );
  await rm(requiredSidecar);
  const missingTarget = path.join(root, "required-missing");
  const missingInstall = await runShell(required.installerPath, missingTarget);
  expect(missingInstall.exitCode).not.toBe(0);
  expect(missingInstall.stderr).toContain("GR_BUNDLE_REQUIRED_SIDECAR_MISSING");
  expect(await Bun.file(missingTarget).exists()).toBe(false);

  const tampered = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: { root: tooling, role: "operator", delivery: "sidecar", required: true },
    output: path.join(root, "tampered"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const tamperedAttachment = tampered.manifest.tooling.attachments[0]!;
  const tamperedSidecar = path.join(
    path.dirname(tampered.archive.path),
    tamperedAttachment.sidecar!.fileName,
  );
  await writeFile(tamperedSidecar, "tampered\n");
  const tamperedTarget = path.join(root, "tampered-target");
  const tamperedInstall = await runShell(tampered.installerPath, tamperedTarget);
  expect(tamperedInstall.exitCode).not.toBe(0);
  expect(tamperedInstall.stderr).toContain("GR_BUNDLE_SIDECAR_DIGEST_MISMATCH");
  expect(await Bun.file(tamperedTarget).exists()).toBe(false);
});

test("generated installer rejects a repository symlink that escapes the staged target", async () => {
  const root = await repo();
  await Bun.write(path.join(root, "escape-link"), Bun.file(path.join(root, "a.txt")));
  await rm(path.join(root, "escape-link"));
  const link = Bun.spawn(["ln", "-s", "../../outside", "escape-link"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await link.exited).toBe(0);
  await git(root, ["add", "escape-link"]);
  await git(root, ["commit", "-qm", "unsafe symlink fixture"]);
  const snapshot = await createGrAcceptedRevisionSnapshot({
    root,
    role: "baseline",
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    output: path.join(root, "unsafe.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const target = path.join(root, "unsafe-target");
  const installed = await runShell(result.installerPath, target);
  expect(installed.exitCode).not.toBe(0);
  expect(installed.stderr).toContain("GR_BUNDLE_UNSAFE_SYMLINK");
  expect(await Bun.file(target).exists()).toBe(false);
});

test("bundle carries independent common and repository-specific tooling attachments", async () => {
  const root = await repo();
  const common = await toolingFixture();
  const repositorySpecific = await toolingFixture();
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: [
      { root: common, role: "operator", delivery: "sidecar", required: true },
      { root: repositorySpecific, role: "repository", delivery: "embedded", required: false },
    ],
    output: path.join(root, "multi"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  expect(result.manifest.tooling.attachments).toHaveLength(2);
  expect(result.manifest.tooling.attachments.map((entry) => [entry.role, entry.delivery])).toEqual([
    ["operator", "sidecar"],
    ["repository", "embedded"],
  ]);
  const target = path.join(root, "multi-target");
  const installed = await runShell(result.installerPath, target, "--isolated");
  expect(installed.exitCode).toBe(0);
  const receipt = JSON.parse(await Bun.file(path.join(target, ".gr-bundle-install.json")).text());
  expect(receipt.tooling).toEqual([
    expect.objectContaining({ role: "operator", status: "installed-isolated" }),
    expect.objectContaining({ role: "repository", status: "installed-isolated" }),
  ]);
});

test("offline installer imports verified tooling into User RPR and reuses the content-addressed object", async () => {
  const root = await repo();
  const tooling = await mkdtemp(path.join(tmpdir(), "gr-host-tooling-"));
  roots.add(tooling);
  await mkdir(path.join(tooling, "bin"), { recursive: true });
  await mkdir(path.join(tooling, "packages"), { recursive: true });
  await writeFile(
    path.join(tooling, "bin", "gr"),
    '#!/bin/sh\nif [ "${1:-}" = bundle ] && [ "${2:-}" = verify-tooling ]; then [ -f "${3:-}/receipt.json" ]; exit $?; fi\nif [ "${1:-}" = bundle ] && [ "${2:-}" = verify ]; then exit 0; fi\nexit 2\n',
    { mode: 0o755 },
  );
  await writeFile(path.join(tooling, "bin", "tool"), "tool\n");
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(tooling, "packages")),
    bin: await digestRprDirectoryTree(path.join(tooling, "bin")),
  };
  await writeFile(
    path.join(tooling, "receipt.json"),
    `${JSON.stringify(
      {
        schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
        compositionId: "rpr:toolchain:sha256:host",
        lockId: "rpr:lock:sha256:host",
        network: "denied",
        target: ".",
        installed: [],
        payloadDigests,
      },
      null,
      2,
    )}\n`,
  );
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const result = await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: { root: tooling, role: "operator" },
    output: path.join(root, "host-offline.tar.zst"),
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const home = await mkdtemp(path.join(tmpdir(), "gr-host-home-"));
  roots.add(home);
  const install = async (target: string) => {
    const child = Bun.spawn(["sh", result.installerPath, target], {
      env: { ...process.env, HOME: home, RELIVERSE_HOME: path.join(home, ".reliverse") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      Bun.readableStreamToText(child.stderr),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(await Bun.file(path.join(target, ".gr-bundle-install.json")).text());
  };
  const first = await install(path.join(root, "host-target-a"));
  expect(first.tooling[0]).toMatchObject({ status: "imported-user-rpr" });
  expect(await Bun.file(path.join(home, ".reliverse", "bin", "gr")).exists()).toBe(true);
  const second = await install(path.join(root, "host-target-b"));
  expect(second.tooling[0]).toMatchObject({
    status: "reused-user-rpr",
    location: first.tooling[0].location,
  });
  expect(await Bun.file(path.join(root, "host-target-b", ".reliverse-tooling")).exists()).toBe(
    false,
  );
});

test("offline repository bundle installs a lock-bound workspace execution projection", async () => {
  const root = await repo();
  await writeFile(path.join(root, "bun.lock"), '{"lockfileVersion":2}\n');
  await mkdir(path.join(root, "packages", "local"), { recursive: true });
  await writeFile(
    path.join(root, "packages", "local", "package.json"),
    JSON.stringify({ name: "@demo/local", version: "0.1.0" }),
  );
  await git(root, ["add", "bun.lock", "packages/local/package.json"]);
  await git(root, ["commit", "-qm", "add execution fixture"]);

  const execution = path.join(root, "execution-fixture");
  await mkdir(path.join(execution, "bin"), { recursive: true });
  await mkdir(path.join(execution, "packages", "external"), { recursive: true });
  await mkdir(path.join(execution, "node_modules"), { recursive: true });
  await writeFile(
    path.join(execution, "packages", "external", "package.json"),
    JSON.stringify({ name: "external", version: "1.2.3" }),
  );
  await writeFile(path.join(execution, "packages", "external", "index.js"), "export default 42;\n");
  await symlink("../packages/external", path.join(execution, "node_modules", "external"));
  const payloadDigests = {
    packages: await digestRprDirectoryTree(path.join(execution, "packages")),
    bin: await digestRprDirectoryTree(path.join(execution, "bin")),
    nodeModules: await digestRprDirectoryTree(path.join(execution, "node_modules")),
  };
  await writeFile(
    path.join(execution, "receipt.json"),
    JSON.stringify({
      schema: "reliverse.rpr.toolchain-materialization-receipt.v0",
      compositionId: "rpr:toolchain:sha256:execution",
      lockId: "rpr:lock:sha256:execution",
      network: "denied",
      target: ".",
      installed: [],
      payloadDigests,
    }),
  );
  const lockDigest = `sha256:${new Bun.CryptoHasher("sha256").update(await readFile(path.join(root, "bun.lock"))).digest("hex")}`;
  const snapshot = await createGrSnapshot({
    root,
    role: "explicit",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const out = path.join(root, "execution.tar.zst");
  await createGrRepositoryBundle({
    root,
    snapshot,
    profile: "offline",
    tooling: {
      root: execution,
      role: "workspace-execution",
      execution: {
        lockfile: { path: "bun.lock", sha256: lockDigest },
        workspaceLinks: [{ packageName: "@demo/local", repositoryPath: "packages/local" }],
        dependencyLinks: [
          {
            repositoryPath: "packages/local",
            packageName: "external",
            materializedPath: "packages/external",
          },
        ],
      },
    },
    output: out,
    grantedEffects: ["artifact.write", "filesystem.read", "filesystem.write", "git.read"],
  });
  const outer = path.join(root, "execution-outer");
  const target = path.join(root, "execution-target");
  await mkdir(outer);
  const unpack = Bun.spawn(["tar", "--zstd", "-xf", out, "-C", outer], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await unpack.exited).toBe(0);
  const install = Bun.spawn(
    ["sh", path.join(outer, "scripts", "install.sh"), target, "--isolated"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [installCode, installErr] = await Promise.all([
    install.exited,
    Bun.readableStreamToText(install.stderr),
  ]);
  expect(installCode, installErr).toBe(0);
  expect(await readlink(path.join(target, "node_modules", "external"))).toContain(
    ".private/reliverse/gr/execution/",
  );
  expect(await readlink(path.join(target, "node_modules", "@demo", "local"))).toBe(
    "../../packages/local",
  );
  expect(
    await readlink(path.join(target, "packages", "local", "node_modules", "external")),
  ).toContain(".private/reliverse/gr/execution/");
  expect(await readFile(path.join(target, "node_modules", "external", "index.js"), "utf8")).toBe(
    "export default 42;\n",
  );
});
