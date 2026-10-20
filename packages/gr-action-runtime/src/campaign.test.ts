import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createCapAuthority } from "@reliverse/cap";
import { invokeBoundCapOperation } from "@reliverse/cap/invocation";
import {
  createGatehouseEndorsementSubmission,
  fingerprintGatehouseValue,
  type GatehouseActionIntent,
} from "@reliverse/gatehouse-protocol";
import { createGatehouseRuntime } from "@reliverse/gatehouse-runtime";
import {
  createStaticGatehouseEndorsementVerifier,
  signStaticGatehouseEndorsement,
} from "@reliverse/gatehouse-runtime/testkit";
import { createGrCampaignPlan, freezeGrCampaignPlan } from "@reliverse/gr";
import {
  createQualityRegistry,
  defineQualitySuite,
  runQualityCandidateVerification,
} from "@reliverse/quality";

import {
  createGrCampaignActionIntent,
  createGrCampaignCapabilityRuntime,
  createGrCampaignOwnerPushHost,
  createGrCampaignOwnerCommitHost,
  createGrCampaignReviewedOwnerCommitHost,
  createGrCampaignReviewedOwnerPushHost,
  createGrRepoCampaignBinding,
  executeApprovedGrCampaignAction,
  type GrCampaignAction,
} from "./campaign";
import type { GrCampaignReview } from "./review";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(
    [
      "git",
      "--no-pager",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { cwd: root, env: { ...process.env, GIT_EDITOR: "true" }, stdout: "pipe", stderr: "pipe" },
  );
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code) throw new Error(err);
  return out.trim();
}
async function temporary(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
async function fixture(approve = true, review?: GrCampaignReview) {
  const root = await temporary("gr-gate-fixture-");
  await git(root, "init", "-q");
  await writeFile(path.join(root, ".gitignore"), ".private/\n");
  await writeFile(path.join(root, "core.txt"), "base\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "base");
  await writeFile(path.join(root, "core.txt"), "reviewed candidate\n");
  const plan = await freezeGrCampaignPlan({
    root,
    plan: await createGrCampaignPlan({
      root,
      campaignId: "oss-fixture",
      baseRevision: "HEAD",
      paths: ["core.txt"],
      commits: [{ id: "core", title: "feat(core): reviewed candidate", paths: ["core.txt"] }],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const suite = defineQualitySuite({
    id: "fixture",
    title: "Fixture",
    description: "Fixture-only primary check, not production Green Gate.",
    capabilities: [
      {
        id: "fixture.check",
        title: "Check",
        description: "Fixture check",
        operations: ["check"],
        defaultProvider: "fixture.check.builtin",
        providers: ["fixture.check.builtin"],
      },
    ],
    providers: [
      {
        id: "fixture.check.builtin",
        capabilityId: "fixture.check",
        title: "Engine",
        version: "1.0.0",
        operations: ["check"],
        determinism: "deterministic",
      },
    ],
    rules: [],
    checks: { "fixture.check": () => [] },
  });
  const tree = plan.frozen!.candidateTree;
  const candidateFingerprint = `git-tree:${tree.algorithm}:${tree.oid}`;
  const executionFingerprint = "fixture-only-engine-closure";
  const quality = await runQualityCandidateVerification(createQualityRegistry([suite]), {
    runId: "fixture-quality",
    createdAt: "2026-10-14T00:00:00.000Z",
    target: { kind: "repository", id: "fixture", root, snapshot: candidateFingerprint },
    candidateFingerprint,
    executionFingerprint,
    observeCandidateFingerprint: async () => candidateFingerprint,
    observeExecutionFingerprint: async () => executionFingerprint,
    checks: [
      {
        request: { capabilityId: "fixture.check", providerId: "fixture.check.builtin" },
        suiteFingerprint: suite.manifestFingerprint,
        providerVersion: "1.0.0",
      },
    ],
  });
  const now = () => new Date("2026-10-14T00:00:00.000Z");
  const principals = review
    ? [review.ownerPrincipalId, review.reviewerPrincipalId]
    : ["principal.owner", "principal.reviewer"];
  const credentials = Object.fromEntries(
    principals.map((principalId) => [
      `credential.${principalId}`,
      { principalId, secret: "fixture-only-key" },
    ]),
  );
  const verifier = createStaticGatehouseEndorsementVerifier({ credentials, now });
  const gatehouse = createGatehouseRuntime({
    home: path.join(root, ".private", "gatehouse"),
    now,
    endorsementVerifier: verifier,
  });
  const authority = {
    createdAt: now().toISOString(),
    expiresAt: "2026-10-14T01:00:00.000Z",
    requester: { id: "principal.owner", kind: "human" as const },
    actor: { id: "service.gr", kind: "service" as const },
    accountableSystem: { id: "service.gr", kind: "service" as const },
    policy: {
      id: "policy.fixture",
      digest: fingerprintGatehouseValue("fixture-policy"),
      authority: {
        kind: "all-of" as const,
        independence: "distinct-perspectives" as const,
        principalIds: principals,
      },
    },
  };
  async function endorse(
    intent: GatehouseActionIntent,
    gateId: string,
    principalId: string,
    decision: "approve" | "deny" = "approve",
  ) {
    const credentialId = `credential.${principalId}`;
    return gatehouse.submitEndorsement(
      createGatehouseEndorsementSubmission({
        gateId,
        intentDigest: intent.digest,
        principalId,
        credentialId,
        decision,
        issuedAt: now().toISOString(),
        expiresAt: authority.expiresAt,
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
              credentialId,
              signedDigest,
              secret: "fixture-only-key",
            }),
        },
      }),
    );
  }
  const binding = {
    ...(review ? { review } : {}),
    plan,
    quality,
    qualityPolicyFingerprint: quality.policyFingerprint,
    executionFingerprint,
    executorFingerprint: "fixture-only-GR-executor-closure",
  };
  async function submit(action: GrCampaignAction, approvals = approve) {
    if (action.kind === "push" && !action.ref.startsWith("refs/heads/"))
      action = { ...action, ref: `refs/heads/${action.ref}` };
    const intent = createGrCampaignActionIntent({ ...binding, action, authority });
    const gate = await gatehouse.submitIntent(intent);
    if (approvals)
      for (const principal of principals) await endorse(intent, gate.gate.id, principal);
    return {
      ...binding,
      action,
      gatehouse,
      gateId: gate.gate.id,
      attemptId: `attempt.${gate.gate.id}`,
      intent,
    };
  }
  const context = await submit({
    kind: "commit",
    commitId: "core",
    expectedBeforeCommit: plan.base.commit.oid,
  });
  return { root, plan, context, submit, endorse, gatehouse, verifier, now };
}

test("canonical repo.commit Engine shares the GR Gate executor and requires new explicit Cap authority", async () => {
  const f = await fixture();
  if (f.context.action.kind !== "commit") throw Error("fixture action");
  const authority = createCapAuthority({ issuer: "repo-fixture" });
  const grant = (operationId: string) =>
    authority.acceptGrant(
      {
        id: `fixture-${operationId}`,
        issuer: "repo-fixture",
        subject: "repo-host",
        capabilityId: operationId === "repo.commit" ? "repo" : "gr",
        operationIds: [operationId],
        scopes: [f.plan.campaignFingerprint],
        issuedAt: new Date().toISOString(),
      },
      "fixture-repo-lease",
    );
  const input = {
    ...f.context,
    action: f.context.action,
    authority,
    capRef: grant("repo.commit"),
    actor: { kind: "system", id: "repo-host" },
    ownerUid: 1000,
    contextRoot: f.root,
    gitRuntime: {
      root: f.root,
      executable: "/usr/bin/git",
      closureFingerprint: f.context.executorFingerprint,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: f.root,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      assertCurrent: async () => {},
    },
  };
  const binding = createGrRepoCampaignBinding(input);
  const request = {
    capabilityId: "repo",
    operationId: "repo.commit",
    engineId: "gr",
    mode: "apply" as const,
    apply: true,
    targetRef: f.root,
    input: { gateId: f.context.gateId, attemptId: f.context.attemptId },
  };
  await expect(
    invokeBoundCapOperation(
      [createGrRepoCampaignBinding({ ...input, capRef: grant("gr.campaign.commit") })],
      request,
    ),
  ).rejects.toThrow();
  await expect(invokeBoundCapOperation([binding], { ...request, engineId: "git" })).rejects.toThrow(
    "BINDING_UNAVAILABLE",
  );
  await expect(
    invokeBoundCapOperation([binding], {
      ...request,
      input: { ...request.input, root: "/another-repository" },
    }),
  ).rejects.toThrow();
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.consumption).toBeUndefined();
  const host = createGrCampaignOwnerCommitHost(input);
  expect(host.operation).toBe("repo.commit");
  expect(await host.inspect()).toMatchObject({
    capOperation: "repo.commit",
    commitId: "core",
    gateStatus: "quorum-satisfied",
  });
  await host.execute();
  expect(await git(f.root, "rev-parse", "HEAD")).not.toBe(f.plan.base.commit.oid);
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.execution?.outcome).toBe("completed");
  await expect(invokeBoundCapOperation([binding], request)).rejects.toThrow("consumed/uncertain");
});

test("Cap binding requires an issued reference, apply and independent exact Gate approval", async () => {
  for (const approved of [false, true]) {
    const f = await fixture(approved);
    const authority = createCapAuthority({ issuer: "fixture-only-issuer" });
    const cap = createGrCampaignCapabilityRuntime({ ...f.context, authority });
    const request = { gateId: f.context.gateId, attemptId: f.context.attemptId };
    const options = {
      mode: "apply" as const,
      apply: true,
      actor: { kind: "system", id: "fixture-host" },
    };
    await expect(cap.call("gr.campaign.commit", request, options)).rejects.toThrow("CapRef");
    const wrongScope = authority.acceptGrant(
      {
        id: "fixture-unrelated-grant",
        issuer: "fixture-only-issuer",
        subject: "fixture-host",
        capabilityId: "gr",
        operationIds: ["gr.campaign.commit"],
        scopes: ["unrelated-campaign"],
        issuedAt: new Date().toISOString(),
      },
      "fixture-unrelated-lease",
    );
    await expect(
      cap.call("gr.campaign.commit", request, { ...options, capRef: wrongScope }),
    ).rejects.toThrow("exact frozen Campaign");
    const capRef = authority.acceptGrant(
      {
        id: "fixture-grant",
        issuer: "fixture-only-issuer",
        subject: "fixture-host",
        capabilityId: "gr",
        operationIds: ["gr.campaign.commit"],
        scopes: [f.plan.campaignFingerprint],
        issuedAt: new Date().toISOString(),
      },
      "fixture-lease",
    );
    await expect(
      cap.call("gr.campaign.commit", request, { ...options, capRef, apply: false }),
    ).rejects.toThrow("apply");
    await expect(
      cap.call("gr.campaign.commit", { ...request, plan: f.plan }, { ...options, capRef }),
    ).rejects.toThrow("only exact");
    expect((await f.gatehouse.inspectGate(request.gateId))?.consumption).toBeUndefined();
    if (!approved) {
      await expect(cap.call("gr.campaign.commit", request, { ...options, capRef })).rejects.toThrow(
        "independent",
      );
      expect(await git(f.root, "rev-parse", "HEAD")).toBe(f.plan.base.commit.oid);
    } else {
      const result = await cap.call("gr.campaign.commit", request, { ...options, capRef });
      expect(result.receipt.authority?.subject).toBe("fixture-host");
      expect(
        (result.data as Awaited<ReturnType<typeof executeApprovedGrCampaignAction>>).execution
          .outcome,
      ).toBe("completed");
      await expect(cap.call("gr.campaign.commit", request, { ...options, capRef })).rejects.toThrow(
        "consumed/uncertain",
      );
    }
  }
});

test("independent owner/reviewer approval is required; declared effects and actor labels cannot authorize Git", async () => {
  const f = await fixture(false);
  await expect(
    executeApprovedGrCampaignAction({ ...f.context, approved: true } as typeof f.context),
  ).rejects.toThrow("independent");
  await f.endorse(f.context.intent, f.context.gateId, "principal.owner");
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("independent");
  expect(await git(f.root, "rev-parse", "HEAD")).toBe(f.plan.base.commit.oid);
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.consumption).toBeUndefined();
});

