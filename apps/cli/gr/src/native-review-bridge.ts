import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readlink, readdir, rmdir } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import path from "node:path";

import {
  createGatehouseP256EndorsementVerifier,
  readGatehouseP256Credential,
  resolveGatehouseP256PublicCredentialPath,
  resolveGatehouseP256PrivateCredentialPath,
} from "@reliverse/gatehouse-p256";
import {
  createDeterministicGatehouseId,
  fingerprintGatehouseValue,
  type GatehouseGateInspection,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  createGrNativeReviewBridge,
  parseGrNativeReviewRequest,
  assertGrCampaignReviewerSigningPolicy,
  type GrNativeReviewPeer,
  type GrNativeReviewReceipt,
  type GrCampaignReviewerSigningPolicy,
} from "@reliverse/gr-action-runtime";
import {
  createRvsLinuxPeerInspector,
  readRvsReviewerProtectedDocument as document,
  assertRvsReviewerRootDirectory,
  type RvsUnixPeer,
} from "@reliverse/rvs-systemd-ubuntu";

export const GR_REVIEW_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;
export const GR_REVIEW_BRIDGE_EXECUTABLE = "/usr/lib/reliverse/gr/native-review-bridge";
export const GR_REVIEW_SIGNER_EXECUTABLE = "/usr/lib/reliverse/reviewer/sign-campaign-review";
export const GR_REVIEW_OWNER_EXECUTABLE = "/usr/lib/reliverse/gr/owner-launch";
export const GR_REVIEW_BRIDGE_POLICY = "/etc/reliverse/gr/native-review-bridge.json";
export const GR_REVIEW_SIGNER_POLICY = "/etc/reliverse/gr/reviewer-signing.json";
export const GR_REVIEW_BRIDGE_UNIT = "/etc/systemd/system/reliverse-gr-native-review.service";
export const GR_REVIEW_BRIDGE_RUNTIME = "/run/reliverse-gr-native-review";
export const GR_REVIEW_BRIDGE_APPARMOR = "reliverse-gr-native-review";
export const GR_REVIEW_BRIDGE_APPARMOR_FILE = "/etc/apparmor.d/reliverse-gr-native-review";
const receipts = "/var/lib/reliverse/gr/native-review";
const registry = "/etc/reliverse/reviewer/reviewer-credentials";
const home = "/var/lib/reliverse/actors/reliverse-zed-b";
const authorityHome = home + "/campaign-reviewer-credential/private";
const denied = () => new Error("GR_NATIVE_REVIEW_HOST_NOT_ADMITTED");

/** The owning verifier runs inside Gatehouse's existing 30-second mutation lock.
 * This peer is kernel-attested by the connection handler, never request JSON. */
export function assertGrNativeReviewOwnerGateLock(
  value: Record<string, unknown>,
  owner: GrNativeReviewPeer | undefined,
  now: Date,
) {
  const begin = typeof value.acquiredAt === "string" ? Date.parse(value.acquiredAt) : NaN;
  const end = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
  if (
    !owner ||
    owner.uid !== 995 ||
    owner.gid !== 985 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    !new RegExp(`^${owner.pid}:\\d+$`).test(owner.instance) ||
    value.pid !== owner.pid ||
    typeof value.id !== "string" ||
    !/^gatehouse_lock_[a-f0-9-]{36}$/.test(value.id) ||
    Object.keys(value).sort().join(",") !== "acquiredAt,expiresAt,id,pid" ||
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    begin > now.getTime() ||
    end <= now.getTime() ||
    end - begin !== 30_000
  )
    throw denied();
}

/** Optimistic read fence, not a reader lock or permission to reclaim a writer.
 * Directory metadata also catches a lock created and removed during inspection. */
