import { expect, test } from "bun:test";

import { createReliversePrincipal } from "@reliverse/home";

import {
  assignMyRseRole,
  bindRvsUserActor,
  bindRvsUserOwnedAgentActor,
  inspectRvsUserIdentity,
  revokeMyRseRole,
  revokeRvsUserActorBinding,
  transferMyRseRole,
  type RvsUserAgentIdentity,
} from "./index";

const principal = createReliversePrincipal({
  id: "prn_00000000000000000000000000000001",
  handle: "owner",
  principalKind: "human",
  createdAt: "2026-09-13T12:00:00.000Z",
});

const firstParty: RvsUserAgentIdentity = {
  id: "agt_first",
  ownerPrincipalId: principal.id,
  provenance: { origin: "first-party", implementationId: "rse.native" },
  status: "active",
};
const external: RvsUserAgentIdentity = {
  id: "agt_external",
  ownerPrincipalId: principal.id,
  provenance: { origin: "external", implementationId: "partner.agent" },
  status: "active",
};

test("first-party and external Agents satisfy the same My Rse eligibility contract", () => {
  const first = assignMyRseRole({
    id: "role.my-rse.first",
    principal,
    agent: firstParty,
    assignedBy: principal.id,
  });
  const second = assignMyRseRole({
    id: "role.my-rse.external",
    principal,
    agent: external,
    assignedBy: principal.id,
  });
  expect(first.agentId).toBe(firstParty.id);
  expect(second.agentId).toBe(external.id);
  expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
  expect(JSON.stringify(first)).not.toContain("capabilit");
  expect(JSON.stringify(second)).not.toContain("authority");
});

test("My Rse transfers without changing Principal or Agent identity and can be revoked", () => {
  const original = assignMyRseRole({
    id: "role.my-rse",
    principal,
    agent: firstParty,
    assignedBy: principal.id,
    at: "2026-09-13T12:00:00.000Z",
  });
  const transferred = transferMyRseRole(original, {
    expectedRevision: 1,
    agent: external,
    transferredBy: principal.id,
    at: "2026-09-13T12:01:00.000Z",
  });
  expect(transferred).toMatchObject({
    id: original.id,
    principalId: principal.id,
    agentId: external.id,
    revision: 2,
    status: "assigned",
  });
  expect(transferred.history.map((entry) => entry.kind)).toEqual(["assigned", "transferred"]);
  expect(firstParty.id).toBe("agt_first");
  expect(() =>
    transferMyRseRole(transferred, {
      expectedRevision: 2,
      agent: firstParty,
      transferredBy: "prn_00000000000000000000000000000002",
    }),
  ).toThrow("ROLE_OWNER_REQUIRED");

  const revoked = revokeMyRseRole(transferred, {
    expectedRevision: 2,
    revokedBy: principal.id,
    reason: "owner removed primary role",
    at: "2026-09-13T12:02:00.000Z",
  });
  expect(revoked.status).toBe("revoked");
  expect(() =>
    transferMyRseRole(revoked, {
      expectedRevision: 3,
      agent: firstParty,
      transferredBy: principal.id,
    }),
  ).toThrow("MY_RSE_REVOKED");
});

test("Actor bindings retain proof and revocation but never imply execution authority", () => {
  const binding = bindRvsUserActor({
    id: "binding.local-owner",
    principal,
    actor: { id: "device.workstation", kind: "device" },
    provider: { id: "local-os", subject: "uid:1000" },
    proof: { kind: "os-user", reference: "proof:local:1" },
    assurance: "verified",
    boundBy: principal.id,
    createdAt: "2026-09-13T12:00:00.000Z",
  });
  expect(() =>
    revokeRvsUserActorBinding(binding, {
      revokedBy: "prn_00000000000000000000000000000002",
      reason: "unauthorized",
    }),
  ).toThrow("BINDING_OWNER_REQUIRED");
  const revoked = revokeRvsUserActorBinding(binding, {
    revokedBy: principal.id,
    at: "2026-09-13T12:03:00.000Z",
    reason: "device retired",
  });
  const inspected = inspectRvsUserIdentity({ principal, bindings: [revoked] });
  expect(inspected).toMatchObject({ authority: "not-modeled-here" });
  expect(revoked).toMatchObject({
    status: "revoked",
    revokedByPrincipalId: principal.id,
    revocationReason: "device retired",
  });
  expect(JSON.stringify(inspected)).not.toContain("grant");
  expect(JSON.stringify(inspected)).not.toContain("secret");
});

