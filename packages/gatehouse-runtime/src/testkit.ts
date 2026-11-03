import {
  fingerprintGatehouseValue,
  type GatehouseVerifiedEndorsement,
} from "@reliverse/gatehouse-protocol";

import type { GatehouseEndorsementVerifier } from "./runtime";

export function createStaticGatehouseEndorsementVerifier(input: {
  readonly credentials: Readonly<
    Record<string, { readonly principalId: string; readonly secret: string }>
  >;
  readonly id?: string | undefined;
  readonly now?: (() => Date) | undefined;
}): GatehouseEndorsementVerifier {
  const now = input.now ?? (() => new Date());
  return {
    id: input.id ?? "gatehouse-static-test-verifier",
    verify({ endorsement }) {
      const credential = input.credentials[endorsement.credentialId];
      if (!credential || credential.principalId !== endorsement.principalId) {
        throw new Error("Static Gatehouse test credential is not enrolled for this principal.");
      }
      const expected = fingerprintGatehouseValue({
        credentialId: endorsement.credentialId,
        signedDigest: endorsement.proof.signedDigest,
        secret: credential.secret,
      });
      if (endorsement.proof.signature !== expected) {
        throw new Error("Static Gatehouse test signature is invalid.");
      }
      return Object.freeze({
        ...endorsement,
        verification: {
          evidenceDigest: endorsement.assurance.evidenceDigest,
          verifierId: input.id ?? "gatehouse-static-test-verifier",
          verifiedAt: now().toISOString(),
        },
      }) satisfies GatehouseVerifiedEndorsement;
    },
  };
}

export function signStaticGatehouseEndorsement(input: {
  readonly credentialId: string;
  readonly signedDigest: string;
  readonly secret: string;
}): string {
  return fingerprintGatehouseValue(input);
}