test("an explicit denied Gate cannot authorize materialization", async () => {
  const f = await fixture(false);
  await f.endorse(f.context.intent, f.context.gateId, "principal.owner", "deny");
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("independent");
  expect(await git(f.root, "rev-parse", "HEAD")).toBe(f.plan.base.commit.oid);
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.consumption).toBeUndefined();
});

test("successful Git effect with failed Gate finalization stays held without replay", async () => {
  const f = await fixture();
  const unavailable = {
    ...f.gatehouse,
    recordExecution: async () => {
      throw new Error("fixture-storage-unavailable");
    },
  };
  await expect(
    executeApprovedGrCampaignAction({ ...f.context, gatehouse: unavailable }),
  ).rejects.toMatchObject({ details: { outcome: "uncertain" } });
  expect(await git(f.root, "rev-list", "--count", "HEAD")).toBe("2");
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.consumption).toBeDefined();
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.execution).toBeUndefined();
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("consumed/uncertain");
});

test("exact Gate executes one reviewed commit and cross-binds the existing Gate receipt", async () => {
  const f = await fixture();
  const done = await executeApprovedGrCampaignAction(f.context);
  expect(done.result.operation).toBe("gr.campaign.commit");
  expect(done.execution.outcome).toBe("completed");
  expect(done.execution.resultDigest).toBe(fingerprintGatehouseValue(done.result));
  expect(await git(f.root, "rev-parse", "HEAD^{tree}")).toBe(f.plan.frozen!.candidateTree.oid);
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("consumed/uncertain");
  expect(await git(f.root, "rev-list", "--count", "HEAD")).toBe("2");
});

