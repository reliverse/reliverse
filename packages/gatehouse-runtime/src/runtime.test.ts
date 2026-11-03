import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
} from "@reliverse/gatehouse-protocol";

import { GatehouseRuntimeError } from "./errors";
import { createGatehouseRuntime, type GatehouseRuntime } from "./runtime";
import {
  createStaticGatehouseEndorsementVerifier,
  signStaticGatehouseEndorsement,
} from "./testkit";

const homes: string[] = [];
const HUMAN = { id: "principal.human", kind: "human" as const };
const AGENT = {
  id: "principal.agent",
  kind: "agent" as const,
  ownerPrincipalId: HUMAN.id,
};
const SYSTEM = { id: "system.rse-gateway", kind: "service" as const };
const POLICY_DIGEST = fingerprintGatehouseValue({ policy: "all-of-human-and-agent-v0" });
const EVIDENCE_DIGEST = fingerprintGatehouseValue({ evidence: "test-user-presence" });

async function createHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "gatehouse-runtime-"));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { force: true, recursive: true })));
});

function createClock(initial = "2026-08-04T12:00:00.000Z") {
  let value = new Date(initial);
  return {
    now: () => new Date(value),
    advance(ms: number) {
      value = new Date(value.getTime() + ms);
    },
  };
}

function createRuntime(home: string, now: () => Date): GatehouseRuntime {
  return createGatehouseRuntime({
    home,
    now,
    endorsementVerifier: createStaticGatehouseEndorsementVerifier({
      now,
      credentials: {
        "credential.human": { principalId: HUMAN.id, secret: "human-secret" },
        "credential.agent": { principalId: AGENT.id, secret: "agent-secret" },
      },
    }),
  });
}

test("concurrent submissions preserve one exact intent and reject competing bytes", async () => {
  const clock = createClock();
  const home = await createHome();
  const intent = createIntent(clock.now());
  const results = await Promise.all(
    Array.from({ length: 4 }, () => createRuntime(home, clock.now).submitIntent(intent)),
  );
  expect(new Set(results.map((result) => result.gate.id)).size).toBe(1);
  expect(results.every((result) => result.intent.digest === intent.digest)).toBe(true);
  expect(await createRuntime(home, clock.now).listGates({ limit: 100 })).toHaveLength(1);
  const otherHome = await createHome();
  const changed = createIntent(clock.now(), { expiresAt: "2026-08-04T14:00:00.000Z" });
  const races = await Promise.allSettled(
    [intent, changed].map((candidate) =>
      createRuntime(otherHome, clock.now).submitIntent(candidate),
    ),
  );
  expect(races.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = races.find((result) => result.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: "GATEHOUSE_INTENT_ID_CONFLICT" });
  expect(await createRuntime(otherHome, clock.now).listGates({ limit: 100 })).toHaveLength(1);
});

test("revocation exact-inspection CAS refuses intervening lease issuance under the writer lock", async () => {
  const clock = createClock();
  const runtime = createRuntime(await createHome(), clock.now);
  const intent = createIntent(clock.now());
  const { gateId } = await approve(runtime, intent, clock.now());
  const before = await runtime.inspectGate(gateId);
  const lease = await runtime.issueLease({
    gateId,
    preconditionDigest: intent.preconditions.digest,
  });
  await expect(
    runtime.revoke({
      gateId,
      actor: HUMAN,
      reason: "Exact unused transition",
      expectedInspectionDigest: fingerprintGatehouseValue(before),
    }),
  ).rejects.toMatchObject({ code: "GATEHOUSE_REVOCATION_STATE_CHANGED" });
  expect((await runtime.inspectGate(gateId))?.revocations).toHaveLength(0);
  expect((await runtime.inspectGate(gateId))?.lease?.id).toBe(lease.id);
  const current = await runtime.inspectGate(gateId);
  await runtime.revoke({
    gateId,
    actor: HUMAN,
    reason: "Current exact transition",
    expectedInspectionDigest: fingerprintGatehouseValue(current),
  });
  expect((await runtime.inspectGate(gateId))?.effectiveStatus).toBe("revoked");
});

test("gate listing rejects limits above the bounded maximum", async () => {
  const clock = createClock();
  const runtime = createRuntime(await createHome(), clock.now);
  await expect(runtime.listGates({ limit: 101 })).rejects.toMatchObject({
    code: "GATEHOUSE_LIMIT_INVALID",
  });
});

