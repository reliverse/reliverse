import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
  type GatehouseEndorsementSubmission,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";

import {
  createGatehouseP256EndorsementVerifier,
  createLocalGatehouseP256Endorsement,
  enrollLocalGatehouseP256Credential,
  revokeGatehouseP256Credential,
} from "./index";

const roots: string[] = [];
const PRINCIPAL = { id: "principal.owner", kind: "human" as const };
const AGENT = {
  id: "principal.agent",
  kind: "agent" as const,
  ownerPrincipalId: PRINCIPAL.id,
};

async function createHomes() {
  const root = await mkdtemp(path.join(os.tmpdir(), "gatehouse-p256-"));
  roots.push(root);
  return {
    authorityHome: path.join(root, "authority"),
    registryHome: path.join(root, "runtime", "credentials", "p256"),
    runtimeHome: path.join(root, "runtime"),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function createClock(initial = "2026-09-11T08:00:00.000Z") {
  let value = new Date(initial);
  return {
    now: () => new Date(value),
    advance: (milliseconds: number) => {
      value = new Date(value.getTime() + milliseconds);
    },
  };
}

function createIntent(now: Date, id = "intent.production-owner-proof"): GatehouseActionIntent {
  return createGatehouseActionIntent({
    id,
    nonce: `nonce.${id}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    action: { authorityImpact: "none", effectClass: "local.write", kind: "evidence.write" },
    requester: AGENT,
    actor: AGENT,
    accountableSystem: { id: "system.rse-gateway", kind: "service" },
    target: { id: "target.harmless", kind: "local.file", parameters: { content: "ok" } },
    preconditions: { absent: true },
    requestedCapability: {
      capability: "evidence.write",
      executorClass: "rse-gateway",
      maxAttempts: 1,
      scope: { path: "harmless-proof.json" },
    },
    policy: {
      authority: {
        kind: "all-of",
        independence: "distinct-trust-roots",
        principalIds: [PRINCIPAL.id],
      },
      digest: fingerprintGatehouseValue({ policy: "owner-p256-v0" }),
      id: "policy.owner-p256-v0",
    },
    presentation: {
      title: "Write harmless proof",
      summary: "Exercise the production endorsement chain.",
      consequences: ["A removable local evidence file may be written."],
    },
    reversibility: "reversible",
    risk: "low",
  });
}

async function setup() {
  const homes = await createHomes();
  const clock = createClock();
  await enrollLocalGatehouseP256Credential({
    ...homes,
    credentialId: "credential.owner.vps",
    principalId: PRINCIPAL.id,
    decisionRef: "owner.delegation.2026-09-11",
    expiresAt: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    now: clock.now,
  });
  const runtime = createGatehouseRuntime({
    home: homes.runtimeHome,
    now: clock.now,
    endorsementVerifier: createGatehouseP256EndorsementVerifier({
      registryHome: homes.registryHome,
      now: clock.now,
    }),
  });
  const intent = createIntent(clock.now());
  const submitted = await runtime.submitIntent(intent);
  const endorsement = await createLocalGatehouseP256Endorsement({
    authorityHome: homes.authorityHome,
    credentialId: "credential.owner.vps",
    gateId: submitted.gate.id,
    intentDigest: intent.digest,
    decision: "approve",
    expiresAt: new Date(clock.now().getTime() + 30_000).toISOString(),
    now: clock.now,
  });
  return { clock, endorsement, homes, intent, runtime, submitted };
}

function withChangedSignature(
  endorsement: GatehouseEndorsementSubmission,
): GatehouseEndorsementSubmission {
  const withoutDigest = {
    ...endorsement,
    proof: { ...endorsement.proof, signature: "AA" },
  };
  const { digest: _digest, ...semantic } = withoutDigest;
  return { ...semantic, digest: fingerprintGatehouseValue(semantic) };
}

describe("Gatehouse P-256 production adapter", () => {
  test("enrolls public-only verifier material and completes a one-shot chain", async () => {
    const { endorsement, intent, runtime, submitted } = await setup();
    const accepted = await runtime.submitEndorsement(endorsement);
    expect(accepted.approvalBundle.status).toBe("quorum-satisfied");
    expect(accepted.gate.status).toBe("quorum-satisfied");
    const replay = await runtime.submitEndorsement(endorsement);
    expect(replay.decisionReceipt.id).toBe(accepted.decisionReceipt.id);

    const lease = await runtime.issueLease({
      gateId: submitted.gate.id,
      preconditionDigest: intent.preconditions.digest,
    });
    const binding = {
      attemptId: "attempt.owner-proof",
      capability: intent.requestedCapability.capability,
      executorClass: intent.requestedCapability.executorClass,
      intentDigest: intent.digest,
      leaseId: lease.id,
      preconditionDigest: intent.preconditions.digest,
      scopeDigest: intent.requestedCapability.scopeDigest,
      targetDigest: intent.target.digest,
    };
    const consumed = await runtime.consumeLease(binding);
    await expect(
      runtime.consumeLease({ ...binding, attemptId: "attempt.replay" }),
    ).rejects.toMatchObject({
      code: "GATEHOUSE_LEASE_CONSUMED",
    });
    const receipt = await runtime.recordExecution({
      attemptId: binding.attemptId,
      consumptionId: consumed.id,
      gateId: submitted.gate.id,
      leaseId: lease.id,
      outcome: "completed",
      resultDigest: fingerprintGatehouseValue({ written: true }),
    });
    expect(receipt.outcome).toBe("completed");
  });

  test("rejects invalid signatures and assurance inflation", async () => {
    const first = await setup();
    await expect(
      first.runtime.submitEndorsement(withChangedSignature(first.endorsement)),
    ).rejects.toMatchObject({
      code: "GATEHOUSE_P256_SIGNATURE_INVALID",
    });

    const second = await setup();
    const changed = {
      ...second.endorsement,
      assurance: { ...second.endorsement.assurance, userPresence: true },
    };
    const { digest: _digest, ...semantic } = changed;
    await expect(
      second.runtime.submitEndorsement({
        ...semantic,
        digest: fingerprintGatehouseValue(semantic),
      }),
    ).rejects.toMatchObject({ code: "GATEHOUSE_P256_ASSURANCE_INFLATION" });
  });

  test("rejects wrong intent, expired endorsement, and revoked credentials", async () => {
    const wrong = await setup();
    const otherIntent = createIntent(wrong.clock.now(), "intent.other");
    const mismatched = await createLocalGatehouseP256Endorsement({
      authorityHome: wrong.homes.authorityHome,
      credentialId: "credential.owner.vps",
      gateId: wrong.submitted.gate.id,
      intentDigest: otherIntent.digest,
      decision: "approve",
      expiresAt: new Date(wrong.clock.now().getTime() + 30_000).toISOString(),
      now: wrong.clock.now,
    });
    await expect(wrong.runtime.submitEndorsement(mismatched)).rejects.toMatchObject({
      code: "GATEHOUSE_ENDORSEMENT_INTENT_MISMATCH",
    });

    const expired = await setup();
    expired.clock.advance(31_000);
    await expect(expired.runtime.submitEndorsement(expired.endorsement)).rejects.toMatchObject({
      code: "GATEHOUSE_ENDORSEMENT_EXPIRED",
    });

    const revoked = await setup();
    await revokeGatehouseP256Credential({
      registryHome: revoked.homes.registryHome,
      credentialId: "credential.owner.vps",
    });
    await expect(revoked.runtime.submitEndorsement(revoked.endorsement)).rejects.toMatchObject({
      code: "GATEHOUSE_P256_CREDENTIAL_REVOKED",
    });
  });
});
