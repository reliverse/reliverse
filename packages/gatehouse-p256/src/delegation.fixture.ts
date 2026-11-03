import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fingerprintGatehouseExactDelegation, type GatehouseExactDelegation, type GatehouseSignedExactDelegation } from "./delegation";
import { resolveGatehouseP256PrivateCredentialPath } from "./index";

/** Test-only trusted owner boundary. Never wired to the delegate CLI or SDK. */
export async function signOwnerMandateFixture(authorityHome: string, mandate: GatehouseExactDelegation): Promise<GatehouseSignedExactDelegation> {
  const key = JSON.parse(await readFile(resolveGatehouseP256PrivateCredentialPath(authorityHome, mandate.ownerCredentialId), "utf8"));
  return { mandate, signature: sign("sha256", Buffer.from(fingerprintGatehouseExactDelegation(mandate)), createPrivateKey(key.privateKeyPkcs8Pem)).toString("base64url") };
}
