import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseDecision,
  type GatehouseEndorsementSubmission,
  type GatehouseVerifiedEndorsement,
} from "@reliverse/gatehouse-protocol";
import type { GatehouseEndorsementVerifier } from "@reliverse/gatehouse-runtime";

export {
  GATEHOUSE_DELEGATED_P256_PROOF_PROFILE,
  issueGatehouseExactDelegation,
  fingerprintGatehouseExactDelegation,
  createDelegatedGatehouseP256Endorsement,
  createDelegatedGatehouseP256EndorsementVerifier,
  revokeGatehouseExactDelegation,
  type GatehouseExactDelegation,
  type GatehouseSignedExactDelegation,
} from "./delegation";

export const GATEHOUSE_P256_PROOF_PROFILE = "gatehouse.p256-sha256.v0" as const;
export const GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE = "gatehouse.software-p256.v0" as const;
export const GATEHOUSE_P256_CREDENTIAL_SCHEMA_VERSION = "gatehouse.p256-credential.v0" as const;
export const GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION =
  "gatehouse.p256-private-credential.v0" as const;

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._:/-]*$/iu;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface GatehouseP256CredentialRecord {
  readonly schemaVersion: typeof GATEHOUSE_P256_CREDENTIAL_SCHEMA_VERSION;
  readonly credentialId: string;
  readonly principalId: string;
  readonly proofProfile: typeof GATEHOUSE_P256_PROOF_PROFILE;
  readonly assuranceProfile: typeof GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE;
  readonly publicKeySpkiPem: string;
  readonly publicKeyDigest: string;
  readonly evidenceDigest: string;
  readonly enrolledAt: string;
  readonly expiresAt: string;
  readonly status: "active" | "revoked";
  readonly provenance: {
    readonly kind: "owner-delegated-vps-software";
    readonly decisionRef: string;
  };
}

interface GatehouseP256PrivateCredentialRecord {
  readonly schemaVersion: typeof GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION;
  readonly credentialId: string;
  readonly principalId: string;
  readonly privateKeyPkcs8Pem: string;
  readonly publicKeyDigest: string;
  readonly evidenceDigest: string;
  readonly enrolledAt: string;
  readonly expiresAt: string;
}

export class GatehouseP256Error extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatehouseP256Error";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new GatehouseP256Error(code, message);
}

function token(value: string, label: string): string {
  const normalized = value.trim();
  if (!TOKEN_PATTERN.test(normalized)) fail("GATEHOUSE_P256_TOKEN_INVALID", `${label} is invalid.`);
  return normalized;
}