test("Gate/RQ binding drift refuses execution before consuming authority", async () => {
  for (const kind of ["action", "quality", "policy", "engine", "executor"] as const) {
    const f = await fixture();
    const modified = {
      ...f.context,
      ...(kind === "action"
        ? { action: { kind: "commit" as const, commitId: "core", expectedBeforeCommit: "foreign" } }
        : {}),
      ...(kind === "quality"
        ? { quality: { ...f.context.quality, receiptFingerprint: "tampered" } }
        : {}),
      ...(kind === "policy" ? { qualityPolicyFingerprint: "foreign" } : {}),
      ...(kind === "engine" ? { executionFingerprint: "foreign" } : {}),
      ...(kind === "executor" ? { executorFingerprint: "foreign" } : {}),
    };
    await expect(executeApprovedGrCampaignAction(modified)).rejects.toThrow();
    expect(await git(f.root, "rev-parse", "HEAD")).toBe(f.plan.base.commit.oid);
    expect((await f.gatehouse.inspectGate(f.context.gateId))?.consumption).toBeUndefined();
  }
});

test("concurrent consumers of one exact Gate cannot produce a second commit", async () => {
  const f = await fixture();
  const attempts = await Promise.allSettled([
    executeApprovedGrCampaignAction(f.context),
    executeApprovedGrCampaignAction({ ...f.context, attemptId: "attempt.other" }),
  ]);
  expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await git(f.root, "rev-list", "--count", "HEAD")).toBe("2");
});

