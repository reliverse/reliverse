import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  applyReliversePrincipalRegistration,
  applyReliversePrincipalRename,
  planReliversePrincipalRegistration,
  planReliversePrincipalRename,
} from "./principal-registration";
import { applyReliverseHomeInitPlan, inspectReliverseHome, planReliverseHomeInit } from "./runtime";

test("reviewer rename preserves stable Principal identity independently of model/display labels", async () => {
  const { root, plan } = await fixture();
  const registered = await applyReliversePrincipalRegistration(plan);
  const bytes = await readFile(registered.path, "utf8");
  const rename = await planReliversePrincipalRename({
    root,
    principalId: plan.principal.id,
    handle: "zed-b",
    displayName: "Zed B",
  });
  expect(await readFile(registered.path, "utf8")).toBe(bytes);
  const result = await applyReliversePrincipalRename(rename);
  expect(result.before).toEqual(plan.principal);
  expect(result.principal).toMatchObject({
    id: plan.principal.id,
    principalKind: "agent",
    createdAt: plan.principal.createdAt,
    status: "active",
    handle: "zed-b",
    displayName: "Zed B",
  });
  expect(result.principal.aliases).toEqual([
    { namespace: "local-handle", value: "zed-b", verified: true },
  ]);
  expect(result.defaultPrincipalId).not.toBe(plan.principal.id);
  expect(result.authenticated).toBe(false);
  expect(result.authorityGranted).toBe(false);
  expect(result.credentialCreated).toBe(false);
  expect(JSON.parse(await readFile(result.path, "utf8"))).toEqual(result.principal);
  await expect(applyReliversePrincipalRename(rename)).rejects.toThrow("STALE");
});

test("Principal rename refuses collisions, stale plans, identity/lifecycle tampering and retained locks", async () => {
  const { root, plan, registry } = await fixture();
  await applyReliversePrincipalRegistration(plan);
  await expect(
    planReliversePrincipalRename({
      root,
      principalId: plan.principal.id,
      handle: "owner",
      displayName: "Zed B",
    }),
  ).rejects.toThrow("CONFLICT");
  const rename = await planReliversePrincipalRename({
    root,
    principalId: plan.principal.id,
    handle: "zed-b",
    displayName: "Zed B",
  });
  await expect(
    applyReliversePrincipalRename({
      ...rename,
      principal: { ...rename.principal, status: "revoked" },
    }),
  ).rejects.toThrow("PLAN_INVALID");
  await mkdir(path.join(registry, ".registration.lock"));
  await expect(applyReliversePrincipalRename(rename)).rejects.toThrow("EEXIST");
  await rm(path.join(registry, ".registration.lock"), { recursive: true });
  await applyReliversePrincipalRegistration(
    await planReliversePrincipalRegistration({ root, handle: "other", principalKind: "agent" }),
  );
  await expect(applyReliversePrincipalRename(rename)).rejects.toThrow("STALE");
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "home-principal-registration-"));
  roots.push(root);
  await applyReliverseHomeInitPlan(await planReliverseHomeInit({ root, principalHandle: "owner" }));
  const plan = await planReliversePrincipalRegistration({
    root,
    handle: "luna",
    displayName: "Luna",
    principalKind: "agent",
  });
  return { root, plan, registry: path.join(root, "principals") };
}