test("gate listing includes newest hash-ID gates before older history at the bounded limit", async () => {
  const clock = createClock("2026-08-04T12:00:00.000Z");
  const runtime = createRuntime(await createHome(), clock.now);
  for (let index = 0; index < 105; index += 1) {
    clock.advance(1_000);
    const createdAt = clock.now();
    await runtime.submitIntent(
      createIntent(createdAt, {
        id: `intent.deploy.${String(index).padStart(3, "0")}`,
        expiresAt: new Date(createdAt.getTime() + 2 * 60 * 60_000).toISOString(),
      }),
    );
  }

  const listed = await runtime.listGates({ limit: 100 });
  expect(listed).toHaveLength(100);
  expect(listed[0]?.intent.id).toBe("intent.deploy.104");
  expect(listed.at(-1)?.intent.id).toBe("intent.deploy.005");
  expect(listed.some((entry) => entry.intent.id === "intent.deploy.000")).toBe(false);
  const older = await runtime.listGates({ limit: 100, afterGateId: listed.at(-1)!.gate.id });
  expect(older).toHaveLength(5);
  expect(older.at(-1)?.intent.id).toBe("intent.deploy.000");
  expect(new Set([...listed, ...older].map((item) => item.gate.id)).size).toBe(105);
  await expect(runtime.listGates({ afterGateId: "gate_missing" })).rejects.toMatchObject({
    code: "GATEHOUSE_CURSOR_INVALID",
  });
});

function createIntent(
  now: Date,
  input: {
    readonly authorityImpact?: GatehouseActionIntent["action"]["authorityImpact"];
    readonly id?: string;
    readonly actor?: typeof HUMAN | typeof AGENT;
    readonly expiresAt?: string;
  } = {},
): GatehouseActionIntent {
  return createGatehouseActionIntent({
    id: input.id ?? "intent.deploy.production",
    nonce: `nonce.${input.id ?? "intent.deploy.production"}`,
    createdAt: now.toISOString(),
    expiresAt: input.expiresAt ?? new Date(now.getTime() + 60 * 60_000).toISOString(),
    action: {
      authorityImpact: input.authorityImpact ?? "none",
      effectClass: "deployment.write",
      kind: "deployment.apply",
    },
    requester: AGENT,
    actor: input.actor ?? AGENT,
    accountableSystem: SYSTEM,
    target: {
      id: "deployment.production",
      kind: "deployment",
      parameters: { environment: "production", revision: "abc123" },
    },
    preconditions: { environmentDigest: "env-42", revision: "abc123" },
    requestedCapability: {
      capability: "deployment.apply",
      executorClass: "rse-gateway",
      maxAttempts: 1,
      scope: { environment: "production" },
    },
    policy: {
      authority: {
        kind: "all-of",
        independence: "distinct-perspectives",
        principalIds: [HUMAN.id, AGENT.id],
      },
      digest: POLICY_DIGEST,
      id: "policy.production-deploy",
    },
    presentation: {
      title: "Deploy revision abc123",
      summary: "Deploy the approved revision to production.",
      consequences: ["Production traffic may change."],
    },
    reversibility: "compensatable",
    risk: "high",
    correlation: { operationId: "deployment.apply", runId: "run_123" },
  });
}

function createEndorsement(input: {
  readonly gateId: string;
  readonly intent: GatehouseActionIntent;
  readonly principal: typeof HUMAN | typeof AGENT;
  readonly credentialId: "credential.human" | "credential.agent";
  readonly secret: string;
  readonly issuedAt: Date;
  readonly decision?: "approve" | "deny" | "request-changes";
  readonly expiresAt?: string;
}) {
  return createGatehouseEndorsementSubmission({
    id: `endorsement.${input.principal.id}.${input.issuedAt.getTime()}`,
    nonce: `nonce.${input.principal.id}.${input.issuedAt.getTime()}`,
    gateId: input.gateId,
    intentDigest: input.intent.digest,
    principalId: input.principal.id,
    credentialId: input.credentialId,
    decision: input.decision ?? "approve",
    assurance: {
      deviceBound: true,
      evidenceDigest: EVIDENCE_DIGEST,
      profile: "gatehouse.test.static",
      userPresence: input.principal.kind === "human",
      userVerification: input.principal.kind === "human",
    },
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt ?? new Date(input.issuedAt.getTime() + 10 * 60_000).toISOString(),
    proof: {
      profile: "gatehouse.test.static",
      signature: (signedDigest) =>
        signStaticGatehouseEndorsement({
          credentialId: input.credentialId,
          signedDigest,
          secret: input.secret,
        }),
    },
  });
}