test("failed consequential execution is retained uncertain and cannot replay", async () => {
  const f = await fixture();
  const hook = path.join(f.root, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("retained");
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.execution?.outcome).toBe(
    "outcome-unknown",
  );
  expect(await git(f.root, "diff", "--cached", "--name-only")).toBe("core.txt");
  await expect(executeApprovedGrCampaignAction(f.context)).rejects.toThrow("consumed/uncertain");
});

test("approved push pins destination/final HEAD and independently reads back the fixture remote", async () => {
  const f = await fixture();
  const remote = await temporary("gr-gate-remote-");
  await git(remote, "init", "--bare", "-q");
  await git(f.root, "remote", "add", "origin", remote);
  await git(f.root, "push", "-q", "origin", `${f.plan.base.commit.oid}:refs/heads/main`);
  await executeApprovedGrCampaignAction(f.context);
  const head = await git(f.root, "rev-parse", "HEAD");
  const request = await f.submit({
    kind: "push",
    expectedHead: head,
    remote: "origin",
    ref: "main",
    remoteUrl: remote,
  });
  const done = await executeApprovedGrCampaignAction(request);
  expect(done.result.operation).toBe("gr.campaign.push");
  expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(head);
  expect(done.execution.outcome).toBe("completed");
  await expect(executeApprovedGrCampaignAction(request)).rejects.toThrow("consumed/uncertain");
});

