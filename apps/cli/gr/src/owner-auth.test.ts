import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { type AuthSessionV0 } from "@reliverse/auth";
import { createAuthFramework } from "@reliverse/auth";
import { createProtectedAuthSessionStore } from "@reliverse/auth-bun";
import { createRvsProtectedOwnerTerminalAuthBackend } from "@reliverse/rvs-systemd-ubuntu";

import {
  authenticateGrOwner,
  grOwnerAuthProfile,
  assertGrOwnerAuthSession,
  assertGrOwnerAuthPolicy,
  runGrOwnerAuthentication,
  GR_OWNER_AUTH_EXECUTABLE,
} from "./owner-auth";
const principalId = `prn_${"a".repeat(32)}` as const;
const profile = grOwnerAuthProfile({
  schema: "rvs.user.actor-binding.v0",
  id: "fixture-binding",
  principal: { id: principalId, kind: "human" },
  actor: { id: "os-user.uid-995", kind: "human" },
  provider: { id: "local-os", subject: "uid:995" },
  proof: {
    kind: "fixture-root-enrollment",
    reference: "fixture-only",
    digest: `sha256:${"a".repeat(64)}`,
  },
  assurance: "verified",
  status: "active",
  boundByPrincipalId: principalId,
  createdAt: "2026-10-18T00:00:00Z",
});
const now = () => new Date("2026-10-18T20:00:00Z");
const observation = () => ({
  uid: 995,
  euid: 995,
  ttyUid: 995,
  tty: true,
  noNewPrivileges: true,
  effectiveCapabilities: "0",
  bindingDigestVerified: true,
  executableAndPolicyVerified: true,
});
async function fixture(
  run: (f: {
    sessions: ReturnType<typeof createProtectedAuthSessionStore>;
    observed: ReturnType<typeof observation>;
    directory: string;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "gr-owner-auth-"));
  const observed = observation();
  try {
    await run({
      directory,
      observed,
      sessions: createProtectedAuthSessionStore({ directory, assertLocation: async () => {} }),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("GR owner authentication uses canonical Auth persistence, separate audience and no authority", () =>
  fixture(async ({ sessions, observed }) => {
    const ports = { now, sessions, attest: async () => observed };
    const r = await authenticateGrOwner(profile, ports);
    expect(r).toMatchObject({
      sessionReused: false,
      scopes: ["identity.observe"],
      audiences: ["gr.owner-control"],
      resources: ["github:reliverse/reliverse"],
      authorityGranted: false,
      gitExecutionAdmitted: false,
      campaignApproved: false,
    });
    const second = await authenticateGrOwner(profile, ports);
    expect(second.authenticationSession).toBe(r.authenticationSession);
    expect(second.sessionReused).toBe(true);
    await sessions.revoke(r.authenticationSession, async () => {});
    await expect(authenticateGrOwner(profile, ports)).rejects.toThrow("REAUTH_REQUIRED");
  }));
test("explicit reauthentication creates a fresh CAS-bound session without resetting expired/revoked history", () =>
  fixture(async ({ sessions, observed, directory }) => {
    let instant = now();
    const ports = { now: () => instant, sessions, attest: async () => observed };
    const first = await authenticateGrOwner(profile, ports);
    const oldFile = path.join(directory, first.authenticationSession + ".json");
    const oldBytes = await readFile(oldFile);
    instant = new Date("2026-10-19T02:00:00Z");
    await expect(authenticateGrOwner(profile, ports)).rejects.toThrow("REAUTH_REQUIRED");
    const fresh = await authenticateGrOwner(profile, ports, { reauthenticate: true });
    expect(fresh.sessionReused).toBe(false);
    expect(fresh.authenticationSession).not.toBe(first.authenticationSession);
    expect(await readFile(oldFile)).toEqual(oldBytes);
    const active = await authenticateGrOwner(profile, ports, { reauthenticate: true });
    expect(active.authenticationSession).toBe(fresh.authenticationSession);
    expect(active.sessionReused).toBe(true);
    await sessions.revoke(fresh.authenticationSession, async () => {});
    const revocation = path.join(directory, fresh.authenticationSession + ".revoked.json");
    const revokedBytes = await readFile(revocation);
    const renewed = await authenticateGrOwner(profile, ports, { reauthenticate: true });
    expect(renewed.authenticationSession).not.toBe(fresh.authenticationSession);
    expect(await readFile(revocation)).toEqual(revokedBytes);
  }));

test("explicit reauthentication cannot bypass uncertain publication or stale pointer CAS", () =>
  fixture(async ({ sessions, observed, directory }) => {
    const ports = { now, sessions, attest: async () => observed };
    const first = await authenticateGrOwner(profile, ports);
    await sessions.revoke(first.authenticationSession, async () => {});
    const pointer = await readFile(path.join(directory, "current.json"));
    await expect(
      authenticateGrOwner(
        profile,
        {
          ...ports,
          sessions: {
            ...sessions,
            publish: (session, check) => sessions.publish(session, check, null),
          },
        },
        { reauthenticate: true },
      ),
    ).rejects.toThrow("PRECONDITION_CHANGED");
    expect(await readFile(path.join(directory, "current.json"))).toEqual(pointer);
    await mkdir(path.join(directory, "publication.lock"));
    await expect(authenticateGrOwner(profile, ports, { reauthenticate: true })).rejects.toThrow(
      "UNCERTAIN",
    );
    expect(await readFile(path.join(directory, "current.json"))).toEqual(pointer);
  }));

test("reused sessions still require current native attestation and exact Auth profile", () =>
  fixture(async ({ sessions, observed }) => {
    const ports = { now, sessions, attest: async () => observed };
    await authenticateGrOwner(profile, ports);
    for (const field of [
      "uid",
      "euid",
      "ttyUid",
      "tty",
      "noNewPrivileges",
      "effectiveCapabilities",
      "bindingDigestVerified",
      "executableAndPolicyVerified",
    ] as const) {
      const bad = {
        ...observed,
        [field]:
          typeof observed[field] === "number"
            ? 1000
            : typeof observed[field] === "string"
              ? "1"
              : false,
      };
      await expect(
        authenticateGrOwner(profile, { ...ports, attest: async () => bad }),
      ).rejects.toThrow("NOT_ADMITTED");
    }
    const current = (await sessions.readActive(now()))!;
    for (const options of [{}, { reauthenticate: true }]) {
      await expect(
        authenticateGrOwner(
          { ...profile, binding: { ...profile.binding, status: "revoked" } },
          ports,
          options,
        ),
      ).rejects.toThrow();
    }
    for (const change of [
      { issuer: "rvs.protected-owner-ssh" },
      { audiences: ["rvs.owner-control"] },
      { scopes: ["repo.push"] },
      { resources: ["other"] },
      { expiresAt: now().toISOString() },
    ]) {
      expect(() => assertGrOwnerAuthSession({ ...current, ...change }, profile, now())).toThrow(
        "NOT_ADMITTED",
      );
    }
    await expect(authenticateGrOwner({ ...profile, scopes: ["repo.push"] }, ports)).rejects.toThrow(
      "NOT_ADMITTED",
    );
  }));
test("revocation after readback releases no reusable identity result", () =>
  fixture(async ({ sessions, observed }) => {
    const ports = { now, sessions, attest: async () => observed };
    const first = await authenticateGrOwner(profile, ports);
    let checks = 0;
    await expect(
      authenticateGrOwner(profile, {
        ...ports,
        attest: async () => {
          if (++checks === 2) await sessions.revoke(first.authenticationSession, async () => {});
          return observed;
        },
      }),
    ).rejects.toThrow("NOT_ADMITTED");
  }));
test("terminal Auth profile cannot borrow SSH method or audience", async () => {
  const persisted: AuthSessionV0[] = [];
  const backend = createRvsProtectedOwnerTerminalAuthBackend(profile, {
    now,
    attest: async () => observation(),
    persistSession: async (s, check) => {
      await check();
      persisted.push(s);
    },
  });
  const framework = createAuthFramework([backend]);
  const intent = {
    schema: "reliverse.auth.intent.v0" as const,
    purpose: "sign-in" as const,
    principal: profile.binding.principal,
    client: { id: profile.binding.actor.id, kind: "confidential" as const },
    issuer: profile.issuer,
    surface: "fixture",
    interaction: "external-engine" as const,
    requiredAssurance: "verified" as const,
    requestedScopes: profile.scopes,
    requestedResources: profile.resources.map((id) => ({ id })),
    requestedAudiences: profile.audiences.map((id) => ({ id })),
  };
  expect(() =>
    framework.plan(intent, { backendId: backend.id, methodId: "protected-ssh-tty" }),
  ).toThrow();
  expect(backend.supports({ ...intent, requestedAudiences: [{ id: "rvs.owner-control" }] })).toBe(
    false,
  );
  expect(persisted).toHaveLength(0);
});
test("source/producer and arbitrary argv refuse without opening the protected policy/store", async () => {
  expect(await runGrOwnerAuthentication(["--identity"])).toMatchObject({ authorityGranted: false });
  for (const args of [
    [],
    ["authenticate", "/tmp/policy"],
    ["push"],
    ["authenticate"],
    ["reauthenticate"],
  ]) {
    await expect(runGrOwnerAuthentication(args)).rejects.toThrow("NOT_ADMITTED");
  }
});
test("owner Auth policy requires immutable executable closure and safe explicit public attribution", () => {
  const p = {
    schema: "gr.owner-auth.host.v0" as const,
    ownerEnrollmentDigest: `sha256:${"a".repeat(64)}` as const,
    passwdDigest: `sha256:${"c".repeat(64)}` as const,
    groupDigest: `sha256:${"d".repeat(64)}` as const,
    ownerPrincipalId: principalId,
    author: { name: "Fixture", email: "fixture@example.invalid" },
    artifacts: [{ path: GR_OWNER_AUTH_EXECUTABLE, digest: `sha256:${"b".repeat(64)}` as const }],
    links: [],
  };
  expect(() => assertGrOwnerAuthPolicy(p)).not.toThrow();
  for (const bad of [
    { ...p, artifacts: [] },
    { ...p, author: { ...p.author, name: "bad\nname" } },
    { ...p, artifacts: [{ ...p.artifacts[0]!, path: "/tmp/executable" }] },
  ]) {
    expect(() => assertGrOwnerAuthPolicy(bad)).toThrow("NOT_ADMITTED");
  }
});