export async function inspectGrNativeUnlockedGate(
  directory: string,
  inspect: () => Promise<GatehouseGateInspection | null>,
): Promise<GatehouseGateInspection | null> {
  const absent = async () => {
    try {
      await lstat(`${directory}/.lock`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw denied();
  };
  const before = await lstat(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) throw denied();
  await absent();
  const result = await inspect();
  await absent();
  const after = await lstat(directory, { bigint: true });
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.ctimeNs !== after.ctimeNs ||
    before.mtimeNs !== after.mtimeNs
  )
    throw denied();
  await absent();
  return result;
}

/** Owner courier verification also runs before lease issuance, without a writer
 * lock. The callback must validate and recheck custody when the held route is used. */
export async function inspectGrNativeCourierGate(
  directory: string,
  owner: GrNativeReviewPeer | undefined,
  inspect: (heldOwnerLock: boolean) => Promise<GatehouseGateInspection | null>,
): Promise<GatehouseGateInspection | null> {
  if (owner) {
    let held = false;
    try {
      await lstat(`${directory}/.lock`);
      held = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (held) return inspect(true);
  }
  return inspectGrNativeUnlockedGate(directory, () => inspect(false));
}

export function assertGrNativeReviewAppArmor(label: string) {
  if (label.trim() !== `${GR_REVIEW_BRIDGE_APPARMOR} (enforce)`) throw denied();
}
type Digest = `sha256:${string}`;
export interface GrNativeReviewHostPolicy {
  readonly schema: "gr.native-review.host.v0";
  readonly signing: GrCampaignReviewerSigningPolicy;
  readonly signingPolicyFileDigest: Digest;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly unitDigest: Digest;
  readonly appArmorDigest: Digest;
  readonly ownerCredentialId: string;
  readonly ownerPublicKeyDigest: Digest;
  readonly artifacts: readonly { readonly path: string; readonly digest: Digest }[];
  readonly links: readonly { readonly path: string; readonly target: string }[];
  readonly principalDigests: { readonly owner: Digest; readonly reviewer: Digest };
  readonly principalDirectory: string;
  readonly producerHome: string;
  readonly evidenceFiles: { readonly path: string; readonly digest: Digest }[];
}
export function assertGrNativeReviewHostPath(value: string) {
  if (
    typeof value !== "string" ||
    !/^\/[A-Za-z0-9_./+-]+$/.test(value) ||
    value === "/" ||
    path.normalize(value) !== value
  )
    throw denied();
  return value;
}

export function assertGrNativeReviewHostPolicy(p: GrNativeReviewHostPolicy) {
  assertGrNativeReviewHostPath(p.principalDirectory);
  assertGrNativeReviewHostPath(p.producerHome);
  assertGrCampaignReviewerSigningPolicy(p.signing);
  const digest = (v: string) => /^sha256:[a-f0-9]{64}$/.test(v);
  const begin = Date.parse(p.createdAt),
    end = Date.parse(p.expiresAt);
  if (
    p.schema !== "gr.native-review.host.v0" ||
    !Number.isFinite(begin) ||
    !Number.isFinite(end) ||
    end <= begin ||
    end - begin > GR_REVIEW_MAX_LIFETIME_MS ||
    end > Date.parse(p.signing.intent.expiresAt) ||
    ![
      p.signingPolicyFileDigest,
      p.unitDigest,
      p.appArmorDigest,
      p.ownerPublicKeyDigest,
      p.principalDigests.owner,
      p.principalDigests.reviewer,
    ].every(digest) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.ownerCredentialId) ||
    !p.artifacts.length ||
    p.artifacts.length > 128 ||
    new Set(p.artifacts.map((a) => a.path)).size !== p.artifacts.length ||
    p.artifacts.some(
      (a) =>
        !/^\/usr\/[A-Za-z0-9_./+-]+$/.test(a.path) ||
        path.normalize(a.path) !== a.path ||
        !digest(a.digest),
    ) ||
    ![GR_REVIEW_BRIDGE_EXECUTABLE, GR_REVIEW_SIGNER_EXECUTABLE, GR_REVIEW_OWNER_EXECUTABLE].every(
      (file) => p.artifacts.some((a) => a.path === file),
    ) ||
    p.links.length > 64 ||
    new Set(p.links.map((a) => a.path)).size !== p.links.length ||
    p.links.some(
      (a) =>
        !/^\/(?:usr\/[A-Za-z0-9_./+-]+|lib|lib64)$/.test(a.path) ||
        path.normalize(a.path) !== a.path ||
        !a.target ||
        /[\r\n\0]/.test(a.target),
    ) ||
    p.evidenceFiles.length !== 3 ||
    new Set(p.evidenceFiles.map((a) => a.path)).size !== 3 ||
    p.evidenceFiles.some(
      (a) =>
        !/^\/var\/lib\/reliverse\/(?:review-packages|review-tree-proofs|gr\/review-evidence)\/[A-Za-z0-9_./+-]+$/.test(
          a.path,
        ) ||
        path.normalize(a.path) !== a.path ||
        !digest(a.digest),
    ) ||
    [
      p.signing.evidence.manifestDigest,
      p.signing.evidence.treeProofDigest,
      p.signing.evidence.reportDigest,
    ].some((d) => !p.evidenceFiles.some((a) => a.digest === d))
  )
    throw denied();
}
export function assertGrNativeReviewPrincipal(
  loaded: { readonly digest: string; readonly value: Readonly<Record<string, unknown>> },
  expected: { readonly id: string; readonly kind: "human" | "agent"; readonly digest: string },
) {
  if (
    loaded.digest !== expected.digest ||
    loaded.value.schema !== "reliverse.principal.v0" ||
    loaded.value.id !== expected.id ||
    loaded.value.principalKind !== expected.kind ||
    loaded.value.status !== "active"
  )
    throw denied();
}

export const grReviewBridgeClosure = (p: GrNativeReviewHostPolicy) =>
  fingerprintGatehouseValue({
    artifacts: p.artifacts,
    links: p.links,
    unitDigest: p.unitDigest,
    appArmorDigest: p.appArmorDigest,
  });

export async function assertGrNativeReviewArtifact(file: string, expected: string) {
  await assertRvsReviewerRootDirectory(path.dirname(file));
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await h.stat();
    if (!s.isFile() || s.uid !== 0 || s.nlink !== 1 || s.mode & 0o7022 || s.size > 256 * 1024 ** 2)
      throw denied();
    const b = await h.readFile(),
      after = await h.stat(),
      named = await lstat(file);
    if (
      b.length !== s.size ||
      after.ctimeMs !== s.ctimeMs ||
      named.dev !== s.dev ||
      named.ino !== s.ino ||
      named.ctimeMs !== s.ctimeMs ||
      `sha256:${createHash("sha256").update(b).digest("hex")}` !== expected
    )
      throw denied();
  } finally {
    await h.close();
  }
}

