import { expect, test } from "bun:test";
import { createReliversePrincipal } from "@reliverse/home";

import { bindRvsUserLocalOperator } from "./local-operator";

const principal = createReliversePrincipal({ handle: "operator", id: "prn_11111111111111111111111111111111" });
const credential = { credentialId: "credential.owner.home", principalId: principal.id, publicKeyDigest: `sha256:${"a".repeat(64)}`, expiresAt: "2099-09-27T16:00:00Z", status: "active" as const };
const os = { username: "operator", uid: 1000 };

test("RVS User binds the canonical Home Principal to the OS Actor without granting authority", () => {
  const binding = bindRvsUserLocalOperator({ principal, credential, os, at: new Date("2026-09-27T16:00:00Z") });
  expect(binding).toMatchObject({ principal: { id: principal.id, kind: "human" }, actor: { id: "os-user.uid-1000", kind: "human" }, provider: { id: "local-os", subject: "uid:1000" }, assurance: "declared", status: "active" });
  expect(JSON.stringify(binding)).not.toContain("authorityRefs");
  expect(JSON.stringify(binding)).not.toContain("privateKey");
});

test("legacy Gatehouse principal and unverified local actor fail closed", () => {
  expect(() => bindRvsUserLocalOperator({ principal, credential: { ...credential, principalId: "principal.legacy-owner" }, os })).toThrow("GATEHOUSE_PRINCIPAL_MISMATCH");
  expect(() => bindRvsUserLocalOperator({ principal, credential, os: { username: "other", uid: 1000 } })).toThrow("OS_BINDING_UNVERIFIED");
  expect(() => bindRvsUserLocalOperator({ principal, credential: { ...credential, status: "revoked" }, os })).toThrow("CREDENTIAL_UNUSABLE");
  expect(() => bindRvsUserLocalOperator({ principal, credential: { ...credential, expiresAt: "2020-01-01T00:00:00Z" }, os })).toThrow("CREDENTIAL_UNUSABLE");
});

test("malformed expiry and clock cannot become an active operator binding", () => {
  for (const expiresAt of ["", "not-a-date", "Infinity"]) {
    expect(() => bindRvsUserLocalOperator({ principal, credential: { ...credential, expiresAt }, os }))
      .toThrow("CREDENTIAL_UNUSABLE");
  }
  expect(() => bindRvsUserLocalOperator({ principal, credential, os, at: new Date(NaN) }))
    .toThrow("CREDENTIAL_UNUSABLE");
});

test("operator credential expires at the exact boundary and root is not a local owner", () => {
  const at = new Date(credential.expiresAt);
  expect(() => bindRvsUserLocalOperator({ principal, credential, os, at }))
    .toThrow("CREDENTIAL_UNUSABLE");
  expect(() => bindRvsUserLocalOperator({ principal, credential, os: { ...os, uid: 0 } }))
    .toThrow("OS_BINDING_UNVERIFIED");
});
