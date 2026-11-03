import { expect, test } from "bun:test";

import {
  assertRvsUserDelegationUsable,
  bindRvsUserExecutionIdentity,
  createRvsUserDelegation,
  delegateRvsUserAuthority,
  moveRvsUserExecutionPlacement,
  revokeRvsUserDelegation,
  type RvsUserAuthorityEnvelope,
} from "./delegation";

const principal = {
  id: "prn_00000000000000000000000000000001" as const,
  kind: "human" as const,
};
const human = { id: "actor.owner", kind: "human" as const };
const agent = { id: "agt_prime", kind: "agent" as const };
const service = { id: "svc_reviewer", kind: "service" as const };
const authorityRefs = [
  {
    kind: "gatehouse-execution-lease" as const,
    id: "lease.root",
    digest: `sha256:${"0".repeat(64)}` as const,
  },
];
const parentEnvelope: RvsUserAuthorityEnvelope = {
  capabilities: ["repo.read", "repo.write", "network.read"],
  resourceScopes: ["repo:reliverse", "repo:global-handoff"],
  effectClasses: ["fs.read", "fs.write", "network.read"],
  executionPlacements: ["local", "gateway", "process", "wasm", "service", "remote"],
  expiresAt: "2026-09-13T14:00:00.000Z",
  maxUses: 20,
  maxCostMicros: 2_000_000,
  remainingDelegationDepth: 2,
  redelegation: true,
};

function chain() {
  const root = createRvsUserDelegation({
    id: "dlg.root",
    delegator: human,
    delegate: agent,
    actingFor: principal,
    authorityRefs,
    envelope: parentEnvelope,
    purpose: "Implement the bounded WorkTurn",
    workTurnId: "wt_daily-driver",
    createdAt: "2026-09-13T12:00:00.000Z",
  });
  const child = delegateRvsUserAuthority([root], {
    id: "dlg.child",
    delegate: service,
    envelope: {
      capabilities: ["repo.read"],
      resourceScopes: ["repo:reliverse"],
      effectClasses: ["fs.read"],
      executionPlacements: ["local", "remote"],
      expiresAt: "2026-09-13T13:00:00.000Z",
      maxUses: 3,
      maxCostMicros: 100_000,
      remainingDelegationDepth: 1,
      redelegation: false,
    },
    purpose: "Review the implementation",
    workTurnId: "wt_daily-driver",
    createdAt: "2026-09-13T12:01:00.000Z",
  });
  return [root, child] as const;
}

test("delegates Principal to Agent to service with monotonically attenuated authority", () => {
  const [root, child] = chain();
  expect(child).toMatchObject({
    delegator: agent,
    delegate: service,
    actingFor: principal,
    parentDelegationId: root.id,
    status: "active",
  });
  expect(() =>
    delegateRvsUserAuthority([root], {
      id: "dlg.amplified",
      delegate: service,
      envelope: {
        ...parentEnvelope,
        capabilities: [...parentEnvelope.capabilities, "production.admin"],
        remainingDelegationDepth: 1,
      },
      purpose: "invalid amplification",
      createdAt: "2026-09-13T12:01:00.000Z",
    }),
  ).toThrow("DELEGATION_AMPLIFICATION");
});

test("revocation and expiry deny later use without rewriting historical execution provenance", () => {
  const [root, child] = chain();
  const execution = bindRvsUserExecutionIdentity({
    id: "exec.identity.1",
    workTurnId: "wt_daily-driver",
    runId: "run_review_1",
    delegationChain: [root, child],
    materialization: {
      executionContextId: "ctx.local.1",
      computerId: "computer.workstation",
      placement: { kind: "local", providerId: "rvs.local", targetId: "target.local" },
    },
    at: "2026-09-13T12:02:00.000Z",
  });
  const revokedRoot = revokeRvsUserDelegation(root, {
    revokedBy: principal.id,
    reason: "owner stopped delegated work",
    at: "2026-09-13T12:03:00.000Z",
  });
  expect(() =>
    assertRvsUserDelegationUsable([revokedRoot, child], "2026-09-13T12:04:00.000Z"),
  ).toThrow("DELEGATION_REVOKED");
  expect(() =>
    assertRvsUserDelegationUsable([root, child], "2026-09-13T13:00:00.000Z"),
  ).toThrow("DELEGATION_EXPIRED");
  expect(execution).toMatchObject({
    actor: service,
    actingFor: principal,
    workTurnId: "wt_daily-driver",
    runId: "run_review_1",
    delegationIds: ["dlg.root", "dlg.child"],
  });
});

test("moves one logical WorkTurn across placements without changing actor identity", () => {
  const delegationChain = chain();
  const local = bindRvsUserExecutionIdentity({
    id: "exec.identity.1",
    workTurnId: "wt_daily-driver",
    runId: "run_review_1",
    delegationChain,
    materialization: {
      executionContextId: "ctx.local.1",
      computerId: "computer.workstation",
      placement: { kind: "local", providerId: "rvs.local", targetId: "target.local" },
    },
    at: "2026-09-13T12:02:00.000Z",
  });
  const remote = moveRvsUserExecutionPlacement(local, {
    expectedRevision: 1,
    delegationChain,
    materialization: {
      executionContextId: "ctx.remote.1",
      computerId: "computer.worker",
      gatewayId: "gateway.rse",
      placement: { kind: "remote", providerId: "rvs.network", targetId: "target.worker" },
    },
    at: "2026-09-13T12:03:00.000Z",
  });
  expect(remote).toMatchObject({
    id: local.id,
    actor: local.actor,
    actingFor: local.actingFor,
    workTurnId: local.workTurnId,
    runId: local.runId,
    revision: 2,
  });
  expect(remote.materializationHistory).toHaveLength(2);
  expect(remote.authorityRefs).toEqual(local.authorityRefs);
  expect(() =>
    moveRvsUserExecutionPlacement(remote, {
      expectedRevision: 2,
      delegationChain,
      materialization: {
        executionContextId: "ctx.gateway.1",
        gatewayId: "gateway.present",
        placement: { kind: "gateway", providerId: "rvs.gateway", targetId: "target.gateway" },
      },
      at: "2026-09-13T12:04:00.000Z",
    }),
  ).toThrow("EXECUTION_PLACEMENT_FORBIDDEN");
});