test("bound owner host previews without consumption and uses Cap/Gate/CAS/readback once", async () => {
  const f = await fixture();
  const remote = await temporary("gr-owner-host-remote-");
  await git(remote, "init", "--bare", "-q");
  await git(f.root, "remote", "add", "origin", remote);
  await git(f.root, "push", "-q", "origin", `${f.plan.base.commit.oid}:refs/heads/main`);
  await executeApprovedGrCampaignAction(f.context);
  const head = await git(f.root, "rev-parse", "HEAD");
  const request = await f.submit({
    kind: "push",
    expectedHead: head,
    remote: "origin",
    ref: "main",
    remoteUrl: remote,
  });
  if (request.action.kind !== "push") throw Error("fixture action");
  const authority = createCapAuthority({ issuer: "fixture-only-owner-host" });
  const capRef = authority.acceptGrant(
    {
      id: "fixture-push-grant",
      issuer: "fixture-only-owner-host",
      subject: "fixture-push-host",
      capabilityId: "repo",
      operationIds: ["repo.push"],
      scopes: [f.plan.campaignFingerprint],
      issuedAt: new Date().toISOString(),
    },
    "fixture-push-lease",
  );
  const hostInput = {
    ...request,
    action: request.action,
    authority,
    capRef,
    actor: { kind: "system", id: "fixture-push-host" },
    contextRoot: f.root,
    gitRuntime: {
      root: f.root,
      executable: "/usr/bin/git",
      closureFingerprint: request.executorFingerprint,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: f.root,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      assertCurrent: async () => {}, // Fixture-only custody, not production admission.
    },
    ownerUid: 1000,
  };
  expect(() =>
    createGrCampaignOwnerPushHost({
      ...hostInput,
      gitRuntime: { ...hostInput.gitRuntime, closureFingerprint: "other-closure" },
    }),
  ).toThrow("exact admitted");
  const revoked = createGrCampaignOwnerPushHost({
    ...hostInput,
    gitRuntime: {
      ...hostInput.gitRuntime,
      assertCurrent: async () => {
        throw Error("fixture-custody-revoked");
      },
    },
  });
  await expect(revoked.execute()).rejects.toThrow("fixture-custody-revoked");
  expect((await f.gatehouse.inspectGate(request.gateId))?.consumption).toBeUndefined();
  const host = createGrCampaignOwnerPushHost(hostInput);
  expect(await host.inspect()).toMatchObject({
    expectedOld: f.plan.base.commit.oid,
    newHead: head,
    ref: "refs/heads/main",
    gateStatus: "quorum-satisfied",
  });
  expect((await f.gatehouse.inspectGate(request.gateId))?.consumption).toBeUndefined();
  await host.execute();
  expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(head);
  await expect(host.execute()).rejects.toThrow("consumed/uncertain");
});