function iso(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("GATEHOUSE_P256_TIME_INVALID", `${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function credentialFileName(credentialId: string): string {
  return `${fingerprintGatehouseValue({ credentialId }).slice("sha256:".length)}.json`;
}

export function resolveGatehouseP256PublicCredentialPath(
  registryHome: string,
  credentialId: string,
): string {
  return path.join(registryHome, credentialFileName(token(credentialId, "credentialId")));
}

export function resolveGatehouseP256PrivateCredentialPath(
  authorityHome: string,
  credentialId: string,
): string {
  return path.join(authorityHome, credentialFileName(token(credentialId, "credentialId")));
}

async function readJson<T>(filePath: string, code: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      fail(code, `Credential record is unavailable at ${filePath}.`);
    }
    fail("GATEHOUSE_P256_RECORD_INVALID", "Credential record is not valid JSON.");
  }
}

async function writeExclusive(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  let handle;
  try {
    handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      fail("GATEHOUSE_P256_CREDENTIAL_EXISTS", "Credential id is already enrolled.");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function validatePublicRecord(value: GatehouseP256CredentialRecord): GatehouseP256CredentialRecord {
  if (value.schemaVersion !== GATEHOUSE_P256_CREDENTIAL_SCHEMA_VERSION) {
    fail("GATEHOUSE_P256_CREDENTIAL_SCHEMA_UNSUPPORTED", "Credential schema is unsupported.");
  }
  token(value.credentialId, "credentialId");
  token(value.principalId, "principalId");
  if (value.proofProfile !== GATEHOUSE_P256_PROOF_PROFILE) {
    fail("GATEHOUSE_P256_PROFILE_MISMATCH", "Credential proof profile is unsupported.");
  }
  if (value.assuranceProfile !== GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE) {
    fail(
      "GATEHOUSE_P256_ASSURANCE_PROFILE_MISMATCH",
      "Credential assurance profile is unsupported.",
    );
  }
  if (!DIGEST_PATTERN.test(value.publicKeyDigest) || !DIGEST_PATTERN.test(value.evidenceDigest)) {
    fail("GATEHOUSE_P256_DIGEST_INVALID", "Credential evidence digest is invalid.");
  }
  iso(value.enrolledAt, "credential.enrolledAt");
  iso(value.expiresAt, "credential.expiresAt");
  if (
    fingerprintGatehouseValue({ publicKeySpkiPem: value.publicKeySpkiPem }) !==
    value.publicKeyDigest
  ) {
    fail(
      "GATEHOUSE_P256_PUBLIC_KEY_DIGEST_MISMATCH",
      "Credential public key digest does not match.",
    );
  }
  return value;
}

export async function readGatehouseP256Credential(
  registryHome: string,
  credentialId: string,
): Promise<GatehouseP256CredentialRecord> {
  return validatePublicRecord(
    await readJson<GatehouseP256CredentialRecord>(
      resolveGatehouseP256PublicCredentialPath(registryHome, credentialId),
      "GATEHOUSE_P256_CREDENTIAL_UNKNOWN",
    ),
  );
}

export async function enrollLocalGatehouseP256Credential(input: {
  readonly registryHome: string;
  readonly authorityHome: string;
  readonly credentialId: string;
  readonly principalId: string;
  readonly decisionRef: string;
  readonly expiresAt: string;
  readonly now?: (() => Date) | undefined;
}): Promise<GatehouseP256CredentialRecord> {
  const now = input.now ?? (() => new Date());
  const credentialId = token(input.credentialId, "credentialId");
  const principalId = token(input.principalId, "principalId");
  const decisionRef = token(input.decisionRef, "decisionRef");
  const enrolledAt = now().toISOString();
  const expiresAt = iso(input.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(enrolledAt)) {
    fail("GATEHOUSE_P256_EXPIRY_INVALID", "Credential expiry must be in the future.");
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const publicKeyDigest = fingerprintGatehouseValue({ publicKeySpkiPem: publicKey });
  const evidenceDigest = fingerprintGatehouseValue({
    assuranceProfile: GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE,
    credentialId,
    principalId,
    publicKeyDigest,
  });
  const publicRecord: GatehouseP256CredentialRecord = Object.freeze({
    schemaVersion: GATEHOUSE_P256_CREDENTIAL_SCHEMA_VERSION,
    credentialId,
    principalId,
    proofProfile: GATEHOUSE_P256_PROOF_PROFILE,
    assuranceProfile: GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE,
    publicKeySpkiPem: publicKey,
    publicKeyDigest,
    evidenceDigest,
    enrolledAt,
    expiresAt,
    status: "active",
    provenance: { kind: "owner-delegated-vps-software" as const, decisionRef },
  });
  const privateRecord: GatehouseP256PrivateCredentialRecord = Object.freeze({
    schemaVersion: GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION,
    credentialId,
    principalId,
    privateKeyPkcs8Pem: privateKey,
    publicKeyDigest,
    evidenceDigest,
    enrolledAt,
    expiresAt,
  });
  const privatePath = resolveGatehouseP256PrivateCredentialPath(input.authorityHome, credentialId);
  const publicPath = resolveGatehouseP256PublicCredentialPath(input.registryHome, credentialId);
  await writeExclusive(privatePath, privateRecord);
  try {
    await writeExclusive(publicPath, publicRecord);
  } catch (error) {
    await rm(privatePath, { force: true });
    throw error;
  }
  return publicRecord;
}

export async function revokeGatehouseP256Credential(input: {
  readonly registryHome: string;
  readonly credentialId: string;
}): Promise<GatehouseP256CredentialRecord> {
  const filePath = resolveGatehouseP256PublicCredentialPath(input.registryHome, input.credentialId);
  const current = await readGatehouseP256Credential(input.registryHome, input.credentialId);
  if (current.status === "revoked") return current;
  const next = Object.freeze({ ...current, status: "revoked" as const });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeExclusive(temporary, next);
  await rename(temporary, filePath);
  return next;
}

function endorsementSignedDigest(endorsement: GatehouseEndorsementSubmission): string {
  const { digest: _digest, proof, ...fields } = endorsement;
  return fingerprintGatehouseValue({ ...fields, proofProfile: proof.profile });
}

export async function resolveLocalGatehouseP256EndorsementExpiry(input: {
  readonly authorityHome: string;
  readonly credentialId: string;
  readonly gateExpiresAt: string;
  readonly expiresAt?: unknown;
  readonly now?: Date;
}): Promise<string> {
  const record = await readJson<GatehouseP256PrivateCredentialRecord>(
    resolveGatehouseP256PrivateCredentialPath(input.authorityHome, input.credentialId),
    "GATEHOUSE_P256_PRIVATE_CREDENTIAL_UNKNOWN",
  );
  const credentialExpiry = Date.parse(record.expiresAt);
  const gateExpiry = Date.parse(input.gateExpiresAt);
  if (record.schemaVersion !== GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION ||
      record.credentialId !== input.credentialId ||
      !Number.isFinite(credentialExpiry) || !Number.isFinite(gateExpiry)) {
    fail("GATEHOUSE_P256_ENDORSEMENT_EXPIRY_INVALID", "Invalid credential or Gate expiry.");
  }
  const upperBound = Math.min(credentialExpiry, gateExpiry);
  const explicit = input.expiresAt;
  const expiry = explicit === undefined ? upperBound :
    typeof explicit === "string" ? Date.parse(explicit) : NaN;
  if (!Number.isFinite(expiry) || expiry <= (input.now ?? new Date()).getTime() || expiry > upperBound) {
    fail("GATEHOUSE_P256_ENDORSEMENT_EXPIRY_INVALID", "Endorsement expiry must be future and within Gate and credential bounds.");
  }
  return new Date(expiry).toISOString();
}

export async function createLocalGatehouseP256Endorsement(input: {
  readonly authorityHome: string;
  readonly credentialId: string;
  readonly gateId: string;
  readonly intentDigest: string;
  readonly decision: GatehouseDecision;
  readonly expiresAt: string;
  readonly rationale?: string | undefined;
  readonly id?: string | undefined;
  readonly nonce?: string | undefined;
  readonly now?: (() => Date) | undefined;
}): Promise<GatehouseEndorsementSubmission> {
  const record = await readJson<GatehouseP256PrivateCredentialRecord>(
    resolveGatehouseP256PrivateCredentialPath(input.authorityHome, input.credentialId),
    "GATEHOUSE_P256_PRIVATE_CREDENTIAL_UNKNOWN",
  );
  if (record.schemaVersion !== GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_VERSION) {
    fail(
      "GATEHOUSE_P256_PRIVATE_CREDENTIAL_SCHEMA_UNSUPPORTED",
      "Private credential schema is unsupported.",
    );
  }
  const issuedAt = (input.now ?? (() => new Date()))().toISOString();
  const expiresAt = iso(input.expiresAt, "endorsement.expiresAt");
  if (Date.parse(expiresAt) > Date.parse(record.expiresAt)) {
    fail("GATEHOUSE_P256_ENDORSEMENT_EXPIRY_INVALID", "Endorsement outlives its credential.");
  }
  return createGatehouseEndorsementSubmission({
    ...(input.id ? { id: input.id } : {}),
    ...(input.nonce ? { nonce: input.nonce } : {}),
    gateId: input.gateId,
    intentDigest: input.intentDigest,
    principalId: record.principalId,
    credentialId: record.credentialId,
    decision: input.decision,
    assurance: {
      deviceBound: false,
      evidenceDigest: record.evidenceDigest,
      profile: GATEHOUSE_SOFTWARE_ASSURANCE_PROFILE,
      userPresence: false,
      userVerification: false,
    },
    issuedAt,
    expiresAt,
    ...(input.rationale ? { rationale: input.rationale } : {}),
    proof: {
      profile: GATEHOUSE_P256_PROOF_PROFILE,
      signature: (signedDigest) =>
        signBytes(
          "sha256",
          Buffer.from(signedDigest, "utf8"),
          createPrivateKey(record.privateKeyPkcs8Pem),
        ).toString("base64url"),
    },
  });
}

export function createGatehouseP256EndorsementVerifier(input: {
  readonly registryHome: string;
  readonly id?: string | undefined;
  readonly now?: (() => Date) | undefined;
}): GatehouseEndorsementVerifier {
  const now = input.now ?? (() => new Date());
  const verifierId = input.id ?? "gatehouse-p256-public-registry-v0";
  return {
    id: verifierId,
    async verify({ endorsement, gate, intent }) {
      const record = await readGatehouseP256Credential(
        input.registryHome,
        endorsement.credentialId,
      );
      if (record.status !== "active")
        fail("GATEHOUSE_P256_CREDENTIAL_REVOKED", "Credential is revoked.");
      if (record.principalId !== endorsement.principalId) {
        fail("GATEHOUSE_P256_PRINCIPAL_MISMATCH", "Credential is not enrolled for this principal.");
      }
      if (endorsement.proof.profile !== record.proofProfile) {
        fail("GATEHOUSE_P256_PROFILE_MISMATCH", "Endorsement proof profile is unsupported.");
      }
      if (endorsement.gateId !== gate.id || endorsement.intentDigest !== intent.digest) {
        fail(
          "GATEHOUSE_P256_INTENT_BINDING_MISMATCH",
          "Endorsement does not bind this gate and intent.",
        );
      }
      if (Date.parse(record.enrolledAt) > Date.parse(endorsement.issuedAt)) {
        fail(
          "GATEHOUSE_P256_CREDENTIAL_NOT_YET_VALID",
          "Credential was enrolled after endorsement issuance.",
        );
      }
      if (
        Date.parse(record.expiresAt) <= now().getTime() ||
        Date.parse(endorsement.expiresAt) > Date.parse(record.expiresAt)
      ) {
        fail(
          "GATEHOUSE_P256_CREDENTIAL_EXPIRED",
          "Credential is expired or endorsement outlives it.",
        );
      }
      if (
        endorsement.assurance.profile !== record.assuranceProfile ||
        endorsement.assurance.evidenceDigest !== record.evidenceDigest ||
        endorsement.assurance.deviceBound ||
        endorsement.assurance.userPresence ||
        endorsement.assurance.userVerification
      ) {
        fail(
          "GATEHOUSE_P256_ASSURANCE_INFLATION",
          "Software credential assurance claims are invalid.",
        );
      }
      const expectedSignedDigest = endorsementSignedDigest(endorsement);
      if (endorsement.proof.signedDigest !== expectedSignedDigest) {
        fail("GATEHOUSE_P256_SIGNED_DIGEST_MISMATCH", "Endorsement signed digest is invalid.");
      }
      let verified = false;
      try {
        verified = verifyBytes(
          "sha256",
          Buffer.from(expectedSignedDigest, "utf8"),
          createPublicKey(record.publicKeySpkiPem),
          Buffer.from(endorsement.proof.signature, "base64url"),
        );
      } catch {
        verified = false;
      }
      if (!verified) fail("GATEHOUSE_P256_SIGNATURE_INVALID", "Endorsement signature is invalid.");
      return Object.freeze({
        ...endorsement,
        verification: {
          evidenceDigest: record.evidenceDigest,
          verifierId,
          verifiedAt: now().toISOString(),
        },
      }) satisfies GatehouseVerifiedEndorsement;
    },
  };
}