test("preview writes nothing; create-only agent registration preserves owner/default and creates no credential or authority", async () => {
  const { root, plan, registry } = await fixture();
  const manifest = await readFile(path.join(root, "home.json"), "utf8");
  const before = await inspectReliverseHome(root);
  const owner = await readFile(before.paths.defaultPrincipal, "utf8");
  expect(await readdir(registry)).toEqual([before.principal!.id]);
  const result = await applyReliversePrincipalRegistration(plan);
  expect(result).toMatchObject({
    principal: { id: plan.principal.id, handle: "luna", principalKind: "agent", status: "active" },
    defaultPrincipalId: before.principal!.id,
    authenticated: false,
    authorityGranted: false,
    credentialCreated: false,
  });
  expect(await readFile(path.join(root, "home.json"), "utf8")).toBe(manifest);
  expect(await readFile(before.paths.defaultPrincipal, "utf8")).toBe(owner);
  expect(JSON.parse(await readFile(result.path, "utf8"))).toEqual(plan.principal);
  expect((await lstat(result.path)).mode & 0o777).toBe(0o600);
  expect((await lstat(path.dirname(result.path))).mode & 0o777).toBe(0o700);
  expect((await inspectReliverseHome(root)).principal!.id).toBe(before.principal!.id);
  expect((await readdir(registry)).sort()).toEqual(
    [before.principal!.id, plan.principal.id].sort(),
  );
  await expect(applyReliversePrincipalRegistration(plan)).rejects.toThrow("STALE");
  await expect(
    planReliversePrincipalRegistration({ root, handle: "LUNA", principalKind: "agent" }),
  ).rejects.toThrow("CONFLICT");
});

test("changed Home metadata or Principal inventory invalidates an existing plan", async () => {
  const { root, plan } = await fixture();
  const home = path.join(root, "home.json");
  await writeFile(home, `${await readFile(home, "utf8")}\n`);
  await expect(applyReliversePrincipalRegistration(plan)).rejects.toThrow("STALE");
  const next = await planReliversePrincipalRegistration({
    root,
    handle: "luna",
    principalKind: "agent",
  });
  const other = await planReliversePrincipalRegistration({
    root,
    handle: "other",
    principalKind: "agent",
  });
  await applyReliversePrincipalRegistration(other);
  await expect(applyReliversePrincipalRegistration(next)).rejects.toThrow("STALE");
});

test("tampered plan and duplicate owner handle or id refuse without replacing owner bytes", async () => {
  const { root, plan } = await fixture();
  await expect(
    applyReliversePrincipalRegistration({
      ...plan,
      principal: { ...plan.principal, handle: "other" },
    }),
  ).rejects.toThrow("PLAN_INVALID");
  const owner = (await inspectReliverseHome(root)).principal!;
  await expect(planReliversePrincipalRegistration({ root, handle: "owner" })).rejects.toThrow(
    "CONFLICT",
  );
  await expect(
    planReliversePrincipalRegistration({ root, handle: "other", id: owner.id }),
  ).rejects.toThrow("CONFLICT");
});

test("an interrupted cooperative lock is retained, never stolen", async () => {
  const { root, plan, registry } = await fixture();
  const lock = path.join(registry, ".registration.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "retained"), "existing writer");
  await expect(applyReliversePrincipalRegistration(plan)).rejects.toThrow("EEXIST");
  await expect(planReliversePrincipalRegistration({ root, handle: "other" })).rejects.toThrow(
    "LOCKED",
  );
  expect(await readFile(path.join(lock, "retained"), "utf8")).toBe("existing writer");
});

test("symlinked registry and partial Principal directories fail closed", async () => {
  const { root, plan, registry } = await fixture();
  await mkdir(path.join(registry, plan.principal.id));
  await expect(applyReliversePrincipalRegistration(plan)).rejects.toThrow();
  expect(await readdir(path.join(registry, plan.principal.id))).toEqual([]);
  const other = await fixture();
  await rm(other.registry, { recursive: true });
  await symlink(registry, other.registry);
  await expect(applyReliversePrincipalRegistration(other.plan)).rejects.toThrow("PATH_UNSAFE");
  await expect(
    planReliversePrincipalRegistration({ root: other.root, handle: "other" }),
  ).rejects.toThrow("PATH_UNSAFE");
});

test("two plans from the same baseline cannot publish competing identities concurrently", async () => {
  const { root, plan, registry } = await fixture();
  const other = await planReliversePrincipalRegistration({
    root,
    handle: "other",
    principalKind: "agent",
  });
  const results = await Promise.allSettled([
    applyReliversePrincipalRegistration(plan),
    applyReliversePrincipalRegistration(other),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await readdir(registry)).toHaveLength(2);
});
