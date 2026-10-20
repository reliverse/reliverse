import { lstat } from "node:fs/promises";
import path from "node:path";

import { createProtectedAuthSessionStore } from "@reliverse/auth-bun";
import { fingerprintGatehouseValue } from "@reliverse/gatehouse-protocol";
import {
  assertGrOwnerExecutionSession,
  type GrOwnerExecutionAuthPin,
} from "@reliverse/gr-action-runtime";
import {
  readRvsReviewerProtectedDocument,
  assertRvsReviewerRootDirectory,
  createRvsProtectedOwnerTerminalAuthBackend,
  type ProtectedOwnerAuthPolicy,
} from "@reliverse/rvs-systemd-ubuntu";

import {
  GR_OWNER_AUTH_DIRECTORY,
  GR_OWNER_AUTH_POLICY,
  assertGrOwnerAuthArtifacts,
  assertGrOwnerAuthPolicy,
  grOwnerAuthProfile,
  type GrOwnerAuthPolicy,
} from "./owner-auth";

/** Read-only canonical Auth consumer for a separately admitted Git launcher.
 * It never runs the issuer, publishes/renews a session, widens its audience or
 * treats the terminal's pasted authentication JSON as an authenticated token. */
export function createGrOwnerExecutionAuthReader(
  input: GrOwnerExecutionAuthPin & { readonly authPolicyDigest: `sha256:${string}` },
  ports: { readonly now: () => Date; readonly assertNativeCurrent: () => Promise<void> },
) {
  const pin = structuredClone(input);
  const denied = () => new Error("GR_OWNER_AUTH_CANONICAL_READ_REFUSED");
  if (!/^sha256:[a-f0-9]{64}$/.test(pin.authPolicyDigest)) throw denied();
  return async () => {
    let canonicalPolicyDigest: string | undefined;
    let canonicalEnrollmentDigest: string | undefined;
    const assertLocation = async () => {
      await ports.assertNativeCurrent();
      const loaded = await readRvsReviewerProtectedDocument(GR_OWNER_AUTH_POLICY, 0);
      if (loaded.digest !== pin.authPolicyDigest) throw denied();
      const policy = loaded.value as unknown as GrOwnerAuthPolicy;
      assertGrOwnerAuthPolicy(policy);
      if (
        policy.ownerPrincipalId !== pin.principalId ||
        fingerprintGatehouseValue(policy.author) !== fingerprintGatehouseValue(pin.author)
      )
        throw denied();
      const enrollment = await readRvsReviewerProtectedDocument(
        "/etc/reliverse/secret-broker/owner-control.json",
        0,
      );
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
        record.binding.principal.id !== pin.principalId ||
        !Number.isFinite(Date.parse(record.binding.createdAt)) ||
        !Number.isFinite(ports.now().getTime()) ||
        Date.parse(record.binding.createdAt) > ports.now().getTime()
      )
        throw denied();
      // Structural validation reuses the owning UF/Auth kernel. No challenge or
      // session is issued by constructing this backend; its lifecycle is not run.
      createRvsProtectedOwnerTerminalAuthBackend(grOwnerAuthProfile(record.binding), {
        now: ports.now,
        attest: async () => {
          throw denied();
        },
        persistSession: async () => {
          throw denied();
        },
      });
      if (
        (canonicalPolicyDigest && canonicalPolicyDigest !== loaded.digest) ||
        (canonicalEnrollmentDigest && canonicalEnrollmentDigest !== enrollment.digest)
      )
        throw denied();
      canonicalPolicyDigest = loaded.digest;
      canonicalEnrollmentDigest = enrollment.digest;
      await assertGrOwnerAuthArtifacts(policy);
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
    const first = await sessions.readActive(ports.now());
    if (!first) throw denied();
    assertGrOwnerExecutionSession(first, pin, ports.now());
    const confirmed = await sessions.readActive(ports.now());
    if (!confirmed || fingerprintGatehouseValue(confirmed) !== fingerprintGatehouseValue(first))
      throw denied();
    assertGrOwnerExecutionSession(confirmed, pin, ports.now());
    return structuredClone(confirmed);
  };
}
