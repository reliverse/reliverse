import { lstat, readFile, readlink } from "node:fs/promises";
import { createConnection } from "node:net";

import {
  fingerprintGatehouseValue,
  type GatehouseVerifiedEndorsement,
  type GatehouseEndorsementSubmission,
  type GatehouseGateInspection,
} from "@reliverse/gatehouse-protocol";
import type {
  GrNativeReviewRequest,
  GrNativeReviewReceipt,
  GrCampaignReview,
} from "@reliverse/gr-action-runtime";
import {
  createRvsLinuxPeerInspector,
  readRvsReviewerProtectedDocument as document,
  assertRvsReviewerRootDirectory,
} from "@reliverse/rvs-systemd-ubuntu";

import {
  GR_REVIEW_BRIDGE_POLICY,
  GR_REVIEW_BRIDGE_RUNTIME,
  GR_REVIEW_SIGNER_EXECUTABLE,
  GR_REVIEW_OWNER_EXECUTABLE,
  assertGrNativeReviewHostPolicy,
  assertGrNativeReviewArtifact,
  type GrNativeReviewHostPolicy,
} from "./native-review-bridge";

const denied = () => new Error("GR_NATIVE_REVIEW_CHANNEL_REFUSED");
export async function assertGrNativeReviewClient(
  role: "reviewer" | "owner",
  p: GrNativeReviewHostPolicy,
) {
  const uid = role === "reviewer" ? 994 : 995,
    gid = role === "reviewer" ? 984 : 985;
  const executable = role === "reviewer" ? GR_REVIEW_SIGNER_EXECUTABLE : GR_REVIEW_OWNER_EXECUTABLE;
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== uid ||
    process.geteuid?.() !== uid ||
    process.getgid?.() !== gid ||
    process.getegid?.() !== gid ||
    (process.getgroups?.() ?? []).some((g) => g !== gid) ||
    process.execPath !== executable ||
    (await readlink("/proc/self/exe")) !== executable ||
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
  const status = await readFile("/proc/self/status", "utf8");
  if (
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    ["CapEff", "CapPrm", "CapInh", "CapAmb", ...(role === "owner" ? ["CapBnd"] : [])].some(
      (k) => !new RegExp(`^${k}:\\s+0+$`, "m").test(status),
    )
  )
    throw denied();
  assertGrNativeReviewHostPolicy(p);
  for (const a of p.artifacts) await assertGrNativeReviewArtifact(a.path, a.digest);
  for (const link of p.links) {
    await assertRvsReviewerRootDirectory(link.path.slice(0, link.path.lastIndexOf("/")) || "/");
    const s = await lstat(link.path);
    if (!s.isSymbolicLink() || s.uid !== 0 || (await readlink(link.path)) !== link.target)
      throw denied();
  }
}

/** No producer-selected endpoint or peer identity. Root owns the socket parent;
 * kernel root credentials + held SO_PEERPIDFD are checked for each exchange. */
export async function connectGrNativeReview(role: "reviewer" | "owner") {
  // Refuse source/ordinary UID before policy/store/socket access.
  const uid = role === "reviewer" ? 994 : 995;
  if (
    process.getuid?.() !== uid ||
    process.geteuid?.() !== uid ||
    process.execPath !==
      (role === "reviewer" ? GR_REVIEW_SIGNER_EXECUTABLE : GR_REVIEW_OWNER_EXECUTABLE)
  )
    throw denied();
  const loaded = await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2),
    policy = loaded.value as unknown as GrNativeReviewHostPolicy;
  await assertGrNativeReviewClient(role, policy);
  await assertRvsReviewerRootDirectory(GR_REVIEW_BRIDGE_RUNTIME);
  const pathname = `${GR_REVIEW_BRIDGE_RUNTIME}/${role}.sock`,
    named = await lstat(pathname);
  if (!named.isSocket() || named.uid !== uid || (named.mode & 0o7777) !== 0o600) throw denied();
  const native = await createRvsLinuxPeerInspector();
  native.protectMemory();
  const socket = createConnection({ path: pathname });
  let waiting: { resolve: (v: unknown) => void; reject: (e: Error) => void } | undefined;
  let buffer = Buffer.alloc(0),
    closed = false,
    busy = false;
  const close = () => {
    if (closed) return;
    closed = true;
    waiting?.reject(denied());
    waiting = undefined;
    socket.destroy();
    native.close();
  };
  socket.on("error", close);
  socket.on("close", close);
  socket.setTimeout(30000, close);
  socket.on("data", (chunk: Buffer) => {
    if (!waiting || buffer.length + chunk.length > 256 * 1024) {
      close();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.includes(10)) return;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (text.indexOf("\n") !== text.length - 1) throw denied();
      const value = JSON.parse(text);
      const pending = waiting;
      waiting = undefined;
      buffer = Buffer.alloc(0);
      if (!value || value.ok !== true || !value.result) {
        pending.reject(denied());
        close();
        return;
      }
      pending.resolve(value.result);
    } catch {
      close();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
  } catch {
    close();
    throw denied();
  }
  return {
    policy,
    async request(request: GrNativeReviewRequest): Promise<Record<string, unknown>> {
      if (closed || busy) throw denied();
      busy = true;
      try {
        if ((await document(GR_REVIEW_BRIDGE_POLICY, 0, 2 * 1024 ** 2)).digest !== loaded.digest)
          throw denied();
        await assertGrNativeReviewClient(role, policy);
        const result = await native.withPeerProcess(socket, async (peer) => {
          if (peer.uid !== 0 || peer.gid !== 0) throw denied();
          return await new Promise<unknown>((resolve, reject) => {
            const bytes = JSON.stringify(request) + "\n";
            if (Buffer.byteLength(bytes) > 16384 || waiting) {
              reject(denied());
              return;
            }
            waiting = { resolve, reject };
            socket.write(bytes);
          });
        });
        if (
          !result ||
          typeof result !== "object" ||
          (result as { operation?: string }).operation !== request.operation
        )
          throw denied();
        return result as Record<string, unknown>;
      } catch {
        close();
        throw denied();
      } finally {
        busy = false;
      }
    },
    close,
  };
}

/** Native owner startup supplies this verifier/custody reader, not courier JSON.
 * Canonical Gatehouse still owns endorsement submission, approval and consumption. */
export function createGrNativeOwnerReviewPorts(
  channel: Awaited<ReturnType<typeof connectGrNativeReview>>,
) {
  const expected = fingerprintGatehouseValue(channel.policy.signing.bindings.review);
  return {
    now: () => new Date(),
    assertCustodyCurrent: async (review: GrCampaignReview) => {
      if (fingerprintGatehouseValue(review) !== expected) throw denied();
      const result = await channel.request({ operation: "current" });
      const receipt = result.receipt as GrNativeReviewReceipt;
      if (
        !receipt ||
        receipt.outcome !== "completed" ||
        receipt.signingPolicyDigest !== fingerprintGatehouseValue(channel.policy.signing)
      )
        throw denied();
    },
    verifier: {
      id: "gr-native-root-courier-verifier",
      verify: async (input: {
        endorsement: GatehouseEndorsementSubmission;
        gate: GatehouseGateInspection["gate"];
        intent: GatehouseGateInspection["intent"];
      }) => {
        if (
          input.intent.digest !== channel.policy.signing.intent.digest ||
          input.gate.intentDigest !== input.intent.digest
        )
          throw denied();
        const result = await channel.request({
          operation: "verify-courier",
          endorsement: input.endorsement,
        });
        return result.endorsement as GatehouseVerifiedEndorsement;
      },
    },
  };
}
