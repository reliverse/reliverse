import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  fingerprintGatehouseValue,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";

import {
  enrollLocalGatehouseP256Credential,
  createGatehouseP256EndorsementVerifier,
  createDelegatedGatehouseP256EndorsementVerifier,
  createDelegatedGatehouseP256Endorsement,
  issueGatehouseExactDelegation,
  revokeGatehouseExactDelegation,
  revokeGatehouseP256Credential,
  readGatehouseP256Credential,
    resolveGatehouseP256PublicCredentialPath,
} from "./index";
import { signOwnerMandateFixture } from "./delegation.fixture";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(principalIds = ["principal.owner"]) {
  const root = await mkdtemp(path.join(tmpdir(), "gatehouse-delegation-"));
  roots.push(root);
  let time = new Date("2026-10-07T16:00:00Z");
  const now = () => new Date(time);
  const registryHome = path.join(root, "public");
  const ownerAuthorityHome = path.join(root, "owner");
  const delegateAuthorityHome = path.join(root, "agent");
  for (const [credentialId, principalId, authorityHome] of [
    ["credential.owner", "principal.owner", ownerAuthorityHome],
    ["credential.agent", "agent.zed", delegateAuthorityHome],
  ]) {
    await enrollLocalGatehouseP256Credential({
      registryHome,
      authorityHome: authorityHome!,
      credentialId: credentialId!,
      principalId: principalId!,
      decisionRef: "owner.explicit-delegation",
      expiresAt: "2026-10-08T16:00:00Z",
      now,
    });
  }
  const intent = createGatehouseActionIntent({
    createdAt: now().toISOString(),
    expiresAt: "2026-10-07T17:00:00Z",
    action: { authorityImpact: "none", effectClass: "workspace.write", kind: "test.patch" },
    actor: { id: "agent.rse", kind: "agent" },
    requester: { id: "agent.rse", kind: "agent" },
    accountableSystem: { id: "service.rse", kind: "service" },
    target: { id: "repo", kind: "repository", parameters: { path: "test.ts", patch: "exact" } },
    preconditions: { unchanged: true },
    requestedCapability: {
      capability: "test.patch",
      executorClass: "rse",
      maxAttempts: 1,
      scope: { path: "test.ts" },
    },
    policy: {
      id: "owner-only",
      digest: fingerprintGatehouseValue({ owner: true }),
      authority: {
        kind: "all-of",
        independence: "distinct-trust-roots",
        principalIds,
      },
    },
    presentation: { title: "Patch", summary: "Exact test", consequences: [] },
    risk: "low",
    reversibility: "reversible",
  });
  const verifier = createDelegatedGatehouseP256EndorsementVerifier({ registryHome, now });
  const runtime = createGatehouseRuntime({
    home: path.join(root, "runtime"),
    endorsementVerifier: verifier,
    now,
  });
  const submitted = await runtime.submitIntent(intent);
  const authorization = await signOwnerMandateFixture(ownerAuthorityHome, {
    schemaVersion: "gatehouse.exact-delegation.v0", id: "delegation.exact", decisionRef: "owner.explicit-delegation",
    ownerCredentialId: "credential.owner", ownerPrincipalId: "principal.owner",
    delegateCredentialId: "credential.agent", delegatePrincipalId: "agent.zed",
    delegatePublicKeyDigest: (await readGatehouseP256Credential(registryHome, "credential.agent")).publicKeyDigest,
    gateId: submitted.gate.id, intentDigest: intent.digest, issuedAt: now().toISOString(), expiresAt: "2026-10-07T16:30:00Z", maxAttempts: 1, redelegation: false,
  });
  const issueInput = {
    registryHome, authorization,
    ownerCredentialId: "credential.owner",
    delegateCredentialId: "credential.agent",
    id: "delegation.exact",
    decisionRef: "owner.explicit-delegation",
    gateId: submitted.gate.id,
    intentDigest: intent.digest,
    expiresAt: "2026-10-07T16:30:00Z",
    now,
  };
  const delegation = await issueGatehouseExactDelegation(issueInput);
  const endorse = (d = delegation, authorityHome = delegateAuthorityHome) =>
    createDelegatedGatehouseP256Endorsement({
      registryHome,
      delegateAuthorityHome: authorityHome,
      delegation: d,
      now,
    });
  const context = { gate: submitted.gate, intent };
  return {
    root,
    now,
    advance: () => {
      time = new Date("2026-10-07T16:31:00Z");
    },
    registryHome,
    delegateAuthorityHome,
    runtime,
    verifier,
    intent,
    submitted,
    delegation,
    endorse,
    context, issueInput, ownerAuthorityHome,
  };
}
test("separate agent key approves only the owner's slot and one execution", async () => {
  const f = await fixture();
  const endorsement = await f.endorse();
  const accepted = await f.runtime.submitEndorsement(endorsement);
  expect(accepted.gate.status).toBe("quorum-satisfied");
  expect((await f.runtime.inspectGate(f.submitted.gate.id))!.intent).toEqual(f.intent);
  expect(endorsement.principalId).toBe("principal.owner");
  expect(endorsement.credentialId).toBe("credential.agent");
  expect(endorsement.assurance.userPresence).toBe(false);
  const replay = await f.runtime.submitEndorsement(endorsement);
  expect(replay.decisionReceipt.id).toBe(accepted.decisionReceipt.id);
  const lease = await f.runtime.issueLease({
    gateId: f.submitted.gate.id,
    preconditionDigest: f.intent.preconditions.digest,
  });
  const binding = {
    leaseId: lease.id,
    attemptId: "attempt.first",
    capability: f.intent.requestedCapability.capability,
    executorClass: f.intent.requestedCapability.executorClass,
    intentDigest: f.intent.digest,
    preconditionDigest: f.intent.preconditions.digest,
    scopeDigest: f.intent.requestedCapability.scopeDigest,
    targetDigest: f.intent.target.digest,
  };
  const outcomes = await Promise.allSettled([
    f.runtime.consumeLease(binding),
    f.runtime.consumeLease({ ...binding, attemptId: "attempt.second" }),
  ]);
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(f.runtime.consumeLease({ ...binding, attemptId: "attempt.replay" })).rejects.toThrow();
});
for (const field of [
  "delegatePrincipalId",
  "delegatePublicKeyDigest",
  "intentDigest",
  "gateId",
  "expiresAt",
  "redelegation",
] as const) {
  test(`rejects altered signed mandate ${field}`, async () => {
    const f = await fixture();
    const mandate = {
      ...f.delegation.mandate,
      [field]:
        field === "redelegation"
          ? true
          : field === "expiresAt"
            ? "2026-10-07T16:40:00Z"
            : field.endsWith("Digest")
              ? fingerprintGatehouseValue("wrong")
              : "wrong",
    };
    await expect(
      f.endorse({ ...f.delegation, mandate } as typeof f.delegation),
    ).rejects.toMatchObject({ code: "GATEHOUSE_DELEGATION_INVALID" });
  });
}
test("delegate issuance has no owner signing oracle, even with readable owner custody", async () => {
  const f = await fixture();
  await expect(issueGatehouseExactDelegation({ ...f.issueInput, authorization: undefined as never, ownerAuthorityHome: f.ownerAuthorityHome } as Parameters<typeof issueGatehouseExactDelegation>[0])).rejects.toThrow("Pre-signed owner authorization required");
  for (const changed of [{ gateId: "gate.other" }, { intentDigest: fingerprintGatehouseValue("wider") }, { delegateCredentialId: "credential.owner" }, { expiresAt: "2026-10-07T16:40:00Z" }, { id: "delegation.new" }]) {
    await expect(issueGatehouseExactDelegation({ ...f.issueInput, ...changed })).rejects.toThrow("exact owner-authorized scope");
  }
  const forged = { ...f.delegation, signature: "AA" };
  await expect(issueGatehouseExactDelegation({ ...f.issueInput, authorization: forged })).rejects.toThrow("Invalid owner authorization signature");
});