function ownedAgentBindingInput(): Parameters<typeof bindRvsUserOwnedAgentActor>[0] {
  const reviewer = createReliversePrincipal({
    handle: "independent-reviewer",
    principalKind: "agent",
    id: "prn_cccccccccccccccccccccccccccccccc",
  });
  return {
    id: "binding.fixture-reviewer",
    owner: structuredClone(principal),
    principal: structuredClone(reviewer),
    agent: {
      id: "agent.fixture-reviewer",
      principalId: reviewer.id,
      ownerPrincipalId: principal.id,
      provenance: { origin: "external" },
      status: "active",
    },
    actor: { id: "os-user.uid-1002", kind: "agent" },
    provider: { id: "local-os", subject: "uid:1002" },
    proof: {
      kind: "fixture-independent-enrollment",
      reference: "fixture-root-proof",
      digest: `sha256:${"a".repeat(64)}`,
    },
    assurance: "verified",
    boundBy: principal.id,
    createdAt: "2026-10-17T12:00:00Z",
  };
}

test("owner-bound independent Agent preserves canonical identity, enroller and ordinary self-binding law", () => {
  const input = ownedAgentBindingInput();
  expect(() => bindRvsUserActor(input)).toThrow("RVS_USER_BINDING_OWNER_REQUIRED");
  const binding = bindRvsUserOwnedAgentActor(input);
  expect(binding.principal).toEqual({ id: input.principal.id, kind: "agent" });
  expect(binding.boundByPrincipalId).toBe(principal.id);
  expect(binding.actor.id).not.toBe(input.agent.id);
  expect(JSON.stringify(binding)).not.toContain("grant");
  expect(JSON.stringify(binding)).not.toContain("session");
  const revoked = revokeRvsUserActorBinding(binding, {
    revokedBy: principal.id,
    reason: "owner retired reviewer",
  });
  expect(revoked.status).toBe("revoked");
  expect(revoked.revokedByPrincipalId).toBe(principal.id);
  expect(() =>
    revokeRvsUserActorBinding(binding, {
      revokedBy: "prn_dddddddddddddddddddddddddddddddd",
      reason: "foreign",
    }),
  ).toThrow("RVS_USER_BINDING_OWNER_REQUIRED");
  const changed = ownedAgentBindingInput();
  Object.assign(changed.agent, {
    provenance: { origin: "first-party", implementationId: "another-runtime" },
  });
  expect(bindRvsUserOwnedAgentActor(changed).principal).toEqual(binding.principal);
});

for (const [name, mutate] of [
  ["revoked human owner", (p) => Object.assign(p.owner, { status: "revoked" })],
  ["non-human enroller", (p) => Object.assign(p.owner, { principalKind: "agent" })],
  ["revoked Agent Principal", (p) => Object.assign(p.principal, { status: "revoked" })],
  ["human reviewer Principal", (p) => Object.assign(p.principal, { principalKind: "human" })],
  ["shared Principal", (p) => Object.assign(p.principal, { id: p.owner.id })],
  ["foreign boundBy", (p) => Object.assign(p, { boundBy: p.principal.id })],
  ["revoked Agent record", (p) => Object.assign(p.agent, { status: "revoked" })],
  ["foreign Agent owner", (p) => Object.assign(p.agent, { ownerPrincipalId: p.principal.id })],
  ["missing Principal association", (p) => Object.assign(p.agent, { principalId: undefined })],
  ["substituted Principal association", (p) => Object.assign(p.agent, { principalId: p.owner.id })],
  ["non-Agent Actor", (p) => Object.assign(p.actor, { kind: "human" })],
  ["verified without proof digest", (p) => Object.assign(p.proof, { digest: undefined })],
  ["malformed Principal", (p) => Object.assign(p.principal, { id: "prn_invalid" })],
] satisfies readonly (readonly [
  string,
  (input: Parameters<typeof bindRvsUserOwnedAgentActor>[0]) => unknown,
])[]) {
  test(`owner-bound Agent refuses ${name} without publication or authority`, () => {
    const input = ownedAgentBindingInput();
    mutate(input);
    expect(() => bindRvsUserOwnedAgentActor(input)).toThrow(
      "RVS_USER_OWNED_AGENT_BINDING_REJECTED",
    );
  });
}
