import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { GrError, type GrGitRuntime } from "@reliverse/gr";

import {
  createGrCampaignReviewedOwnerCommitHost,
  createGrCampaignReviewedOwnerPushHost,
} from "./campaign";

const deny = () => new GrError("GR_NOT_AUTHORIZED", "GR_OWNER_NATIVE_CUSTODY_UNVERIFIED");
const safePath = (value: string) =>
  /^\/[A-Za-z0-9_./+-]+$/.test(value) && path.normalize(value) === value;
const digest = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value);

/** Loaded by independently admitted startup, never from CLI/env/module-path input.
 * Private key VALUES are not inspected or returned by this metadata guard. */
export interface GrOwnerNativeCustody {
  readonly ownerUid: number;
  readonly ownerGid: number;
  readonly author: { readonly name: string; readonly email: string };
  readonly launcherExecutable: string;
  readonly producerUid: number;
  readonly reviewerUid: number;
  readonly root: string;
  readonly credentialDirectory: string;
  readonly privateKeyFile: string;
  readonly knownHostsFile: string;
  readonly knownHostsDigest: string;
  readonly gitConfigDigest: string;
  readonly remoteUrl: string;
  readonly gitExecutable: string;
  readonly sshExecutable: string;
  readonly closureFingerprint: string;
  /** Complete approved executor/Git/SSH/helper closure, including native launcher.
   * Caller must authenticate completeness/admission; hashes alone cannot do it. */
  readonly artifacts: readonly { readonly path: string; readonly digest: string }[];
}

