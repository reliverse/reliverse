import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { createAuthFramework, type AuthIntentV0, type AuthSessionV0 } from "@reliverse/auth";
import { createProtectedAuthSessionStore } from "@reliverse/auth-bun";
import { fingerprintGatehouseValue } from "@reliverse/gatehouse-protocol";
import { createGrRootArtifactProofMemo } from "@reliverse/gr-action-runtime";
import {
  createRvsProtectedOwnerTerminalAuthBackend,
  readRvsReviewerProtectedDocument,
  assertRvsReviewerRootDirectory,
  type ProtectedOwnerAuthPolicy,
} from "@reliverse/rvs-systemd-ubuntu";

export const GR_OWNER_AUTH_EXECUTABLE = "/usr/lib/reliverse/gr/owner-auth";
export const GR_OWNER_AUTH_POLICY = "/etc/reliverse/gr/owner-auth.json";
export const GR_OWNER_AUTH_DIRECTORY = "/var/lib/reliverse/gr/auth/owner";
const enrollmentFile = "/etc/reliverse/secret-broker/owner-control.json";
const issuer = "gr.protected-owner-terminal";
const audience = "gr.owner-control";
const resource = "github:reliverse/reliverse";
const denied = () => new Error("GR_OWNER_AUTH_NOT_ADMITTED");
type Digest = `sha256:${string}`;
export interface GrOwnerAuthPolicy {
  readonly schema: "gr.owner-auth.host.v0";
  readonly ownerEnrollmentDigest: Digest;
  readonly ownerPrincipalId: string;
  readonly passwdDigest: Digest;
  readonly groupDigest: Digest;
  readonly author: { readonly name: string; readonly email: string };
  readonly artifacts: readonly { readonly path: string; readonly digest: Digest }[];
  readonly links: readonly { readonly path: string; readonly target: string }[];
}
export function assertGrOwnerAuthPolicy(p: GrOwnerAuthPolicy) {
  const digest = (v: string) => /^sha256:[a-f0-9]{64}$/.test(v);
  if (
    p.schema !== "gr.owner-auth.host.v0" ||
    ![p.ownerEnrollmentDigest, p.passwdDigest, p.groupDigest].every(digest) ||
    !/^prn_[a-f0-9]{32}$/.test(p.ownerPrincipalId) ||
    !p.author.name.trim() ||
    /[\r\n\0<>]/.test(p.author.name) ||
    !/^[^\s@<>\0]+@[^\s@<>\0]+$/.test(p.author.email) ||
    !p.artifacts.length ||
    p.artifacts.length > 128 ||
    p.links.length > 64 ||
    new Set(p.artifacts.map((a) => a.path)).size !== p.artifacts.length ||
    p.artifacts.some(
      (a) =>
        !/^\/usr\/[A-Za-z0-9_./+-]+$/.test(a.path) ||
        path.normalize(a.path) !== a.path ||
        !digest(a.digest),
    ) ||
    !p.artifacts.some((a) => a.path === GR_OWNER_AUTH_EXECUTABLE) ||
    new Set(p.links.map((a) => a.path)).size !== p.links.length ||
    p.links.some(
      (a) =>
        !/^\/(?:usr\/[A-Za-z0-9_./+-]+|lib|lib64)$/.test(a.path) ||
        path.normalize(a.path) !== a.path ||
        !a.target ||
        /[\r\n\0]/.test(a.target),
    )
  )
    throw denied();
}
export function grOwnerAuthProfile(
  binding: ProtectedOwnerAuthPolicy["binding"],
): ProtectedOwnerAuthPolicy {
  if (binding.actor.id !== "os-user.uid-995" || binding.provider.subject !== "uid:995")
    throw denied();
  return {
    binding,
    ownerUid: 995,
    agentUid: 999,
    brokerUid: 996,
    issuer,
    scopes: ["identity.observe"],
    audiences: [audience],
    resources: [resource],
  };
}
export function assertGrOwnerAuthSession(
  session: AuthSessionV0,
  profile: ProtectedOwnerAuthPolicy,
  now: Date,
) {
  if (
    session.schema !== "reliverse.auth.session.v0" ||
    session.principal.id !== profile.binding.principal.id ||
    session.principal.kind !== "human" ||
    session.client.id !== profile.binding.actor.id ||
    session.client.kind !== "confidential" ||
    session.issuer !== issuer ||
    session.assurance !== "verified" ||
    session.status !== "active" ||
    JSON.stringify(session.scopes) !== JSON.stringify(profile.scopes) ||
    JSON.stringify(session.audiences) !== JSON.stringify(profile.audiences) ||
    JSON.stringify(session.resources) !== JSON.stringify(profile.resources) ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(Date.parse(session.createdAt)) ||
    Date.parse(session.createdAt) > now.getTime() ||
    !session.expiresAt ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    Date.parse(session.expiresAt) <= now.getTime() ||
    Date.parse(session.expiresAt) - Date.parse(session.createdAt) > 5 * 3600000
  )
    throw denied();
}

