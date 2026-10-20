import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  assertGrOwnerNativeCustodySpec,
  assertGrOwnerNativeDirectory,
  assertGrOwnerNativeFile,
  createGrOwnerNativeGitRuntime,
  createGrRootArtifactProofMemo,
  renderGrOwnerNativeGitConfig,
  type GrOwnerNativeCustody,
} from "./owner-admission";
test("root artifact proof reuse is local and invalidates on digest, identity, content metadata or permissions", () => {
  const memo = createGrRootArtifactProofMemo();
  const s = {
    uid: 0,
    gid: 0,
    mode: 0o100555,
    nlink: 1,
    dev: 1,
    ino: 2,
    size: 1024,
    ctimeMs: 3,
    mtimeMs: 4,
  };
  expect(memo.matches("/usr/bin/fixture", "digest", s)).toBe(false);
  memo.remember("/usr/bin/fixture", "digest", s);
  expect(memo.matches("/usr/bin/fixture", "digest", s)).toBe(true);
  expect(memo.matches("/usr/bin/fixture", "foreign", s)).toBe(false);
  expect(memo.matches("/usr/bin/other", "digest", s)).toBe(false);
  for (const patch of [
    { uid: 995 },
    { gid: 1 },
    { mode: 0o100777 },
    { nlink: 2 },
    { dev: 2 },
    { ino: 3 },
    { size: 1025 },
    { ctimeMs: 4 },
    { mtimeMs: 5 },
  ])
    expect(memo.matches("/usr/bin/fixture", "digest", { ...s, ...patch })).toBe(false);
  memo.remember("/usr/owner-file", "digest", { ...s, uid: 995 });
  expect(memo.matches("/usr/owner-file", "digest", { ...s, uid: 995 })).toBe(false);
  expect(createGrRootArtifactProofMemo().matches("/usr/bin/fixture", "digest", s)).toBe(false);
});

const hash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
const remoteUrl = "git@github.com:reliverse/reliverse.git";
const spec: GrOwnerNativeCustody = {
  ownerUid: 995,
  ownerGid: 985,
  producerUid: 1000,
  reviewerUid: 994,
  author: { name: "Fixture", email: "fixture@example.invalid" },
  launcherExecutable: "/usr/lib/reliverse/gr/owner-launch",
  root: "/var/lib/reliverse/gr/publication/campaign002",
  credentialDirectory: "/var/lib/reliverse/gr/credentials/campaign002",
  privateKeyFile: "/var/lib/reliverse/gr/credentials/campaign002/git-key",
  knownHostsFile: "/var/lib/reliverse/gr/credentials/campaign002/known_hosts",
  remoteUrl,
  knownHostsDigest: hash("fixture-host-key"),
  gitConfigDigest: hash(renderGrOwnerNativeGitConfig(remoteUrl)),
  gitExecutable: "/usr/bin/git",
  sshExecutable: "/usr/bin/ssh",
  closureFingerprint: hash("fixture-only-admitted-closure"),
  artifacts: [
    { path: "/usr/lib/reliverse/gr/owner-launch", digest: hash("fixture-launcher") },
    { path: "/usr/bin/git", digest: hash("fixture-git") },
    { path: "/usr/bin/ssh", digest: hash("fixture-ssh") },
  ],
};
function stat(type: "file" | "directory", uid: number, mode: number) {
  return {
    uid,
    mode,
    nlink: 1,
    dev: 1,
    ino: 1,
    ctimeMs: 1,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
    isSymbolicLink: () => false,
  };
}
test("native Git corridor ignores ambient HOME/PATH/SSH agent and pins a canonical repository config", () => {
  const runtime = createGrOwnerNativeGitRuntime(spec);
  expect(runtime.root).toBe(spec.root);
  expect(runtime.env.HOME).toBe(spec.credentialDirectory);
  expect(runtime.env.GIT_SSH_COMMAND).toContain("IdentityAgent=none");
  expect(runtime.env.GIT_SSH_COMMAND).toContain("StrictHostKeyChecking=yes");
  expect(runtime.env.GIT_SSH_COMMAND).toContain("ForwardAgent=no");
  expect(runtime.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  expect(runtime.env.SSH_AUTH_SOCK).toBeUndefined();
  expect(renderGrOwnerNativeGitConfig(remoteUrl)).toContain("hooksPath = /dev/null");
});
for (const [name, change] of [
  ["producer UID", { ownerUid: 1000 }],
  ["reviewer UID", { ownerUid: 994 }],
  ["producer checkout", { root: "/home/operator/workspace/reliverse" }],
  ["owner shared credentials", { credentialDirectory: "/home/operator/.ssh" }],
  ["key accidentally hashed as public data", { knownHostsFile: spec.privateKeyFile }],
  ["unapproved config", { gitConfigDigest: hash("config-with-include") }],
  ["shell injection", { sshExecutable: "/usr/bin/ssh;id" }],
  ["untrusted known hosts", { knownHostsFile: "/tmp/known_hosts" }],
  [
    "credential read as executable",
    {
      artifacts: [
        ...spec.artifacts,
        { path: "/etc/ssh/ssh_host_ed25519_key", digest: hash("forbidden") },
      ],
    },
  ],
] as const)
  test(`native owner admission refuses ${name}`, () => {
    expect(() => assertGrOwnerNativeCustodySpec({ ...spec, ...change })).toThrow(
      "CUSTODY_UNVERIFIED",
    );
  });
test("native owner directory/file guards refuse producer access, links and special files", () => {
  expect(() =>
    assertGrOwnerNativeDirectory(stat("directory", 995, 0o700), 995, true),
  ).not.toThrow();
  expect(() => assertGrOwnerNativeDirectory(stat("directory", 1000, 0o700), 995, true)).toThrow();
  expect(() => assertGrOwnerNativeDirectory(stat("directory", 995, 0o755), 995, true)).toThrow();
  expect(() => assertGrOwnerNativeFile(stat("file", 995, 0o600), 995, true)).not.toThrow();
  expect(() => assertGrOwnerNativeFile(stat("file", 995, 0o644), 995, true)).toThrow();
  expect(() =>
    assertGrOwnerNativeFile({ ...stat("file", 995, 0o600), nlink: 2 }, 995, true),
  ).toThrow();
  expect(() =>
    assertGrOwnerNativeFile({ ...stat("file", 995, 0o600), isSymbolicLink: () => true }, 995, true),
  ).toThrow();
  expect(() => assertGrOwnerNativeFile(stat("directory", 995, 0o600), 995, true)).toThrow();
});
test("ordinary producer startup cannot pass native owner admission or read a private key", async () => {
  await expect(createGrOwnerNativeGitRuntime(spec).assertCurrent()).rejects.toThrow(
    "CUSTODY_UNVERIFIED",
  );
});
test("SSH URL cannot introduce Git helper protocols or config injection", () => {
  for (const url of [
    "https://github.com/reliverse/reliverse.git",
    "ext::sh -c id",
    "git@github.com:x/y.git\n[include]\npath=/tmp/evil",
  ])
    expect(() => renderGrOwnerNativeGitConfig(url)).toThrow();
});
test("runtime snapshots descriptor bytes rather than retaining mutable caller artifacts", () => {
  const changed = structuredClone(spec),
    runtime = createGrOwnerNativeGitRuntime(changed);
  Object.assign(changed, { privateKeyFile: "/tmp/evil", credentialDirectory: "/tmp" });
  expect(runtime.env.HOME).toBe(spec.credentialDirectory);
  expect(runtime.env.GIT_SSH_COMMAND).not.toContain("/tmp/evil");
  expect(Object.isFrozen(runtime.env)).toBe(true);
});