/** Canonical generated config: no arbitrary include, hooks, filter or credential helper. */
export function renderGrOwnerNativeGitConfig(remoteUrl: string) {
  if (!/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(remoteUrl)) throw deny();
  return `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n\thooksPath = /dev/null\n[remote \"origin\"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
}

export function assertGrOwnerNativeCustodySpec(input: GrOwnerNativeCustody) {
  if (
    !Number.isSafeInteger(input.ownerGid) ||
    input.ownerGid <= 0 ||
    !input.author.name.trim() ||
    /[\r\n\0]/.test(input.author.name) ||
    !/^[^\s@<>]+@[^\s@<>]+$/.test(input.author.email) ||
    ![input.ownerUid, input.producerUid, input.reviewerUid].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    new Set([input.ownerUid, input.producerUid, input.reviewerUid]).size !== 3 ||
    !safePath(input.root) ||
    !input.root.startsWith("/var/lib/reliverse/gr/publication/") ||
    !safePath(input.credentialDirectory) ||
    !input.credentialDirectory.startsWith("/var/lib/reliverse/gr/credentials/") ||
    input.privateKeyFile === input.knownHostsFile ||
    ![input.privateKeyFile, input.knownHostsFile].every(
      (p) => safePath(p) && p.startsWith(input.credentialDirectory + "/"),
    ) ||
    ![input.gitExecutable, input.sshExecutable, input.launcherExecutable].every(safePath) ||
    input.gitConfigDigest !==
      `sha256:${createHash("sha256").update(renderGrOwnerNativeGitConfig(input.remoteUrl)).digest("hex")}` ||
    ![input.knownHostsDigest, input.gitConfigDigest].every(digest) ||
    !digest(input.closureFingerprint) ||
    !input.artifacts.length ||
    input.artifacts.length > 1024 ||
    new Set(input.artifacts.map((a) => a.path)).size !== input.artifacts.length ||
    input.artifacts.some(
      (a) =>
        !safePath(a.path) ||
        !digest(a.digest) ||
        !["/usr/", "/opt/reliverse/", "/var/lib/reliverse/gr/runtime/"].some((prefix) =>
          a.path.startsWith(prefix),
        ),
    ) ||
    ![input.gitExecutable, input.sshExecutable, input.launcherExecutable].every((p) =>
      input.artifacts.some((a) => a.path === p),
    )
  )
    throw deny();
}

type NativeStat = {
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly dev: number;
  readonly ino: number;
  readonly ctimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};
export function assertGrOwnerNativeDirectory(
  stat: NativeStat,
  expectedUid: number,
  privateDirectory: boolean,
) {
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== expectedUid ||
    stat.mode & 0o7022 ||
    (privateDirectory && (stat.mode & 0o777) !== 0o700)
  )
    throw deny();
}
export function assertGrOwnerNativeFile(
  stat: NativeStat,
  expectedUid: number,
  privateFile: boolean,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== expectedUid ||
    stat.nlink !== 1 ||
    stat.mode & 0o7022 ||
    (privateFile && (stat.mode & 0o777) !== 0o600)
  )
    throw deny();
}

async function directories(file: string, boundary: string, uid: number) {
  for (let p = file; ; p = path.dirname(p)) {
    const expected = p === boundary || p.startsWith(boundary + "/") ? uid : 0;
    const s = await lstat(p);
    assertGrOwnerNativeDirectory(s, expected, p === boundary);
    if (p === "/") break;
  }
}
/** Invocation-local reuse of a verified immutable ROOT artifact, not Auth/Gate
 * caching. Callers still enforce no-follow/root placement and compare held/named
 * metadata on every access; any root-admin metadata change invalidates proof. */
export function createGrRootArtifactProofMemo() {
  const proofs = new Map<string, string>();
  const identity = (
    s: Pick<
      Stats,
      "uid" | "gid" | "mode" | "nlink" | "dev" | "ino" | "size" | "ctimeMs" | "mtimeMs"
    >,
  ) =>
    s.uid === 0 && s.nlink === 1 && !(s.mode & 0o7022)
      ? [s.uid, s.gid, s.mode, s.nlink, s.dev, s.ino, s.size, s.ctimeMs, s.mtimeMs].join(":")
      : undefined;
  return {
    matches(file: string, digest: string, s: Parameters<typeof identity>[0]) {
      const key = identity(s);
      return key !== undefined && proofs.get(file + "\0" + digest) === key;
    },
    remember(file: string, digest: string, s: Parameters<typeof identity>[0]) {
      const key = identity(s);
      if (key !== undefined) proofs.set(file + "\0" + digest, key);
    },
  };
}
const artifactProofs = createGrRootArtifactProofMemo();
async function hashedFile(file: string, expectedDigest: string, uid: number) {
  const before = await lstat(file);
  assertGrOwnerNativeFile(before, uid, false);
  const f = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await f.stat();
    if (
      !opened.isFile() ||
      opened.size > 256 * 1024 * 1024 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.ctimeMs !== before.ctimeMs
    )
      throw deny();
    if (!artifactProofs.matches(file, expectedDigest, opened)) {
      const bytes = await f.readFile();
      if (
        bytes.length !== opened.size ||
        `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expectedDigest
      )
        throw deny();
    }
    const after = await f.stat(),
      named = await lstat(file);
    if (
      after.size !== opened.size ||
      after.ctimeMs !== opened.ctimeMs ||
      named.dev !== opened.dev ||
      named.ino !== opened.ino ||
      named.ctimeMs !== opened.ctimeMs
    )
      throw deny();
    artifactProofs.remember(file, expectedDigest, opened);
  } finally {
    await f.close();
  }
}

/** Concrete per-subprocess custody readback. Never admits a mutable source checkout
 * or a credential borrowed from producer HOME. Root/admin are trusted and outside
 * this DAC separation guarantee; other owner-UID processes must be admitted too. */
