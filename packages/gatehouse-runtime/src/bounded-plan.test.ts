import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, unlink, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGatehouseActionIntent,
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
  type GatehouseExecutionLease,
} from "@reliverse/gatehouse-protocol";

import {
  createGatehouseBoundedPlanIntent,
  fingerprintGatehouseIntentSemantics,
} from "./bounded-plan";
import { createGatehouseRuntime } from "./runtime";
import {
  createStaticGatehouseEndorsementVerifier,
  signStaticGatehouseEndorsement,
} from "./testkit";
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
const owner = { id: "principal.owner", kind: "human" as const };
const system = { id: "service.runtime", kind: "service" as const };
function action(
  id: string,
  overrides: Partial<Parameters<typeof createGatehouseActionIntent>[0]> = {},
) {
  return createGatehouseActionIntent({
    id,
    createdAt: "2026-10-08T10:00:00.000Z",
    expiresAt: "2026-10-08T11:00:00.000Z",
    action: { kind: "repository.patch", effectClass: "filesystem.write", authorityImpact: "none" },
    requester: owner,
    actor: system,
    accountableSystem: system,
    target: {
      kind: "repository",
      id: "repo.fixture",
      parameters: { root: "/fixture", patch: "+reviewed", provider: "included", maximumCostUsd: 0 },
    },
    preconditions: { head: "immutable-head" },
    requestedCapability: {
      capability: "repository.write",
      executorClass: "fixture",
      scope: { path: "test.ts" },
    },
    policy: {
      id: "policy.owner",
      digest: fingerprintGatehouseValue("owner-policy"),
      authority: {
        kind: "all-of",
        independence: "distinct-perspectives",
        principalIds: [owner.id],
      },
    },
    presentation: {
      title: "Bounded patch",
      summary: "One reviewed file",
      consequences: ["No external writes"],
    },
    reversibility: "reversible",
    risk: "low",
    ...overrides,
  });
}
async function fixture(maxUses = 2, approve = true) {
  const home = await mkdtemp(path.join(tmpdir(), "gatehouse-plan-"));
  homes.push(home);
  let time = new Date("2026-10-08T10:00:00.000Z");
  const now = () => new Date(time);
  const options = {
    home,
    now,
    endorsementVerifier: createStaticGatehouseEndorsementVerifier({
      now,
      credentials: { "credential.owner": { principalId: owner.id, secret: "fixture-only" } },
    }),
  };
  const runtime = createGatehouseRuntime(options);
  const template = action("template");
  const plan = createGatehouseBoundedPlanIntent({
    entries: [{ intent: template, maxUses }],
    createdAt: now().toISOString(),
    expiresAt: "2026-10-08T10:30:00.000Z",
    title: "Review a bounded routine",
    summary: "Exact patch, at most two uses",
  });
  const submitted = await runtime.submitIntent(plan);
  const endorse = async (
    intent: GatehouseActionIntent,
    gateId: string,
    decision: "approve" | "deny",
  ) => {
    const unsigned = createGatehouseEndorsementSubmission({
      gateId,
      intentDigest: intent.digest,
      principalId: owner.id,
      credentialId: "credential.owner",
      decision,
      issuedAt: now().toISOString(),
      expiresAt: plan.expiresAt,
      assurance: {
        profile: "fixture",
        evidenceDigest: fingerprintGatehouseValue("fixture"),
        deviceBound: false,
        userPresence: false,
        userVerification: false,
      },
      proof: {
        profile: "fixture",
        signature: (signedDigest) =>
          signStaticGatehouseEndorsement({
            credentialId: "credential.owner",
            signedDigest,
            secret: "fixture-only",
          }),
      },
    });
    return runtime.submitEndorsement(unsigned);
  };
  if (approve) await endorse(plan, submitted.gate.id, "approve");
  const issue = async (intent: GatehouseActionIntent, host = runtime) => {
    const child = await host.submitIntent(intent);
    return host.issueLeaseFromPlan({
      gateId: child.gate.id,
      planGateId: submitted.gate.id,
      preconditionDigest: intent.preconditions.digest,
    });
  };
  const binding = (lease: GatehouseExecutionLease, attemptId = "attempt.one") => ({
    leaseId: lease.id,
    attemptId,
    capability: lease.capability,
    executorClass: lease.executorClass,
    intentDigest: lease.intentDigest,
    preconditionDigest: lease.preconditionDigest,
    scopeDigest: lease.scopeDigest,
    targetDigest: lease.targetDigest,
  });
  const finish = async (
    lease: GatehouseExecutionLease,
    outcome: "completed" | "outcome-unknown" | "execution-failed" = "completed",
  ) => {
    const consumed = await runtime.consumeLease(binding(lease));
    return runtime.recordExecution({
      gateId: lease.gateId,
      leaseId: lease.id,
      consumptionId: consumed.id,
      attemptId: consumed.attemptId,
      outcome,
      ...(outcome === "completed"
        ? { resultDigest: fingerprintGatehouseValue("done") }
        : { uncertainty: "retained fixture failure" }),
    });
  };
  return {
    runtime,
    options,
    plan,
    submitted,
    issue,
    binding,
    finish,
    endorse,
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
}
test("one signed finite plan admits fresh exact leases after semantic-equivalent identity regeneration", async () => {
  const f = await fixture();
  const first = action("first", { correlation: { runId: "run.first", traceId: "trace.first" } });
  const second = action("second", {
    nonce: "new.nonce",
    correlation: { runId: "run.second", traceId: "trace.second" },
  });
  expect(first.digest).not.toBe(second.digest);
  expect(fingerprintGatehouseIntentSemantics(first)).toBe(
    fingerprintGatehouseIntentSemantics(second),
  );
  const lease = await f.issue(first);
  expect(lease.planAuthorization?.planGateId).toBe(f.submitted.gate.id);
  await expect(f.issue(second)).rejects.toThrow("no new plan action");
  await f.finish(lease);
  await expect(
    f.runtime.consumeLease({ ...f.binding(lease), intentDigest: second.digest }),
  ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_BINDING_MISMATCH" });
  await expect(f.runtime.consumeLease(f.binding(lease, "replay"))).rejects.toMatchObject({
    code: "GATEHOUSE_LEASE_CONSUMED",
  });
  const next = await f.issue(second, createGatehouseRuntime(f.options));
  expect(next.id).not.toBe(lease.id);
  expect(next.intentDigest).toBe(second.digest);
  await f.finish(next);
  await expect(f.issue(action("third"))).rejects.toMatchObject({
    code: "GATEHOUSE_PLAN_USES_EXHAUSTED",
  });
  expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(2);
});
test("a pending plan is not authority, and a plan cannot obtain its own executable lease", async () => {
  const f = await fixture(2, false);
  await expect(f.issue(action("first"))).rejects.toMatchObject({
    code: "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
  });
  await f.endorse(f.plan, f.submitted.gate.id, "approve");
  await expect(
    f.runtime.issueLease({
      gateId: f.submitted.gate.id,
      preconditionDigest: f.plan.preconditions.digest,
    }),
  ).rejects.toMatchObject({ code: "GATEHOUSE_PLAN_NOT_EXECUTABLE" });
});
test("concurrent distinct claims cannot allocate a second action or refund an uncertain predecessor", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([f.issue(action("first")), f.issue(action("second"))]);
  const success = outcomes.filter((item) => item.status === "fulfilled");
  expect(success).toHaveLength(1);
  const lease = (success[0] as PromiseFulfilledResult<GatehouseExecutionLease>).value;
  await f.finish(lease, "outcome-unknown");
  await expect(
    f.issue(action("successor"), createGatehouseRuntime(f.options)),
  ).rejects.toMatchObject({ code: "GATEHOUSE_PLAN_PREDECESSOR_UNCONFIRMED" });
  expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(1);
});
test("crash between reservation and lease persistence burns the claim; only the same exact unconsumed child reconstructs", async () => {
  const f = await fixture();
  const intent = action("first");
  const lease = await f.issue(intent);
  await unlink(path.join(f.options.home, "gates", lease.gateId, "lease.json"));
  const reopened = createGatehouseRuntime(f.options);
  await expect(f.issue(action("other"), reopened)).rejects.toMatchObject({
    code: "GATEHOUSE_PLAN_PREDECESSOR_UNCONFIRMED",
  });
  expect(await f.issue(intent, reopened)).toEqual(lease);
  expect(await reopened.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(1);
});
for (const outcome of ["execution-failed", "outcome-unknown"] as const)
  test(`${outcome} ends automatic plan continuation without refund`, async () => {
    const f = await fixture();
    await f.finish(await f.issue(action("first")), outcome);
    await expect(f.issue(action("next"))).rejects.toMatchObject({
      code: "GATEHOUSE_PLAN_PREDECESSOR_UNCONFIRMED",
    });
  });
test("revocation invalidates active descendants while preserving historical consumption receipts", async () => {
  const f = await fixture();
  const lease = await f.issue(action("first"));
  await f.runtime.revoke({
    gateId: f.submitted.gate.id,
    actor: owner,
    reason: "Owner revoked routine",
  });
  expect((await f.runtime.inspectGate(lease.gateId))?.effectiveStatus).toBe("revoked");
  await expect(f.runtime.consumeLease(f.binding(lease))).rejects.toMatchObject({
    code: "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
  });
  await expect(f.issue(action("next"))).rejects.toMatchObject({
    code: "GATEHOUSE_PLAN_AUTHORITY_REQUIRED",
  });
  const completed = await fixture();
  const historical = await completed.issue(action("historical"));
  await completed.finish(historical);
  await completed.runtime.revoke({
    gateId: completed.submitted.gate.id,
    actor: owner,
    reason: "End routine",
  });
  expect((await completed.runtime.consumeLease(completed.binding(historical))).intentDigest).toBe(
    historical.intentDigest,
  );
});
test("changed scope, preconditions, actor, funding, policy and risk require a new independent review", async () => {
  const f = await fixture();
  for (const overrides of [
    { target: { kind: "repository", id: "foreign", parameters: {} } },
    { preconditions: { head: "changed" } },
    { actor: owner },
    {
      target: {
        kind: "repository",
        id: "repo.fixture",
        parameters: { root: "/fixture", patch: "+reviewed", provider: "api", maximumCostUsd: 1 },
      },
    },
    { policy: { ...f.plan.policy, digest: fingerprintGatehouseValue("changed") } },
    { risk: "moderate" as const },
    {
      requestedCapability: {
        capability: "repository.write",
        executorClass: "fixture",
        scope: { path: "other.ts" },
      },
    },
  ])
    await expect(f.issue(action(crypto.randomUUID(), overrides))).rejects.toMatchObject({
      code: "GATEHOUSE_PLAN_SCOPE_MISMATCH",
    });
  expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(0);
});
test("expired authority, child denial and ordinary lease APIs cannot bypass the plan", async () => {
  const f = await fixture();
  const intent = action("first");
  const lease = await f.issue(intent);
  await expect(
    f.runtime.issueLease({ gateId: lease.gateId, preconditionDigest: lease.preconditionDigest }),
  ).rejects.toMatchObject({ code: "GATEHOUSE_PLAN_AUTHORITY_REQUIRED" });
  await f.endorse(intent, lease.gateId, "deny");
  await expect(f.runtime.consumeLease(f.binding(lease))).rejects.toMatchObject({
    code: "GATEHOUSE_QUORUM_REQUIRED",
  });
  const expired = await fixture();
  const stale = await expired.issue(action("stale"));
  expired.advance(31 * 60_000);
  await expect(expired.runtime.consumeLease(expired.binding(stale))).rejects.toThrow();
});
test("reservation reconstruction cannot renew an explicitly shortened lease horizon", async () => {
  const f = await fixture();
  const intent = action("short");
  const child = await f.runtime.submitIntent(intent);
  const expiry = "2026-10-08T10:05:00.000Z";
  const lease = await f.runtime.issueLeaseFromPlan({
    gateId: child.gate.id,
    planGateId: f.submitted.gate.id,
    preconditionDigest: intent.preconditions.digest,
    expiresAt: expiry,
  });
  await unlink(path.join(f.options.home, "gates", child.gate.id, "lease.json"));
  await expect(
    f.runtime.issueLeaseFromPlan({
      gateId: child.gate.id,
      planGateId: f.submitted.gate.id,
      preconditionDigest: intent.preconditions.digest,
      expiresAt: f.plan.expiresAt,
    }),
  ).rejects.toMatchObject({ code: "GATEHOUSE_LEASE_EXPIRY_INVALID" });
  expect(await f.issue(intent)).toEqual(lease);
});
test("unknown semantic fields are preserved rather than silently discarded", async () => {
  const f = await fixture();
  const original = action("extra");
  const { digest: _digest, ...facts } = original;
  const withoutDigest = {
    ...facts,
    newAuthorityDimension: { destination: "outside-reviewed-scope" },
  };
  const changed = { ...withoutDigest, digest: fingerprintGatehouseValue(withoutDigest) };
  await expect(f.issue(changed)).rejects.toMatchObject({ code: "GATEHOUSE_PLAN_SCOPE_MISMATCH" });
});
test("missing lock record and expired live-owner lock never authorize concurrent plan mutation", async () => {
  const f = await fixture();
  const lock = path.join(f.options.home, "gates", f.submitted.gate.id, ".lock");
  await mkdir(lock);
  await expect(f.issue(action("first"))).rejects.toMatchObject({ code: "GATEHOUSE_GATE_BUSY" });
  await writeFile(
    path.join(lock, "lock.json"),
    JSON.stringify({
      id: "live-owner",
      pid: process.pid,
      acquiredAt: "2026-10-08T09:00:00.000Z",
      expiresAt: "2026-10-08T09:01:00.000Z",
    }),
  );
  await expect(f.issue(action("second"))).rejects.toMatchObject({ code: "GATEHOUSE_GATE_BUSY" });
  expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(0);
});
test("malformed abandoned-owner records fail closed rather than granting recovery authority", async () => {
  const f = await fixture();
  const lock = path.join(f.options.home, "gates", f.submitted.gate.id, ".lock");
  await mkdir(lock);
  for (const changed of [
    { id: undefined },
    { acquiredAt: "invalid" },
    { expiresAt: "invalid" },
    { pid: undefined },
  ]) {
    await writeFile(
      path.join(lock, "lock.json"),
      JSON.stringify({
        id: "dead-owner",
        pid: 2_147_483_647,
        acquiredAt: "2026-10-08T09:00:00.000Z",
        expiresAt: "2026-10-08T09:01:00.000Z",
        ...changed,
      }),
    );
    await expect(f.issue(action(crypto.randomUUID()))).rejects.toMatchObject({
      code: "GATEHOUSE_GATE_BUSY",
    });
  }
  expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(0);
});
test("an abandoned-lock recovery reservation cannot be bypassed or deleted", async () => {
  const f = await fixture();
  const lock = path.join(f.options.home, "gates", f.submitted.gate.id, ".lock");
  // Confirm the fixture PID is absent rather than assuming a particular host topology.
  expect(() => process.kill(2_147_483_647, 0)).toThrow();
  await mkdir(lock);
  await writeFile(
    path.join(lock, "lock.json"),
    JSON.stringify({
      id: "dead-owner",
      pid: 2_147_483_647,
      acquiredAt: "2026-10-08T09:00:00.000Z",
      expiresAt: "2026-10-08T09:01:00.000Z",
    }),
  );
  await mkdir(`${lock}.reclaim`);
  const intent = action("first");
  await expect(f.issue(intent)).rejects.toMatchObject({ code: "GATEHOUSE_GATE_BUSY" });
  expect(JSON.parse(await readFile(path.join(lock, "lock.json"), "utf8")).id).toBe("dead-owner");
  await rm(`${lock}.reclaim`, { recursive: true });
  expect((await f.issue(intent)).planAuthorization?.planGateId).toBe(f.submitted.gate.id);
});
for (const changed of [
  { resultDigest: undefined },
  { consumptionId: "foreign-consumption" },
  { attemptId: "foreign-attempt" },
  { leaseId: "foreign-lease" },
  { gateId: "foreign-gate" },
])
  test(`incomplete or foreign completed receipt blocks further plan use: ${Object.keys(changed)[0]}`, async () => {
    const f = await fixture();
    const lease = await f.issue(action("first"));
    const receipt = await f.finish(lease);
    const file = path.join(f.options.home, "gates", lease.gateId, "execution.json");
    await writeFile(file, JSON.stringify({ ...receipt, ...changed }));
    await expect(f.issue(action("next"))).rejects.toMatchObject({
      code: "GATEHOUSE_PLAN_PREDECESSOR_UNCONFIRMED",
    });
    expect(await f.runtime.inspectPlanClaims(f.submitted.gate.id)).toHaveLength(1);
  });
test("plan constructor rejects unbounded, authority-changing and irreversible routines", () => {
  for (const entries of [
    [{ intent: action("first"), maxUses: 0 }],
    [{ intent: action("first"), maxUses: 101 }],
    [{ intent: action("first", { risk: "critical" }), maxUses: 1 }],
    [{ intent: action("first", { reversibility: "irreversible" }), maxUses: 1 }],
    [
      {
        intent: action("first", {
          action: { kind: "grant", effectClass: "authority", authorityImpact: "expand" },
        }),
        maxUses: 1,
      },
    ],
  ])
    expect(() =>
      createGatehouseBoundedPlanIntent({
        entries,
        createdAt: "2026-10-08T10:00:00.000Z",
        expiresAt: "2026-10-08T10:30:00.000Z",
        title: "Plan",
        summary: "Bounded",
      }),
    ).toThrow();
});