/** Complete Auth lifecycle over owning persistence; neither a grant issuer nor a
 * Gate/GR executor. Native startup is checked separately and on every store access. */
export async function authenticateGrOwner(
  profile: ProtectedOwnerAuthPolicy,
  ports: {
    readonly now: () => Date;
    readonly attest: Parameters<typeof createRvsProtectedOwnerTerminalAuthBackend>[1]["attest"];
    readonly sessions: Pick<
      ReturnType<typeof createProtectedAuthSessionStore>,
      "readActive" | "currentId" | "publish"
    >;
  },
  options: { readonly reauthenticate?: boolean } = {},
) {
  const policy = structuredClone(profile);
  if (
    fingerprintGatehouseValue(policy) !==
    fingerprintGatehouseValue(grOwnerAuthProfile(policy.binding))
  )
    throw denied();
  const attest = async () => {
    const proof = await ports.attest();
    if (
      proof.uid !== 995 ||
      proof.euid !== 995 ||
      proof.ttyUid !== 995 ||
      !proof.tty ||
      !proof.noNewPrivileges ||
      !/^0+$/.test(proof.effectiveCapabilities) ||
      !proof.bindingDigestVerified ||
      !proof.executableAndPolicyVerified
    )
      throw denied();
    return proof;
  };
  // Construct on reuse too: owning UF/Auth structural/current-binding checks
  // must not disappear merely because a previously issued session is active.
  let previousForPublication: string | null | undefined;
  const backend = createRvsProtectedOwnerTerminalAuthBackend(policy, {
    now: ports.now,
    attest,
    persistSession: (fresh, assertCurrent) => {
      if (previousForPublication === undefined) throw denied();
      return ports.sessions.publish(fresh, assertCurrent, previousForPublication);
    },
  });
  await attest();
  let session = await ports.sessions.readActive(ports.now());
  const sessionReused = Boolean(session);
  if (!session) {
    const previous = await ports.sessions.currentId();
    if (previous !== null && options.reauthenticate !== true)
      throw new Error("GR_OWNER_AUTH_REAUTH_REQUIRED");
    // Explicit fresh authentication, never extension/replay of the old session.
    // The owning store atomically compares the previous pointer and retains all
    // old session/revocation records. Uncertain publication still fails closed.
    previousForPublication = previous;
    const framework = createAuthFramework([backend]);
    const intent: AuthIntentV0 = {
      schema: "reliverse.auth.intent.v0",
      purpose: "sign-in",
      principal: policy.binding.principal,
      client: { id: policy.binding.actor.id, kind: "confidential" },
      issuer,
      surface: "gr-protected-owner-terminal",
      interaction: "external-engine",
      requiredAssurance: "verified",
      requestedScopes: policy.scopes,
      requestedResources: policy.resources.map((id) => ({ id })),
      requestedAudiences: policy.audiences.map((id) => ({ id })),
    };
    const plan = framework.plan(intent, {
      backendId: backend.id,
      methodId: "protected-owner-terminal",
    });
    const challenge = (await framework.begin(plan))[0]!;
    const result = await framework.complete(plan, {
      kind: "protected-os-observation",
      reference: challenge.id,
      issuer,
      subject: policy.binding.provider.subject,
      assurance: "verified",
    });
    if (result.outcome.kind !== "session") throw denied();
    session = result.outcome.session;
  }
  assertGrOwnerAuthSession(session, policy, ports.now());
  await attest();
  const current = await ports.sessions.readActive(ports.now());
  if (!current || fingerprintGatehouseValue(current) !== fingerprintGatehouseValue(session))
    throw denied();
  assertGrOwnerAuthSession(current, policy, ports.now());
  return {
    schema: "gr.owner-authentication.v0" as const,
    principalId: current.principal.id,
    actorId: current.client.id,
    authenticationSession: current.id,
    sessionReused,
    expiresAt: current.expiresAt,
    scopes: current.scopes,
    audiences: current.audiences,
    resources: current.resources,
    authorityGranted: false,
    gitExecutionAdmitted: false,
    campaignApproved: false,
  };
}