async function approve(runtime: GatehouseRuntime, intent: GatehouseActionIntent, now: Date) {
  const submitted = await runtime.submitIntent(intent);
  await runtime.submitEndorsement(
    createEndorsement({
      gateId: submitted.gate.id,
      intent,
      principal: HUMAN,
      credentialId: "credential.human",
      secret: "human-secret",
      issuedAt: now,
    }),
  );
  const approved = await runtime.submitEndorsement(
    createEndorsement({
      gateId: submitted.gate.id,
      intent,
      principal: AGENT,
      credentialId: "credential.agent",
      secret: "agent-secret",
      issuedAt: new Date(now.getTime() + 1),
    }),
  );
  return { gateId: submitted.gate.id, approval: approved.approvalBundle };
}

function consumptionInput(intent: GatehouseActionIntent, leaseId: string, attemptId: string) {
  return {
    attemptId,
    capability: intent.requestedCapability.capability,
    executorClass: intent.requestedCapability.executorClass,
    intentDigest: intent.digest,
    leaseId,
    preconditionDigest: intent.preconditions.digest,
    scopeDigest: intent.requestedCapability.scopeDigest,
    targetDigest: intent.target.digest,
  };
}

describe("Gatehouse runtime", () => {
  test("default lease has no implicit TTL, preserves authority horizons and remains one-shot after delay", async () => {
    const clock = createClock();
    const home = await createHome();
    const runtime = createRuntime(home, clock.now);
    const never = "9999-12-31T23:59:59.999Z";
    const intent = createIntent(clock.now(), { expiresAt: never });
    const submitted = await runtime.submitIntent(intent);
    for (const [principal, credentialId, secret] of [
      [HUMAN, "credential.human", "human-secret"],
      [AGENT, "credential.agent", "agent-secret"],
    ] as const) {
      await runtime.submitEndorsement(
        createEndorsement({
          gateId: submitted.gate.id,
          intent,
          principal,
          credentialId,
          secret,
          issuedAt: clock.now(),
          expiresAt: never,
        }),
      );
    }
    clock.advance(24 * 60 * 60_000);
    const lease = await createRuntime(home, clock.now).issueLease({
      gateId: submitted.gate.id,
      preconditionDigest: intent.preconditions.digest,
    });
    expect(lease.expiresAt).toBe(never);
    clock.advance(24 * 60 * 60_000);
    await runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.delayed"));
    await expect(
      runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.replay")),
    ).rejects.toBeDefined();
  });

  test("default lease cannot outlive accepted endorsements or explicit product Gate expiry", async () => {
    const clock = createClock();
    const runtime = createRuntime(await createHome(), clock.now);
    const intent = createIntent(clock.now(), {
      expiresAt: new Date(clock.now().getTime() + 60_000).toISOString(),
    });
    const { gateId } = await approve(runtime, intent, clock.now());
    expect(
      (await runtime.issueLease({ gateId, preconditionDigest: intent.preconditions.digest }))
        .expiresAt,
    ).toBe(intent.expiresAt);
    const other = createRuntime(await createHome(), clock.now);
    const longer = createIntent(clock.now());
    const approved = await approve(other, longer, clock.now());
    await expect(
      other.issueLease({
        gateId: approved.gateId,
        preconditionDigest: longer.preconditions.digest,
        expiresAt: longer.expiresAt,
      }),
    ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_EXPIRY_INVALID" });
    expect(
      (
        await other.issueLease({
          gateId: approved.gateId,
          preconditionDigest: longer.preconditions.digest,
        })
      ).expiresAt,
    ).toBe(new Date(clock.now().getTime() + 10 * 60_000).toISOString());
  });
  test("persists exact quorum, lease, consumption, and execution receipts across restart", async () => {
    const home = await createHome();
    const clock = createClock();
    const intent = createIntent(clock.now());
    const runtime = createRuntime(home, clock.now);
    const { gateId, approval } = await approve(runtime, intent, clock.now());
    expect(approval.status).toBe("quorum-satisfied");

    const lease = await runtime.issueLease({
      gateId,
      preconditionDigest: intent.preconditions.digest,
    });
    const consumption = await runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.1"));
    const execution = await runtime.recordExecution({
      attemptId: "attempt.1",
      consumptionId: consumption.id,
      gateId,
      leaseId: lease.id,
      outcome: "completed",
      resultDigest: fingerprintGatehouseValue({ deploymentId: "deployment-1" }),
    });

    const restarted = createRuntime(home, clock.now);
    const inspection = await restarted.inspectGate(gateId);
    expect(inspection?.effectiveStatus).toBe("completed");
    expect(inspection?.consumption?.id).toBe(consumption.id);
    expect(inspection?.execution?.id).toBe(execution.id);
  });

  test("allows exactly one concurrent consumer for a one-shot lease", async () => {
    const home = await createHome();
    const clock = createClock();
    const intent = createIntent(clock.now());
    const runtime = createRuntime(home, clock.now);
    const { gateId } = await approve(runtime, intent, clock.now());
    const lease = await runtime.issueLease({
      gateId,
      preconditionDigest: intent.preconditions.digest,
    });

    const results = await Promise.allSettled([
      runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.a")),
      runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.b")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  test("rejects changed preconditions, delayed leases, and revoked authority", async () => {
    const home = await createHome();
    const clock = createClock();
    const intent = createIntent(clock.now());
    const runtime = createRuntime(home, clock.now);
    const { gateId } = await approve(runtime, intent, clock.now());
    const lease = await runtime.issueLease({
      gateId,
      preconditionDigest: intent.preconditions.digest,
      expiresAt: new Date(clock.now().getTime() + 1_000).toISOString(),
    });

    await expect(
      runtime.consumeLease({
        ...consumptionInput(intent, lease.id, "attempt.changed"),
        preconditionDigest: fingerprintGatehouseValue({ environmentDigest: "changed" }),
      }),
    ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_BINDING_MISMATCH" });

    await runtime.revoke({ gateId, actor: HUMAN, reason: "Production window closed." });
    await expect(
      runtime.consumeLease(consumptionInput(intent, lease.id, "attempt.revoked")),
    ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_REVOKED" });

    const otherHome = await createHome();
    const otherRuntime = createRuntime(otherHome, clock.now);
    const otherIntent = createIntent(clock.now(), { id: "intent.expiring" });
    const approved = await approve(otherRuntime, otherIntent, clock.now());
    const expiring = await otherRuntime.issueLease({
      gateId: approved.gateId,
      preconditionDigest: otherIntent.preconditions.digest,
      expiresAt: new Date(clock.now().getTime() + 1_000).toISOString(),
    });
    clock.advance(2_000);
    await expect(
      otherRuntime.consumeLease(consumptionInput(otherIntent, expiring.id, "attempt.late")),
    ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_EXPIRED" });
  });

  test("fails closed without an admitted verifier", async () => {
    const home = await createHome();
    const clock = createClock();
    const runtime = createGatehouseRuntime({ home, now: clock.now });
    const intent = createIntent(clock.now());
    const gate = await runtime.submitIntent(intent);
    await expect(
      runtime.submitEndorsement(
        createEndorsement({
          gateId: gate.gate.id,
          intent,
          principal: HUMAN,
          credentialId: "credential.human",
          secret: "human-secret",
          issuedAt: clock.now(),
        }),
      ),
    ).rejects.toMatchObject({ code: "GATEHOUSE_ENDORSEMENT_VERIFIER_UNAVAILABLE" });
  });

  test("forbids an actor from approving its own expanded authority", async () => {
    const home = await createHome();
    const clock = createClock();
    const runtime = createRuntime(home, clock.now);
    const intent = createIntent(clock.now(), { authorityImpact: "expand", actor: AGENT });
    const gate = await runtime.submitIntent(intent);
    await expect(
      runtime.submitEndorsement(
        createEndorsement({
          gateId: gate.gate.id,
          intent,
          principal: AGENT,
          credentialId: "credential.agent",
          secret: "agent-secret",
          issuedAt: clock.now(),
        }),
      ),
    ).rejects.toMatchObject({ code: "GATEHOUSE_SELF_APPROVAL_FORBIDDEN" });
  });

  test("uses typed runtime errors", () => {
    expect(new GatehouseRuntimeError("CODE", "message")).toMatchObject({ code: "CODE" });
  });
});