test("delegate cannot count as an additional independent root", async () => {
  const f = await fixture();
  await expect(f.verifier.verify({ ...f.context, intent: { ...f.intent, policy: { ...f.intent.policy, authority: { ...f.intent.policy.authority, principalIds: ["principal.owner", "agent.zed"] } } }, endorsement: await f.endorse() })).rejects.toThrow("cannot widen");
});

test("valid independent-root policy still requires the other root after delegated owner approval", async () => {
  const f = await fixture(["principal.owner", "principal.independent"]);
  const approved = await f.runtime.submitEndorsement(await f.endorse());
  expect(approved.gate.status).not.toBe("quorum-satisfied");
  const inspection = await f.runtime.inspectGate(f.submitted.gate.id);
  expect(inspection!.approvalBundle!.acceptedEndorsementIds).toHaveLength(1);
  await expect(f.runtime.issueLease({ gateId: f.submitted.gate.id, preconditionDigest: f.intent.preconditions.digest })).rejects.toThrow();
});

test("concurrent distinct redemptions cannot produce a second lease or independent root", async () => {
  const f = await fixture();
  const approvals = await Promise.all([f.endorse(), f.endorse()]);
  const submissions = await Promise.allSettled(approvals.map(e => f.runtime.submitEndorsement(e)));
  expect(submissions.some(result => result.status === "fulfilled")).toBe(true);
  const first = await f.runtime.issueLease({ gateId: f.submitted.gate.id, preconditionDigest: f.intent.preconditions.digest });
  const second = await f.runtime.issueLease({ gateId: f.submitted.gate.id, preconditionDigest: f.intent.preconditions.digest });
  expect(second.id).toBe(first.id);
  expect((await f.runtime.inspectGate(f.submitted.gate.id))!.approvalBundle!.acceptedEndorsementIds).toHaveLength(1);
});

