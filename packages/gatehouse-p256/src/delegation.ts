import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseEndorsementSubmission,
  type GatehouseVerifiedEndorsement,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseRuntime, GatehouseEndorsementVerifier } from "@reliverse/gatehouse-runtime";

import {
  GatehouseP256Error,
  readGatehouseP256Credential,
  resolveGatehouseP256PrivateCredentialPath,
  GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION,
} from "./index";

export const GATEHOUSE_DELEGATED_P256_PROOF_PROFILE = "gatehouse.delegated-p256-sha256.v0" as const;
export interface GatehouseExactDelegation {
  readonly schemaVersion: "gatehouse.exact-delegation.v0";
  readonly id: string;
  readonly decisionRef: string;
  readonly ownerCredentialId: string;
  readonly ownerPrincipalId: string;
  readonly delegateCredentialId: string;
  readonly delegatePrincipalId: string;
  readonly delegatePublicKeyDigest: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxAttempts: 1;
  readonly redelegation: false;
}
export interface GatehouseSignedExactDelegation {
  readonly mandate: GatehouseExactDelegation;
  readonly signature: string;
}
function fail(message: string): never {
  throw new GatehouseP256Error("GATEHOUSE_DELEGATION_INVALID", message);
}
export function fingerprintGatehouseExactDelegation(mandate: GatehouseExactDelegation): string {
  return fingerprintGatehouseValue({
    domain: "gatehouse.exact-delegation.owner-signature.v0",
    mandate,
  });
}
function signedDigest(endorsement: GatehouseEndorsementSubmission): string {
  const { digest: _digest, proof, ...fields } = endorsement;
  return fingerprintGatehouseValue({ ...fields, proofProfile: proof.profile });
}
async function privateKey(authorityHome: string, credentialId: string, publicKeyDigest: string) {
  const record = JSON.parse(
    await readFile(resolveGatehouseP256PrivateCredentialPath(authorityHome, credentialId), "utf8"),
  );
  if (
    record.schemaVersion !== GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION ||
    record.credentialId !== credentialId ||
    record.publicKeyDigest !== publicKeyDigest
  )
    fail("Private credential binding mismatch.");
  const key = createPrivateKey(record.privateKeyPkcs8Pem);
  const pem = createPublicKey(record.privateKeyPkcs8Pem)
    .export({ type: "spki", format: "pem" })
    .toString();
  if (fingerprintGatehouseValue({ publicKeySpkiPem: pem }) !== publicKeyDigest)
    fail("Private key does not match enrolled public key.");
  return key;
}
function verifySignature(digest: string, signature: string, pem: string): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(digest),
      createPublicKey(pem),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/** Import exactly pre-authorized owner material. This delegate-facing API has no
 * owner signing port/custody. Owner signing must occur across an isolated boundary. */
export async function issueGatehouseExactDelegation(input: {
  readonly registryHome: string;
  readonly authorization: GatehouseSignedExactDelegation;
  readonly ownerCredentialId: string;
  readonly delegateCredentialId: string;
  readonly id: string;
  readonly decisionRef: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly expiresAt: string;
  readonly now?: () => Date;
}): Promise<GatehouseSignedExactDelegation> {
  const owner = await readGatehouseP256Credential(input.registryHome, input.ownerCredentialId);
  const delegate = await readGatehouseP256Credential(
    input.registryHome,
    input.delegateCredentialId,
  );
  const mandate: GatehouseExactDelegation = {
    schemaVersion: "gatehouse.exact-delegation.v0",
    id: input.id,
    decisionRef: input.decisionRef,
    ownerCredentialId: owner.credentialId,
    ownerPrincipalId: owner.principalId,
    delegateCredentialId: delegate.credentialId,
    delegatePrincipalId: delegate.principalId,
    delegatePublicKeyDigest: delegate.publicKeyDigest,
    gateId: input.gateId,
    intentDigest: input.intentDigest,
    issuedAt: (input.now ?? (() => new Date()))().toISOString(),
    expiresAt: input.expiresAt,
    maxAttempts: 1,
    redelegation: false,
  };
  if (!input.authorization?.mandate) fail("Pre-signed owner authorization required; no owner signing is available to a delegate.");
  const authorized = input.authorization.mandate;
  const { issuedAt: _issuedAt, ...requested } = mandate;
  const { issuedAt: _authorizedAt, ...scope } = authorized;
  if (fingerprintGatehouseValue(requested) !== fingerprintGatehouseValue(scope)) fail("Requested mandate is not the exact owner-authorized scope.");
  await validateMandate(input.registryHome, authorized, new Date(mandate.issuedAt));
  if (!verifySignature(fingerprintGatehouseExactDelegation(authorized), input.authorization.signature, owner.publicKeySpkiPem)) fail("Invalid owner authorization signature.");
  return structuredClone(input.authorization);
}