test("remote publication rejection retains consumed authority and prevents replay", async () => {
  const f = await fixture();
  const remote = await temporary("gr-gate-rejected-push-");
  await git(remote, "init", "--bare", "-q");
  await git(f.root, "remote", "add", "origin", remote);
  await git(f.root, "push", "-q", "origin", `${f.plan.base.commit.oid}:refs/heads/main`);
  await executeApprovedGrCampaignAction(f.context);
  const request = await f.submit({
    kind: "push",
    expectedHead: await git(f.root, "rev-parse", "HEAD"),
    remote: "origin",
    ref: "main",
    remoteUrl: remote,
  });
  const hook = path.join(remote, "hooks/pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  await expect(executeApprovedGrCampaignAction(request)).rejects.toThrow();
  expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(f.plan.base.commit.oid);
  expect((await f.gatehouse.inspectGate(request.gateId))?.execution?.outcome).toBe(
    "outcome-unknown",
  );
  await expect(executeApprovedGrCampaignAction(request)).rejects.toThrow("consumed/uncertain");
});

test("remote URL substitution cannot redirect an approved push", async () => {
  const f = await fixture();
  const remote = await temporary("gr-gate-remote-pin-");
  const other = await temporary("gr-gate-other-");
  for (const root of [remote, other]) await git(root, "init", "--bare", "-q");
  await git(f.root, "remote", "add", "origin", remote);
  await git(f.root, "push", "-q", "origin", `${f.plan.base.commit.oid}:refs/heads/main`);
  await executeApprovedGrCampaignAction(f.context);
  const request = await f.submit({
    kind: "push",
    expectedHead: await git(f.root, "rev-parse", "HEAD"),
    remote: "origin",
    ref: "main",
    remoteUrl: remote,
  });
  await git(f.root, "remote", "set-url", "origin", other);
  await expect(executeApprovedGrCampaignAction(request)).rejects.toThrow("push URL changed");
  expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(f.plan.base.commit.oid);
  expect(await readFile(path.join(other, "HEAD"), "utf8")).toContain("ref:");
});

test("reviewed owner hosts bind signed review evidence through commit, strict CAS push and no-replay", async () => {
  const reviewerPrincipalId = `prn_${"b".repeat(32)}`;
  const review: GrCampaignReview = {
    ownerPrincipalId: `prn_${"a".repeat(32)}`,
    reviewerPrincipalId,
    credentialId: `credential.${reviewerPrincipalId}`,
    publicKeyDigest: fingerprintGatehouseValue("fixture-key"),
    actorBindingDigest: fingerprintGatehouseValue("fixture-UF-binding"),
    executionIdentityDigest: fingerprintGatehouseValue("fixture-independent-execution"),
    evidenceDigest: fingerprintGatehouseValue("fixture-review-results"),
  };
  const f = await fixture(true, review);
  const remote = await temporary("gr-reviewed-owner-remote-");
  await git(remote, "init", "--bare", "-q");
  await git(f.root, "remote", "add", "origin", remote);
  await git(f.root, "push", "-q", "origin", `${f.plan.base.commit.oid}:refs/heads/main`);
  let custody = true;
  const hostInput = (request: typeof f.context) => {
    const operationId = request.action.kind === "commit" ? "repo.commit" : "repo.push";
    const authority = createCapAuthority({ issuer: "reviewed-fixture-host" });
    return {
      ...request,
      review,
      reviewPorts: {
        verifier: f.verifier,
        now: f.now,
        assertCustodyCurrent: async () => {
          if (!custody) throw Error("fixture-review-custody-revoked");
        },
      },
      authority,
      capRef: authority.acceptGrant(
        {
          id: `fixture.${operationId}`,
          issuer: "reviewed-fixture-host",
          subject: "fixture-owner-host",
          capabilityId: "repo",
          operationIds: [operationId],
          scopes: [f.plan.campaignFingerprint],
          issuedAt: new Date().toISOString(),
        },
        "fixture-only-admission",
      ),
      actor: { kind: "system", id: "fixture-owner-host" },
      ownerUid: 1000,
      contextRoot: f.root,
      gitRuntime: {
        root: f.root,
        executable: "/usr/bin/git",
        closureFingerprint: request.executorFingerprint,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: f.root,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
        assertCurrent: async () => {}, // Source/fixture only, not native admission.
      },
    };
  };
  if (f.context.action.kind !== "commit") throw Error("fixture action");
  const commit = createGrCampaignReviewedOwnerCommitHost({
    ...hostInput(f.context),
    action: f.context.action,
  });
  expect(await commit.inspect()).toMatchObject({ gateStatus: "quorum-satisfied", review });
  expect((await f.gatehouse.inspectGate(f.context.gateId))?.lease).toBeUndefined();
  await commit.execute();
  const head = await git(f.root, "rev-parse", "HEAD");
  const request = await f.submit({
    kind: "push",
    expectedHead: head,
    remote: "origin",
    remoteUrl: remote,
    ref: "main",
  });
  if (request.action.kind !== "push") throw Error("fixture action");
  const push = createGrCampaignReviewedOwnerPushHost({
    ...hostInput(request),
    action: request.action,
  });
  await push.execute();
  expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(head);
  await expect(push.execute()).rejects.toThrow("consumed/uncertain");
  custody = false;
  await expect(commit.inspect()).rejects.toThrow("fixture-review-custody-revoked");
});