test("owner key cannot be used as delegate key", async () => {
  const f = await fixture();
  await expect(f.endorse(f.delegation, path.join(f.root, "owner"))).rejects.toThrow();
});
test("a second Principal label cannot disguise the owner's key as a separate delegate", async () => {
  const f = await fixture();
  const owner = await readGatehouseP256Credential(f.registryHome, "credential.owner");
  const delegate = await readGatehouseP256Credential(f.registryHome, "credential.agent");
  await writeFile(resolveGatehouseP256PublicCredentialPath(f.registryHome, delegate.credentialId), JSON.stringify({ ...delegate, publicKeyDigest: owner.publicKeyDigest, publicKeySpkiPem: owner.publicKeySpkiPem }));
  const mandate = { ...f.delegation.mandate, delegatePublicKeyDigest: owner.publicKeyDigest };
  const authorization = await signOwnerMandateFixture(f.ownerAuthorityHome, mandate);
  await expect(issueGatehouseExactDelegation({ ...f.issueInput, authorization })).rejects.toThrow("actor/key binding mismatch");
});

test("old installed verifier refuses delegated profile rather than ignoring limits", async () => {
  const f = await fixture();
  const endorsement = await f.endorse();
  await expect(
    createGatehouseP256EndorsementVerifier({ registryHome: f.registryHome, now: f.now }).verify({
      ...f.context,
      endorsement,
    }),
  ).rejects.toThrow();
});
test("rejects tampered outer signature and intent/host amplification", async () => {
  const f = await fixture();
  const endorsement = await f.endorse();
  await expect(
    f.verifier.verify({
      ...f.context,
      endorsement: {
        ...endorsement,
        proof: { ...endorsement.proof, signedDigest: fingerprintGatehouseValue("wrong") },
      },
    }),
  ).rejects.toThrow();
  await expect(
    f.verifier.verify({
      ...f.context,
      intent: { ...f.intent, digest: fingerprintGatehouseValue("sudo-other-host") },
      endorsement,
    }),
  ).rejects.toThrow();
  await expect(
    f.verifier.verify({
      ...f.context,
      intent: { ...f.intent, action: { ...f.intent.action, authorityImpact: "expand" } },
      endorsement,
    }),
  ).rejects.toThrow();
});
test("rejects expired mandates and revoked agent credentials", async () => {
  const f = await fixture();
  const endorsement = await f.endorse();
  f.advance();
  await expect(f.verifier.verify({ ...f.context, endorsement })).rejects.toThrow();
  const g = await fixture();
  const other = await g.endorse();
  await revokeGatehouseP256Credential({
    registryHome: g.registryHome,
    credentialId: "credential.agent",
  });
  await expect(g.verifier.verify({ ...g.context, endorsement: other })).rejects.toThrow();
});
test("mandate revocation invalidates an admitted endorsement and unconsumed lease", async () => {
  const f = await fixture();
  await f.runtime.submitEndorsement(await f.endorse());
  await f.runtime.issueLease({
    gateId: f.submitted.gate.id,
    preconditionDigest: f.intent.preconditions.digest,
  });
  await revokeGatehouseExactDelegation({
    registryHome: f.registryHome,
    runtime: f.runtime,
    delegation: f.delegation,
    reason: "Owner withdrew exact authority",
  });
  expect((await f.runtime.inspectGate(f.submitted.gate.id))!.effectiveStatus).toBe("revoked");
  await expect(
    f.runtime.issueLease({
      gateId: f.submitted.gate.id,
      preconditionDigest: f.intent.preconditions.digest,
    }),
  ).rejects.toThrow();
});