/** No private open/read: hold no-follow directory descriptors, lstat only leaf. */
export async function inspectGrReviewerPrivateMetadata(credentialId: string) {
  const file = resolveGatehouseP256PrivateCredentialPath(authorityHome, credentialId);
  if (path.dirname(file) !== authorityHome || !/^[a-f0-9]{64}\.json$/.test(path.basename(file)))
    throw denied();
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  try {
    let fd = await open("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(fd);
    for (const part of path.dirname(file).split("/").filter(Boolean)) {
      fd = await open(
        `/proc/self/fd/${fd.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      handles.push(fd);
      const s = await fd.stat();
      if (
        !s.isDirectory() ||
        (s.uid === 994
          ? s.gid !== 984 || (s.mode & 0o7777) !== 0o700
          : s.uid !== 0 || Boolean(s.mode & 0o7022))
      )
        throw denied();
    }
    const s = await lstat(`/proc/self/fd/${fd.fd}/${path.basename(file)}`);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== 994 ||
      s.gid !== 984 ||
      s.nlink !== 1 ||
      (s.mode & 0o7777) !== 0o600 ||
      !s.size ||
      s.size > 16384
    )
      throw denied();
    return {
      uid: s.uid,
      gid: s.gid,
      mode: s.mode & 0o7777,
      nlink: s.nlink,
      dev: s.dev,
      ino: s.ino,
      ctimeMs: s.ctimeMs,
    };
  } finally {
    for (const h of handles.reverse()) await h.close();
  }
}

export async function attestGrNativeReviewPeer(
  peer: RvsUnixPeer,
  p: GrNativeReviewHostPolicy,
): Promise<GrNativeReviewPeer> {
  const executable =
    peer.uid === 994 && peer.gid === 984
      ? GR_REVIEW_SIGNER_EXECUTABLE
      : peer.uid === 995 && peer.gid === 985
        ? GR_REVIEW_OWNER_EXECUTABLE
        : undefined;
  const artifact = p.artifacts.find((a) => a.path === executable);
  if (!executable || !artifact || !Number.isSafeInteger(peer.pid) || peer.pid <= 0) throw denied();
  const proc = await open(
    `/proc/${peer.pid}`,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const held = `/proc/self/fd/${proc.fd}`;
    const start = async () => {
      const s = await readFile(`${held}/stat`, "utf8");
      const t = s.slice(s.lastIndexOf(")") + 2).split(" ")[19];
      if (!t || !/^\d+$/.test(t)) throw denied();
      return t;
    };
    const instance = `${peer.pid}:${await start()}`;
    const observe = async () => {
      const status = await readFile(`${held}/status`, "utf8");
      const uid = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(status),
        gid = /^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(status);
      const groups = /^Groups:[ \t]*(.*)$/m.exec(status)?.[1]?.trim().split(/\s+/).filter(Boolean);
      if (
        !uid ||
        !gid ||
        !uid.slice(1).every((v) => Number(v) === peer.uid) ||
        !gid.slice(1).every((v) => Number(v) === peer.gid) ||
        !groups ||
        !groups.every((v) => Number(v) === peer.gid) ||
        !/^NoNewPrivs:\s+1$/m.test(status) ||
        ["CapEff", "CapPrm", "CapInh", "CapAmb", ...(peer.uid === 995 ? ["CapBnd"] : [])].some(
          (k) => !new RegExp(`^${k}:\\s+0+$`, "m").test(status),
        ) ||
        (await readlink(`${held}/exe`)) !== executable ||
        `${peer.pid}:${await start()}` !== instance
      )
        throw denied();
    };
    await observe();
    await assertGrNativeReviewArtifact(executable, artifact.digest);
    const image = await open(`${held}/exe`, "r");
    try {
      const actual = await image.stat(),
        named = await lstat(executable);
      if (actual.dev !== named.dev || actual.ino !== named.ino || actual.ctimeMs !== named.ctimeMs)
        throw denied();
      await observe();
    } finally {
      await image.close();
    }
    return {
      uid: peer.uid as 994 | 995,
      gid: peer.gid as 984 | 985,
      pid: peer.pid,
      instance,
      executableDigest: artifact.digest,
    };
  } finally {
    await proc.close();
  }
}

async function rootWrite(file: string, value: unknown) {
  await assertRvsReviewerRootDirectory(path.dirname(file));
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (bytes.length > 16384) throw denied();
  const h = await open(file, "wx", 0o600);
  try {
    await h.writeFile(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
  const dir = await open(path.dirname(file), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
export function createGrNativeReviewJournal(gateId: string) {
  if (!/^gate_[a-f0-9]{32}$/.test(gateId)) throw denied();
  const dir = `${receipts}/${gateId}`;
  const fence = `${dir}/completion.lock`;
  let heldNonce: string | undefined;
  const sync = async () => {
    const h = await open(dir, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  };
  const read = async (name: string) =>
    (await document(`${dir}/${name}.json`, 0, 16384)).value as unknown as GrNativeReviewReceipt;
  return {
    async reserve(r: GrNativeReviewReceipt) {
      await assertRvsReviewerRootDirectory(receipts);
      await mkdir(dir, { mode: 0o700 });
      await rootWrite(`${dir}/reservation.json`, r);
      const parent = await open(receipts, "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    },
    async complete(r: GrNativeReviewReceipt) {
      const a = await read("reservation");
      if (
        a.nonce !== r.nonce ||
        a.gateId !== r.gateId ||
        a.signingPolicyDigest !== r.signingPolicyDigest
      )
        throw denied();
      try {
        await lstat(`${dir}/held.json`);
        throw denied();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await mkdir(fence, { mode: 0o700 });
      await sync();
      await rootWrite(`${dir}/completed.json`, r);
    },
    async seal(nonce: string) {
      const a = await read("reservation"),
        c = await read("completed");
      if (heldNonce || a.nonce !== nonce || c.nonce !== nonce) throw denied();
      const s = await lstat(fence);
      if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o7777) !== 0o700)
        throw denied();
      try {
        try {
          await lstat(`${dir}/held.json`);
          throw denied();
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await rootWrite(`${dir}/sealed.json`, {
          schema: "gr.native-review-seal.v0",
          nonce,
          completionDigest: fingerprintGatehouseValue(c),
        });
        if (heldNonce) throw denied();
        await rmdir(fence);
        await sync();
      } catch (cause) {
        heldNonce = nonce;
        await mkdir(fence, { mode: 0o700 }).catch(() => {});
        throw cause;
      }
    },
    async hold(nonce: string) {
      // Fail closed even if reservation readback or durable hold persistence fails.
      heldNonce = nonce;
      const a = await read("reservation");
      if (a.nonce !== nonce) throw denied();
      await mkdir(fence, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      });
      await rootWrite(`${dir}/held.json`, {
        schema: "gr.native-review-held.v0",
        nonce,
        outcome: "outcome-unknown",
      });
    },
    async read() {
      if (heldNonce) throw denied();
      try {
        for (const blocked of [`${dir}/held.json`, fence]) {
          try {
            await lstat(blocked);
            throw denied();
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        }
        const a = await read("reservation"),
          c = await read("completed");
        const seal = (await document(`${dir}/sealed.json`, 0, 16384)).value;
        if (
          seal.schema !== "gr.native-review-seal.v0" ||
          seal.nonce !== c.nonce ||
          seal.completionDigest !== fingerprintGatehouseValue(c)
        )
          throw denied();
        if (
          a.nonce !== c.nonce ||
          a.gateId !== c.gateId ||
          a.signingPolicyDigest !== c.signingPolicyDigest ||
          a.bridgeClosureDigest !== c.bridgeClosureDigest ||
          fingerprintGatehouseValue(a.reviewer) !== fingerprintGatehouseValue(c.reviewer)
        )
          throw denied();
        if (heldNonce) throw denied();
        return c;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
  };
}

/** Socket handler keeps the actual kernel peer alive across each native/core
 * observation. No caller identity/PID/path, multiple in-flight frames or retries. */
export function createGrNativeReviewConnectionHandler(
  bridge: ReturnType<typeof createGrNativeReviewBridge>,
  withPeer: <T>(socket: Socket, observe: (peer: GrNativeReviewPeer) => Promise<T>) => Promise<T>,
  role: 994 | 995,
) {
  let active = 0;
  return (socket: Socket) => {
    if (active >= 4) {
      socket.destroy();
      return;
    }
    active++;
    const handle = bridge.connection();
    let pending = false,
      count = 0,
      bytes = Buffer.alloc(0),
      dead = false;
    socket.on("close", () => {
      active--;
    });
    const abort = () => {
      if (!dead) void handle.hold().catch(() => {});
      dead = true;
      socket.destroy();
    };
    socket.on("error", abort);
    socket.on("end", abort);
    socket.setTimeout(120000, abort);
    socket.on("data", (chunk: Buffer) => {
      if (dead || pending || bytes.length + chunk.length > 16384) {
        dead = true;
        void handle.hold().catch(() => {});
        socket.destroy();
        return;
      }
      bytes = Buffer.concat([bytes, chunk]);
      if (!bytes.includes(10)) return;
      let request: ReturnType<typeof parseGrNativeReviewRequest>;
      try {
        if (++count > 64) throw denied();
        request = parseGrNativeReviewRequest(bytes);
      } catch {
        dead = true;
        void handle.hold().catch(() => {});
        socket.destroy();
        return;
      }
      bytes = Buffer.alloc(0);
      pending = true;
      void withPeer(socket, async (peer) => {
        if (peer.uid !== role) throw denied();
        return handle(request, peer);
      })
        .then(async (result) => {
          if (socket.destroyed || dead) {
            await handle.hold();
            return;
          }
          if (request.operation === "finish") await handle.seal();
          if (socket.destroyed || dead) {
            await handle.hold();
            return;
          }
          handle.assertPublishable();
          const text = JSON.stringify({ ok: true, result });
          if (Buffer.byteLength(text) > 256 * 1024) throw denied();
          pending = false;
          if (request.operation === "finish") dead = true;
          // Keep the connection alive until the client finishes its held-root-peer
          // observation. Client closes after validating the completion frame.
          socket.write(text + "\n");
        })
        .catch(async () => {
          dead = true;
          await handle.hold().catch(() => {});
          if (!socket.destroyed) socket.end('{"ok":false,"error":"GR_NATIVE_REVIEW_HELD"}\n');
        });
    });
  };
}

export async function startGrNativeReviewBridge(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--identity")
    return {
      schema: "gr.native-review.executor.v0",
      signing: false,
      authorityGranted: false,
      gitExecutionAdmitted: false,
    };
  if (
    args.length !== 1 ||
    args[0] !== "start" ||
    process.platform !== "linux" ||
    process.getuid?.() !== 0 ||
    process.geteuid?.() !== 0 ||
    process.getgid?.() !== 0 ||
    process.execPath !== GR_REVIEW_BRIDGE_EXECUTABLE ||
    process.env.LISTEN_PID !== String(process.pid) ||
    process.env.LISTEN_FDS !== "2" ||
    [
      "BUN_OPTIONS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "SSH_AUTH_SOCK",
      "CREDENTIALS_DIRECTORY",
    ].some((k) => process.env[k] !== undefined)
  )
    throw denied();
  const names = process.env.LISTEN_FDNAMES?.split(":");
  if (!names || names.length !== 2 || [...names].sort().join(",") !== "owner,reviewer")
    throw denied();
  const loaded = await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2),
    p = loaded.value as unknown as GrNativeReviewHostPolicy;
  assertGrNativeReviewHostPolicy(p);
  const gateId = createDeterministicGatehouseId("gate", p.signing.intent.id);
  const gateHome = `/var/lib/reliverse/gr/gatehouse/${p.signing.bindings.plan.campaignFingerprint}`;
  const publicPath = resolveGatehouseP256PublicCredentialPath(
    registry,
    p.signing.bindings.review.credentialId,
  );
  const gatehouse = createGatehouseRuntime({ home: gateHome });
  const assertCurrent = async () => {
    if (
      (await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2)).digest !== loaded.digest ||
      (await document(GR_REVIEW_SIGNER_POLICY, 0, 2 * 1024 ** 2)).digest !==
        p.signingPolicyFileDigest ||
      (await readlink("/proc/self/exe")) !== GR_REVIEW_BRIDGE_EXECUTABLE ||
      (await readFile("/proc/self/cgroup", "utf8")).trim() !==
        "0::/system.slice/reliverse-gr-native-review.service"
    )
      throw denied();
    if (
      fingerprintGatehouseValue(
        (await document(GR_REVIEW_SIGNER_POLICY, 0, 2 * 1024 ** 2)).value,
      ) !== fingerprintGatehouseValue(p.signing)
    )
      throw denied();
    const status = await readFile("/proc/self/status", "utf8");
    if (
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      ["CapEff", "CapPrm", "CapBnd"].some(
        (k) => !new RegExp(`^${k}:\\s+0*80004$`, "m").test(status),
      ) ||
      ["CapInh", "CapAmb"].some((k) => !new RegExp(`^${k}:\\s+0+$`, "m").test(status))
    )
      throw denied();
    if (Date.now() < Date.parse(p.createdAt) || Date.now() >= Date.parse(p.expiresAt))
      throw denied();
    assertGrNativeReviewAppArmor(await readFile("/proc/self/attr/apparmor/current", "utf8"));
    await assertGrNativeReviewArtifact(GR_REVIEW_BRIDGE_APPARMOR_FILE, p.appArmorDigest);
    await assertGrNativeReviewArtifact(GR_REVIEW_BRIDGE_UNIT, p.unitDigest);
    for (const a of p.artifacts) await assertGrNativeReviewArtifact(a.path, a.digest);
    for (const link of p.links) {
      await assertRvsReviewerRootDirectory(path.dirname(link.path));
      const s = await lstat(link.path);
      if (!s.isSymbolicLink() || s.uid !== 0 || (await readlink(link.path)) !== link.target)
        throw denied();
    }
    const image = await open("/proc/self/exe", "r");
    try {
      const a = await image.stat(),
        b = await lstat(GR_REVIEW_BRIDGE_EXECUTABLE);
      if (a.dev !== b.dev || a.ino !== b.ino || a.ctimeMs !== b.ctimeMs) throw denied();
    } finally {
      await image.close();
    }
    const review = p.signing.bindings.review;
    for (const [id, expected, kind] of [
      [review.ownerPrincipalId, p.principalDigests.owner, "human"],
      [review.reviewerPrincipalId, p.principalDigests.reviewer, "agent"],
    ] as const) {
      const d = await document(`${p.principalDirectory}/${id}/principal.json`, 1000);
      assertGrNativeReviewPrincipal(d, { id, kind, digest: expected });
    }
    const enrollment = (
      await document(
        `/var/lib/reliverse/rvs/reviewer-account/enrollments/${review.reviewerPrincipalId}/enrollment.json`,
        0,
      )
    ).value;
    if (
      enrollment.schema !== "rvs.reviewer.enrollment.v0" ||
      enrollment.status !== "active" ||
      enrollment.agent?.status !== "active" ||
      enrollment.agent?.ownerPrincipalId !== review.ownerPrincipalId ||
      enrollment.credentialId !== review.credentialId ||
      enrollment.publicKeyDigest !== review.publicKeyDigest ||
      enrollment.actorBinding?.status !== "active" ||
      enrollment.actorBinding?.revokedAt !== undefined ||
      enrollment.actorBinding?.boundByPrincipalId !== review.ownerPrincipalId ||
      enrollment.actorBinding?.principal?.id !== review.reviewerPrincipalId ||
      enrollment.actorBinding?.actor?.id !== "os-user.uid-994" ||
      fingerprintGatehouseValue(enrollment.actorBinding) !== review.actorBindingDigest ||
      fingerprintGatehouseValue(enrollment.executionIdentity) !== review.executionIdentityDigest ||
      enrollment.executionIdentity?.uid !== 994 ||
      enrollment.executionIdentity?.gid !== 984 ||
      enrollment.executionIdentity?.publicKeyDigest !== review.publicKeyDigest
    )
      throw denied();
    const admission = enrollment.admission;
    if (
      !/^gate_[a-f0-9]{32}$/.test(admission?.gateId) ||
      !/^consumption_[a-f0-9]{32}$/.test(admission?.consumptionId)
    )
      throw denied();
    const original = `/var/lib/reliverse/rvs/reviewer-account/gatehouse/gates/${admission.gateId}`;
    const [g, e] = await Promise.all([
      document(`${original}/gate.json`, 0),
      document(`${original}/execution.json`, 0),
    ]);
    if (
      g.value.status !== "completed" ||
      g.value.intentDigest !== admission.intentDigest ||
      e.value.outcome !== "completed" ||
      e.value.gateId !== admission.gateId ||
      e.value.consumptionId !== admission.consumptionId
    )
      throw denied();
    await document(publicPath, 0, 16384);
    const key = await readGatehouseP256Credential(registry, review.credentialId);
    if (
      key.status !== "active" ||
      key.principalId !== review.reviewerPrincipalId ||
      key.publicKeyDigest !== review.publicKeyDigest ||
      Date.parse(key.expiresAt) < Date.parse(p.signing.credentialExpiresAt)
    )
      throw denied();
    const ownerRegistry = "/etc/reliverse/reviewer/owner-credentials";
    await document(
      resolveGatehouseP256PublicCredentialPath(ownerRegistry, p.ownerCredentialId),
      0,
      16384,
    );
    const ownerKey = await readGatehouseP256Credential(ownerRegistry, p.ownerCredentialId);
    if (
      ownerKey.status !== "active" ||
      ownerKey.principalId !== review.ownerPrincipalId ||
      ownerKey.publicKeyDigest !== p.ownerPublicKeyDigest ||
      Date.parse(ownerKey.expiresAt) < Date.parse(p.signing.intent.expiresAt)
    )
      throw denied();
    await inspectGrReviewerPrivateMetadata(review.credentialId);
    for (const evidence of p.evidenceFiles)
      await assertGrNativeReviewArtifact(evidence.path, evidence.digest);
  };
  await assertCurrent();
  const inspectGate = async (owner?: GrNativeReviewPeer) => {
    const dir = `${gateHome}/gates/${gateId}`;
    const inspect = async (heldOwnerLock: boolean) => {
      const readOwnLock = async () => {
        if (!owner) throw denied();
        const file = `${dir}/.lock`;
        const before = await lstat(file);
        if (
          !before.isDirectory() ||
          before.isSymbolicLink() ||
          before.uid !== 995 ||
          before.gid !== 985 ||
          (before.mode & 0o7777) !== 0o700 ||
          (await readdir(file)).sort().join(",") !== "lock.json"
        )
          throw denied();
        const loaded = await document(`${file}/lock.json`, 995, 16384);
        assertGrNativeReviewOwnerGateLock(loaded.value, owner, new Date());
        const after = await lstat(file);
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.ctimeMs !== after.ctimeMs
        )
          throw denied();
        return { digest: loaded.digest, dev: after.dev, ino: after.ino, ctimeMs: after.ctimeMs };
      };
      let lock: Awaited<ReturnType<typeof readOwnLock>> | undefined;
      for (const file of await readdir(dir)) {
        if (file === ".lock") {
          if (!heldOwnerLock) throw denied();
          lock = await readOwnLock();
          continue;
        }
        if (["endorsements", "decisions", "revocations"].includes(file)) {
          const s = await lstat(`${dir}/${file}`);
          if (!s.isDirectory() || s.isSymbolicLink() || ![0, 995].includes(s.uid) || s.mode & 0o022)
            throw denied();
          const names = await readdir(`${dir}/${file}`);
          if (names.length > 64) throw denied();
          for (const name of names) {
            if (!/^[A-Za-z0-9_.-]+\.json$/.test(name)) throw denied();
            await document(`${dir}/${file}/${name}`, s.uid, 16384);
          }
        } else {
          if (
            ![
              "intent.json",
              "gate.json",
              "approval.json",
              "lease.json",
              "consumption.json",
              "execution.json",
            ].includes(file)
          )
            throw denied();
          const s = await lstat(`${dir}/${file}`);
          if (![0, 995].includes(s.uid)) throw denied();
          await document(`${dir}/${file}`, s.uid);
        }
      }
      if (heldOwnerLock && !lock) throw denied();
      const inspection = (await gatehouse.inspectGate(gateId)) ?? null;
      if (
        lock &&
        fingerprintGatehouseValue(await readOwnLock()) !== fingerprintGatehouseValue(lock)
      )
        throw denied();
      return inspection;
    };
    return inspectGrNativeCourierGate(dir, owner, inspect);
  };
  const reviewerVerifier = createGatehouseP256EndorsementVerifier({ registryHome: registry });
  const ownerVerifier = createGatehouseP256EndorsementVerifier({
    registryHome: "/etc/reliverse/reviewer/owner-credentials",
  });
  const bridge = createGrNativeReviewBridge(
    { signing: p.signing, bridgeClosureDigest: grReviewBridgeClosure(p), expiresAt: p.expiresAt },
    {
      now: () => new Date(),
      assertCurrent,
      inspectGate,
      journal: createGrNativeReviewJournal(gateId),
      verifier: {
        id: "gr-native-canonical-public-verifier",
        verify: async (input) => {
          if (
            input.endorsement.principalId === p.signing.bindings.review.ownerPrincipalId &&
            input.endorsement.credentialId === p.ownerCredentialId
          )
            return ownerVerifier.verify(input);
          if (
            input.endorsement.principalId === p.signing.bindings.review.reviewerPrincipalId &&
            input.endorsement.credentialId === p.signing.bindings.review.credentialId
          )
            return reviewerVerifier.verify(input);
          throw denied();
        },
      },
    },
  );
  const native = await createRvsLinuxPeerInspector();
  native.protectMemory();
  const servers: ReturnType<typeof createServer>[] = [];
  try {
    for (const [index, name] of names.entries()) {
      const uid = name === "reviewer" ? 994 : 995;
      const socketPath = `${GR_REVIEW_BRIDGE_RUNTIME}/${name}.sock`,
        s = await lstat(socketPath);
      await assertRvsReviewerRootDirectory(GR_REVIEW_BRIDGE_RUNTIME);
      if (!s.isSocket() || s.uid !== uid || (s.mode & 0o7777) !== 0o600) throw denied();
      const handler = createGrNativeReviewConnectionHandler(
        bridge,
        (socket, observe) =>
          native.withPeerProcess(socket, async (peer) => {
            await assertCurrent();
            const before = await attestGrNativeReviewPeer(peer, p);
            const result = await observe(before);
            const after = await attestGrNativeReviewPeer(peer, p);
            if (fingerprintGatehouseValue(before) !== fingerprintGatehouseValue(after))
              throw denied();
            return result;
          }),
        uid,
      );
      const server = createServer({ allowHalfOpen: true }, handler);
      servers.push(server);
      await new Promise<void>((resolve, reject) =>
        server.listen({ fd: index + 3 }, resolve).once("error", reject),
      );
    }
    const close = () => {
      for (const server of servers) server.close();
      native.close();
    };
    const timer = setTimeout(close, Math.max(1, Date.parse(p.expiresAt) - Date.now()));
    timer.unref();
    for (const server of servers) server.on("error", close);
    return { close };
  } catch {
    for (const server of servers) server.close();
    native.close();
    throw denied();
  }
}