async function validateMandate(registryHome: string, m: GatehouseExactDelegation, now: Date) {
  if (
    !m ||
    m.schemaVersion !== "gatehouse.exact-delegation.v0" ||
    m.maxAttempts !== 1 ||
    m.redelegation !== false ||
    !m.id ||
    !m.decisionRef ||
    !/^sha256:[a-f0-9]{64}$/u.test(m.intentDigest)
  )
    fail("Unsupported mandate or missing provenance.");
  const owner = await readGatehouseP256Credential(registryHome, m.ownerCredentialId);
  const delegate = await readGatehouseP256Credential(registryHome, m.delegateCredentialId);
  if (owner.status !== "active" || delegate.status !== "active")
    fail("Owner or delegate credential revoked.");
  if (
    owner.principalId !== m.ownerPrincipalId ||
    delegate.principalId !== m.delegatePrincipalId ||
    delegate.publicKeyDigest !== m.delegatePublicKeyDigest ||
    owner.principalId === delegate.principalId ||
        owner.publicKeyDigest === delegate.publicKeyDigest
  )
    fail("Mandate actor/key binding mismatch.");
  const start = Date.parse(m.issuedAt),
    end = Date.parse(m.expiresAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > now.getTime() ||
    end <= now.getTime() ||
    end <= start ||
    start < Date.parse(owner.enrolledAt) ||
    start < Date.parse(delegate.enrolledAt) ||
    end > Date.parse(owner.expiresAt) ||
    end > Date.parse(delegate.expiresAt)
  )
    fail("Mandate outside validity window.");
  return { owner, delegate };
}

/** Delegate-side redemption. Only the separately enrolled delegate key is used. */
export async function createDelegatedGatehouseP256Endorsement(input: {
  readonly registryHome: string;
  readonly delegateAuthorityHome: string;
  readonly delegation: GatehouseSignedExactDelegation;
  readonly now?: () => Date;
}): Promise<GatehouseEndorsementSubmission> {
  const now = (input.now ?? (() => new Date()))();
  const { mandate: m, signature } = input.delegation;
  const { owner, delegate } = await validateMandate(input.registryHome, m, now);
  if (!verifySignature(fingerprintGatehouseExactDelegation(m), signature, owner.publicKeySpkiPem))
    fail("Invalid owner mandate signature.");
  const key = await privateKey(
    input.delegateAuthorityHome,
    delegate.credentialId,
    delegate.publicKeyDigest,
  );
  return createGatehouseEndorsementSubmission({
    gateId: m.gateId,
    intentDigest: m.intentDigest,
    principalId: m.ownerPrincipalId,
    credentialId: delegate.credentialId,
    decision: "approve",
    issuedAt: now.toISOString(),
    expiresAt: m.expiresAt,
    rationale: `Delegated approval: ${m.id}; ${m.decisionRef}`,
    assurance: {
      profile: delegate.assuranceProfile,
      evidenceDigest: delegate.evidenceDigest,
      deviceBound: false,
      userPresence: false,
      userVerification: false,
    },
    proof: {
      profile: GATEHOUSE_DELEGATED_P256_PROOF_PROFILE,
      signature: (digest) =>
        JSON.stringify({
          delegation: input.delegation,
          delegateSignature: sign("sha256", Buffer.from(digest), key).toString("base64url"),
        }),
    },
  });
}

/** Revoke the exact Gate as well as its unconsumed lease; credential revocation alone
 * cannot retract an endorsement already admitted into the runtime ledger. */