test("execution domain is a scoped portable reference, not an inferred native identity", () => {
  const [root, child] = chain();
  const domain = { id: "domain.review", policyDigest: `sha256:${"a".repeat(64)}` as const, bindingRef: "rvs:binding:review:first" };
  const scoped = [
    { ...root, envelope: { ...root.envelope, resourceScopes: [...root.envelope.resourceScopes, "execution-domain:domain.review"] } },
    { ...child, envelope: { ...child.envelope, resourceScopes: [...child.envelope.resourceScopes, "execution-domain:domain.review"] } },
  ];
  const input = { id: "exec.domain-review", workTurnId: "wt_daily-driver", runId: "run_review_1", delegationChain: scoped,
    materialization: { executionContextId: "ctx.one", placement: { kind: "local" as const, providerId: "fixture", targetId: "fixture.one" }, executionDomain: domain },
    at: "2026-09-13T12:02:00.000Z" };
  expect(() => bindRvsUserExecutionIdentity({ ...input, delegationChain: [root, child] })).toThrow("RVS_USER_EXECUTION_DOMAIN_FORBIDDEN");
  const current = bindRvsUserExecutionIdentity(input);
  const moved = moveRvsUserExecutionPlacement(current, { expectedRevision: 1, delegationChain: scoped,
    materialization: { ...input.materialization, executionContextId: "ctx.reconnected", placement: { kind: "remote", providerId: "fixture.remote", targetId: "fixture.two" },
      executionDomain: { ...domain, bindingRef: "rvs:binding:review:successor" } }, at: "2026-09-13T12:03:00.000Z" });
  expect(moved.actor).toEqual(current.actor); expect(moved.actingFor).toEqual(current.actingFor);
  expect(moved.materialization.executionDomain?.id).toBe(domain.id);
  expect(moved.materializationHistory[0]?.executionDomain?.bindingRef).toBe(domain.bindingRef);
  for (const changed of [undefined, { ...domain, id: "domain.other" }, { ...domain, policyDigest: `sha256:${"b".repeat(64)}` as const }])
    expect(() => moveRvsUserExecutionPlacement(current, { expectedRevision: 1, delegationChain: scoped,
      materialization: { ...input.materialization, executionDomain: changed }, at: "2026-09-13T12:03:00.000Z" })).toThrow("RVS_USER_EXECUTION_DOMAIN_CHANGED");
  expect(() => bindRvsUserExecutionIdentity({ ...input, materialization: { ...input.materialization, executionDomain: { ...domain, policyDigest: "invalid" as typeof domain.policyDigest } } })).toThrow("RVS_USER_EXECUTION_DOMAIN_INVALID");
});

test("recovery cannot replace actor, Principal or authority while retaining delegation IDs", () => {
  const delegationChain = chain();
  const materialization = { executionContextId: "ctx.one", placement: { kind: "local" as const, providerId: "fixture", targetId: "fixture.one" } };
  const current = bindRvsUserExecutionIdentity({ id: "exec.review", workTurnId: "wt_daily-driver", runId: "run_review_1", delegationChain,
    materialization, at: "2026-09-13T12:02:00.000Z" });
  for (const changed of [
    [delegationChain[0], { ...delegationChain[1], delegate: { id: "foreign", kind: "service" as const } }],
    delegationChain.map(d => ({ ...d, actingFor: { ...d.actingFor, id: "prn_00000000000000000000000000000002" as const } })),
    delegationChain.map(d => ({ ...d, authorityRefs: d.authorityRefs.map(r => ({ ...r, digest: `sha256:${"b".repeat(64)}` as const })) })),
  ]) expect(() => moveRvsUserExecutionPlacement(current, { expectedRevision: 1, delegationChain: changed,
    materialization, at: "2026-09-13T12:03:00.000Z" })).toThrow("RVS_USER_EXECUTION_AUTHORITY_CHANGED");
});
test("deterministic Cap/Harness execution needs no synthetic Rse WorkTurn", () => {
  const [root, child] = chain();
  const delegationChain = [root, child].map(({ workTurnId: _workTurn, ...d }) => d);
  const input = { id: "exec.cap-observation", runId: "harness.run.observation", delegationChain,
    materialization: { executionContextId: "ctx.cap", placement: { kind: "local" as const, providerId: "fixture", targetId: "fixture" } },
    at: "2026-09-13T12:02:00.000Z" };
  const result = bindRvsUserExecutionIdentity(input);
  expect(result.workTurnId).toBeUndefined(); expect(result.actor).toEqual(child.delegate);
  expect(result.actingFor).toEqual(principal);
  expect(() => bindRvsUserExecutionIdentity({ ...input, delegationChain: [root, child] })).toThrow("RVS_USER_WORK_TURN_MISMATCH");
});