export async function assertGrOwnerNativeCustody(input: GrOwnerNativeCustody) {
  assertGrOwnerNativeCustodySpec(input);
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== input.ownerUid ||
    process.geteuid?.() !== input.ownerUid
  )
    throw deny();
  if (
    process.getgid?.() !== input.ownerGid ||
    process.getegid?.() !== input.ownerGid ||
    process.execPath !== input.launcherExecutable ||
    (await readlink("/proc/self/exe")) !== input.launcherExecutable
  )
    throw deny();
  const status = await readFile("/proc/self/status", "utf8");
  if (
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    ["CapEff", "CapPrm", "CapBnd", "CapInh", "CapAmb"].some(
      (f) => !new RegExp(`^${f}:\\s+0+$`, "m").test(status),
    ) ||
    (process.getgroups?.() ?? []).some((g) => g !== input.ownerGid)
  )
    throw deny();
  const image = await open("/proc/self/exe", "r");
  try {
    const actual = await image.stat(),
      named = await lstat(input.launcherExecutable);
    if (actual.dev !== named.dev || actual.ino !== named.ino || actual.ctimeMs !== named.ctimeMs)
      throw deny();
  } finally {
    await image.close();
  }
  await directories(input.root, input.root, input.ownerUid);
  await directories(path.join(input.root, ".git"), input.root, input.ownerUid);
  await directories(input.credentialDirectory, input.credentialDirectory, input.ownerUid);
  await directories(path.dirname(input.privateKeyFile), input.credentialDirectory, input.ownerUid);
  await directories(path.dirname(input.knownHostsFile), input.credentialDirectory, input.ownerUid);
  assertGrOwnerNativeFile(await lstat(input.privateKeyFile), input.ownerUid, true);
  await hashedFile(path.join(input.root, ".git/config"), input.gitConfigDigest, input.ownerUid);
  await hashedFile(input.knownHostsFile, input.knownHostsDigest, input.ownerUid);
  for (const artifact of input.artifacts) {
    await directories(path.dirname(artifact.path), "/__no_owner_directory__", 0);
    await hashedFile(artifact.path, artifact.digest, 0);
  }
}

/** A fixed SSH Git corridor, not an authority issuer or default native launcher.
 * Protected startup must bind its own admitted closure and current owner Auth,
 * review custody, CapRef and Gatehouse before calling the existing owner hosts. */
export function createGrOwnerNativeGitRuntime(input: GrOwnerNativeCustody): GrGitRuntime {
  const spec = structuredClone(input);
  assertGrOwnerNativeCustodySpec(spec);
  const artifacts = Object.freeze(spec.artifacts.map((a) => Object.freeze(a)));
  const pinned = Object.freeze({ ...spec, artifacts });
  return Object.freeze({
    root: pinned.root,
    executable: pinned.gitExecutable,
    closureFingerprint: pinned.closureFingerprint,
    env: Object.freeze({
      PATH: "/usr/bin:/bin",
      HOME: pinned.credentialDirectory,
      LC_ALL: "C",
      GIT_AUTHOR_NAME: pinned.author.name,
      GIT_COMMITTER_NAME: pinned.author.name,
      GIT_AUTHOR_EMAIL: pinned.author.email,
      GIT_COMMITTER_EMAIL: pinned.author.email,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: `${pinned.sshExecutable} -F /dev/null -o BatchMode=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o IdentitiesOnly=yes -o IdentityAgent=none -o ForwardAgent=no -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=${pinned.knownHostsFile} -i ${pinned.privateKeyFile}`,
    }),
    assertCurrent: () => assertGrOwnerNativeCustody(pinned),
  });
}

/** Fixed core composition for the existing CLI host slots. It cannot obtain Auth,
 * issue Cap authority or admit itself. Native startup supplies those trusted ports. */
export function createGrNativeReviewedOwnerCommitHost(
  input: Omit<
    Parameters<typeof createGrCampaignReviewedOwnerCommitHost>[0],
    "gitRuntime" | "ownerUid" | "contextRoot"
  > & {
    readonly custody: GrOwnerNativeCustody;
  },
) {
  return createGrCampaignReviewedOwnerCommitHost({
    ...input,
    gitRuntime: createGrOwnerNativeGitRuntime(input.custody),
    ownerUid: input.custody.ownerUid,
    contextRoot: input.custody.root,
  });
}

export function createGrNativeReviewedOwnerPushHost(
  input: Omit<
    Parameters<typeof createGrCampaignReviewedOwnerPushHost>[0],
    "gitRuntime" | "ownerUid" | "contextRoot"
  > & {
    readonly custody: GrOwnerNativeCustody;
  },
) {
  return createGrCampaignReviewedOwnerPushHost({
    ...input,
    gitRuntime: createGrOwnerNativeGitRuntime(input.custody),
    ownerUid: input.custody.ownerUid,
    contextRoot: input.custody.root,
  });
}