export async function revokeGatehouseExactDelegation(input: {
  readonly registryHome: string;
  readonly runtime: GatehouseRuntime;
  readonly delegation: GatehouseSignedExactDelegation;
  readonly reason: string;
}) {
  const m = input.delegation.mandate;
  const owner = await readGatehouseP256Credential(input.registryHome, m.ownerCredentialId);
  if (
    owner.principalId !== m.ownerPrincipalId ||
    !verifySignature(fingerprintGatehouseExactDelegation(m), input.delegation.signature, owner.publicKeySpkiPem)
  )
    fail("Invalid revocation mandate signature.");
  const inspection = await input.runtime.inspectGate(m.gateId);
  if (!inspection || inspection.intent.digest !== m.intentDigest)
    fail("Revocation intent mismatch.");
  if (inspection.consumption || inspection.execution)
    fail("Consumed mandate is historical; revocation cannot undo or replay its effects.");
  return input.runtime.revoke({
    gateId: m.gateId,
    actor: { id: m.ownerPrincipalId, kind: "human" },
    reason: `Delegation ${m.id}: ${input.reason}`,
  });
}

export function createDelegatedGatehouseP256EndorsementVerifier(input: {
  readonly registryHome: string;
  readonly now?: () => Date;
}): GatehouseEndorsementVerifier {
  return {
    id: "gatehouse-exact-delegation-p256-v0",
    async verify({ endorsement: e, gate, intent }) {
      if (e.proof.profile !== GATEHOUSE_DELEGATED_P256_PROOF_PROFILE)
        fail("Unsupported delegation proof profile.");
      let payload: { delegation: GatehouseSignedExactDelegation; delegateSignature: string };
      try {
        payload = JSON.parse(e.proof.signature);
      } catch {
        fail("Malformed delegation proof.");
      }
      const m = payload.delegation?.mandate;
      const now = (input.now ?? (() => new Date()))();
      const { owner, delegate } = await validateMandate(input.registryHome, m, now);
      if (
        m.gateId !== gate.id ||
        m.intentDigest !== intent.digest ||
        e.gateId !== m.gateId ||
        e.intentDigest !== m.intentDigest ||
        e.principalId !== m.ownerPrincipalId ||
        e.credentialId !== m.delegateCredentialId ||
        e.decision !== "approve" ||
        intent.requestedCapability.maxAttempts !== 1 ||
        intent.action.authorityImpact !== "none" ||
        intent.policy.authority.principalIds.includes(m.delegatePrincipalId) ||
        Date.parse(m.expiresAt) > Date.parse(gate.expiresAt)
      )
        fail("Delegation cannot widen the exact one-attempt intent.");
      if (
        !Number.isFinite(Date.parse(e.issuedAt)) ||
        !Number.isFinite(Date.parse(e.expiresAt)) ||
        Date.parse(e.issuedAt) < Date.parse(m.issuedAt) ||
        Date.parse(e.issuedAt) > now.getTime() ||
        Date.parse(e.expiresAt) > Date.parse(m.expiresAt) ||
        Date.parse(e.expiresAt) <= now.getTime()
      )
        fail("Endorsement outside mandate window.");
      if (
        e.assurance.profile !== delegate.assuranceProfile ||
        e.assurance.evidenceDigest !== delegate.evidenceDigest ||
        e.assurance.deviceBound ||
        e.assurance.userPresence ||
        e.assurance.userVerification
      )
        fail("Delegation does not imply human presence or stronger assurance.");
      if (
        !verifySignature(fingerprintGatehouseExactDelegation(m), payload.delegation.signature, owner.publicKeySpkiPem) ||
        e.proof.signedDigest !== signedDigest(e) ||
        !verifySignature(signedDigest(e), payload.delegateSignature, delegate.publicKeySpkiPem)
      )
        fail("Invalid owner/delegate signature.");
      return {
        ...e,
        verification: {
          verifierId: this.id,
          verifiedAt: now.toISOString(),
          evidenceDigest: fingerprintGatehouseValue(payload.delegation),
        },
      } satisfies GatehouseVerifiedEndorsement;
    },
  };
}