const artifactProofs = createGrRootArtifactProofMemo();
async function artifact(file: string, digest: Digest) {
  await assertRvsReviewerRootDirectory(path.dirname(file));
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await h.stat();
    if (
      !before.isFile() ||
      before.uid !== 0 ||
      before.nlink !== 1 ||
      before.mode & 0o7022 ||
      before.size > 256 * 1024 ** 2
    )
      throw denied();
    if (!artifactProofs.matches(file, digest, before)) {
      const bytes = await h.readFile();
      if (
        bytes.length !== before.size ||
        `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== digest
      )
        throw denied();
    }
    const after = await h.stat(),
      named = await lstat(file);
    if (
      after.size !== before.size ||
      after.ctimeMs !== before.ctimeMs ||
      named.dev !== before.dev ||
      named.ino !== before.ino ||
      named.ctimeMs !== before.ctimeMs
    )
      throw denied();
    artifactProofs.remember(file, digest, before);
  } finally {
    await h.close();
  }
}

export async function assertGrOwnerAuthArtifacts(policy: GrOwnerAuthPolicy) {
  assertGrOwnerAuthPolicy(policy);
  await artifact("/etc/passwd", policy.passwdDigest);
  await artifact("/etc/group", policy.groupDigest);
  for (const a of policy.artifacts) await artifact(a.path, a.digest);
  for (const link of policy.links) {
    await assertRvsReviewerRootDirectory(path.dirname(link.path));
    const s = await lstat(link.path);
    if (!s.isSymbolicLink() || s.uid !== 0 || (await readlink(link.path)) !== link.target)
      throw denied();
  }
}

/** Source execution intentionally fails before reading policy or opening a store. */
export async function runGrOwnerAuthentication(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--identity")
    return {
      schema: "gr.owner-auth.executor.v0",
      authorityGranted: false,
      gitExecutionAdmitted: false,
    };
  if (
    args.length !== 1 ||
    !["authenticate", "reauthenticate"].includes(args[0]!) ||
    process.platform !== "linux" ||
    process.getuid?.() !== 995 ||
    process.geteuid?.() !== 995 ||
    process.getgid?.() !== 985 ||
    process.getegid?.() !== 985 ||
    (process.getgroups?.() ?? []).some((g) => g !== 985) ||
    process.execPath !== GR_OWNER_AUTH_EXECUTABLE ||
    [
      "BUN_OPTIONS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "SSH_AUTH_SOCK",
    ].some((k) => process.env[k] !== undefined)
  )
    throw denied();
  const loaded = await readRvsReviewerProtectedDocument(GR_OWNER_AUTH_POLICY, 0);
  const policy = loaded.value as unknown as GrOwnerAuthPolicy;
  assertGrOwnerAuthPolicy(policy);
  const enrollment = await readRvsReviewerProtectedDocument(enrollmentFile, 0);
  const record = enrollment.value as unknown as ProtectedOwnerAuthPolicy & {
    schema: string;
    authenticationEnabled: boolean;
  };
  if (
    enrollment.digest !== policy.ownerEnrollmentDigest ||
    record.schema !== "rvs.secret-broker.owner-control-enrollment.v0" ||
    record.authenticationEnabled !== true ||
    record.ownerUid !== 995 ||
    record.agentUid !== 999 ||
    record.brokerUid !== 996 ||
    record.binding.principal.id !== policy.ownerPrincipalId
  )
    throw denied();
  const profile = grOwnerAuthProfile(record.binding);
  const attest = async () => {
    if (
      (await readRvsReviewerProtectedDocument(GR_OWNER_AUTH_POLICY, 0)).digest !== loaded.digest ||
      (await readRvsReviewerProtectedDocument(enrollmentFile, 0)).digest !== enrollment.digest ||
      (await readlink("/proc/self/exe")) !== GR_OWNER_AUTH_EXECUTABLE ||
      !process.stdin.isTTY ||
      !process.stderr.isTTY
    )
      throw denied();
    const image = await open("/proc/self/exe", "r");
    try {
      const a = await image.stat(),
        n = await lstat(GR_OWNER_AUTH_EXECUTABLE);
      if (a.dev !== n.dev || a.ino !== n.ino || a.ctimeMs !== n.ctimeMs) throw denied();
    } finally {
      await image.close();
    }
    for (const fd of [0, 2]) {
      const h = await open(`/proc/self/fd/${fd}`, "r");
      try {
        const s = await h.stat();
        if (!s.isCharacterDevice() || s.uid !== 995) throw denied();
      } finally {
        await h.close();
      }
    }
    const status = await readFile("/proc/self/status", "utf8");
    if (
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      ["CapEff", "CapPrm", "CapBnd", "CapInh", "CapAmb"].some(
        (k) => !new RegExp(`^${k}:\\s+0+$`, "m").test(status),
      )
    )
      throw denied();
    await assertGrOwnerAuthArtifacts(policy);
    return {
      uid: 995,
      euid: 995,
      ttyUid: 995,
      tty: true,
      noNewPrivileges: true,
      effectiveCapabilities: "0",
      bindingDigestVerified: true,
      executableAndPolicyVerified: true,
    };
  };
  const assertLocation = async () => {
    await attest();
    await assertRvsReviewerRootDirectory(path.dirname(GR_OWNER_AUTH_DIRECTORY));
    const s = await lstat(GR_OWNER_AUTH_DIRECTORY);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== 995 ||
      s.gid !== 985 ||
      (s.mode & 0o7777) !== 0o700
    )
      throw denied();
  };
  await assertLocation();
  const sessions = createProtectedAuthSessionStore({
    directory: GR_OWNER_AUTH_DIRECTORY,
    assertLocation,
  });
  return authenticateGrOwner(
    profile,
    { now: () => new Date(), attest, sessions },
    {
      reauthenticate: args[0] === "reauthenticate",
    },
  );
}
