import { createHash } from "node:crypto";

import type { ReliversePrincipalV0 } from "@reliverse/home";

import { bindRvsUserActor } from "./identity";

/**
 * A transient identity projection for an operator turn, not durable enrollment.
 * The caller must obtain principal/credential from their owning inspected stores
 * and username/uid from the local OS, not from environment variables or argv.
 * Gatehouse still owns approval; this evidence grants no execution authority.
 */
export function bindRvsUserLocalOperator(input: {
  readonly principal: ReliversePrincipalV0;
  readonly credential: {
    readonly credentialId: string;
    readonly principalId: string;
    readonly publicKeyDigest: string;
    readonly expiresAt: string;
    readonly status: "active" | "revoked";
  };
  readonly os: { readonly username: string; readonly uid: number };
  readonly at?: Date;
}) {
  const { principal, credential, os } = input;
  const at = input.at ?? new Date();
  const now = at.getTime();
  const expiresAt = Date.parse(credential.expiresAt);
  if (principal.principalKind !== "human" || principal.status !== "active") {
    throw new Error("RVS_USER_OPERATOR_PRINCIPAL_NOT_ACTIVE");
  }
  if (!Number.isSafeInteger(os.uid) || os.uid < 1 || !/^[a-z_][a-z0-9_-]*$/.test(os.username) ||
      !principal.aliases.some((alias) => alias.namespace === "local-handle" && alias.value === os.username && alias.verified)) {
    throw new Error("RVS_USER_OPERATOR_OS_BINDING_UNVERIFIED");
  }
  if (credential.principalId !== principal.id) {
    throw new Error("RVS_USER_OPERATOR_GATEHOUSE_PRINCIPAL_MISMATCH");
  }
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) ||
      credential.status !== "active" || expiresAt <= now ||
      !/^sha256:[a-f0-9]{64}$/.test(credential.publicKeyDigest)) {
    throw new Error("RVS_USER_OPERATOR_GATEHOUSE_CREDENTIAL_UNUSABLE");
  }
  const bindingId = createHash("sha256").update(JSON.stringify({ principalId: principal.id, uid: os.uid, credentialId: credential.credentialId })).digest("hex");
  return bindRvsUserActor({
    id: `binding.local-operator.${bindingId}`,
    principal,
    actor: { id: `os-user.uid-${os.uid}`, kind: "human" },
    provider: { id: "local-os", subject: `uid:${os.uid}` },
    proof: { kind: "gatehouse-p256-enrollment", reference: credential.credentialId, digest: credential.publicKeyDigest as `sha256:${string}` },
    assurance: "declared", // A software credential never proves human presence.
    boundBy: principal.id,
    createdAt: at.toISOString(),
  });
}
