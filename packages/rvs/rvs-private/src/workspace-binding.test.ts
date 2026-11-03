import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";

import {
  bindRvsPrivateWorkspace,
  discoverRvsPrivateWorkspaceBinding,
  inspectRvsPrivateWorkspaceState,
    inspectRvsPrivateWorkspaceBindings,
  resolveRvsPrivateWorkspaceTopology,
  unbindRvsPrivateWorkspace,
} from "./workspace-binding";

test("read-only binding catalog exposes all logical roots and refuses corrupt registered identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-catalog-"));
  try {
    const options = { workspaceRoot: path.join(root, "repo"), userHome: path.join(root, "home"), env: {} };
    expect(await inspectRvsPrivateWorkspaceBindings(options)).toEqual([]);
    const first = await discoverRvsPrivateWorkspaceBinding({ ...options, privateRoot: path.join(root, "nonstandard-vault"), create: true });
    await discoverRvsPrivateWorkspaceBinding({ ...options, workspaceRoot: path.join(root, "other"), privateRoot: path.join(root, "other-vault"), create: true });
    const before = await readFile(first!.indexPath, "utf8"), bindings = await inspectRvsPrivateWorkspaceBindings(options);
    expect(bindings.map((b) => b.privateRoot).sort()).toEqual([path.join(root, "nonstandard-vault"), path.join(root, "other-vault")].sort());
    expect(await readFile(first!.indexPath, "utf8")).toBe(before);
    await writeFile(first!.bindingPath, JSON.stringify({ ...first!.binding, workspaceRoot: path.join(root, "wrong") }));
    await expect(inspectRvsPrivateWorkspaceBindings(options)).rejects.toThrow("ROOT_MISMATCH");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("creates a durable user workspace binding with opaque identity and DCS v0 metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  const privateRoot = path.join(root, "external-private");
  const result = await discoverRvsPrivateWorkspaceBinding({
    workspaceRoot,
    userHome,
    privateRoot,
    env: {},
    create: true,
  });
  expect(result?.created).toBe(true);
  expect(result?.binding.workspaceId).toMatch(/^wsp_[a-z0-9]{24}$/);
  expect(result?.binding.privateRoot).toBe(path.resolve(privateRoot));
  expect(result?.binding.$dcs).toEqual({
    id: "org.reliverse.rvs.private.workspace",
    contractVersion: 0,
    documentVersion: 0,
  });
  expect(result?.bindingPath).toContain("/.reliverse/rvs/private/workspaces/");
  expect(await readFile(result!.bindingPath, "utf8")).toContain('"schemaVersion": "rvs.private.workspace-binding.v0"');
});

test("rediscovers one workspace identity and resolves the persisted private root without env", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  const privateRoot = path.join(root, "private-on-fast-disk");
  const first = await discoverRvsPrivateWorkspaceBinding({ workspaceRoot, userHome, privateRoot, env: {}, create: true });
  const second = await discoverRvsPrivateWorkspaceBinding({ workspaceRoot, userHome, env: {}, create: false });
  expect(second?.created).toBe(false);
  expect(second?.binding.workspaceId).toBe(first?.binding.workspaceId);
  const topology = await resolveRvsPrivateWorkspaceTopology({ workspaceRoot, userHome, env: {} });
  expect(topology.privateRoot).toBe(path.resolve(privateRoot));
  expect(topology.sources.privateRoot).toBe("explicit");
});

test("operator bindings live under operator home and require an explicit operator home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const operatorHome = path.join(root, "deploy-reliverse");
  const created = await discoverRvsPrivateWorkspaceBinding({
    workspaceRoot,
    userHome: path.join(root, "user"),
    operatorHome,
    authority: "operator",
    env: {},
    create: true,
  });
  expect(created?.bindingPath.startsWith(path.resolve(operatorHome))).toBe(true);
  await expect(
    discoverRvsPrivateWorkspaceBinding({
      workspaceRoot: path.join(root, "other"),
      userHome: path.join(root, "user"),
      authority: "operator",
      env: {},
      create: true,
    }),
  ).rejects.toThrow("RVS_PRIVATE_OPERATOR_HOME_MISSING");
});

test("RELIVERSE_PRIVATE_ROOT remains the bootstrap override over durable bindings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  await discoverRvsPrivateWorkspaceBinding({
    workspaceRoot,
    userHome,
    privateRoot: path.join(root, "stored-private"),
    env: {},
    create: true,
  });
  const topology = await resolveRvsPrivateWorkspaceTopology({
    workspaceRoot,
    userHome,
    env: { RELIVERSE_PRIVATE_ROOT: path.join(root, "override-private") },
  });
  expect(topology.privateRoot).toBe(path.resolve(root, "override-private"));
  expect(topology.sources.privateRoot).toBe("env");
});

test("bind updates an existing workspace binding without changing opaque identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  const first = await bindRvsPrivateWorkspace({
    workspaceRoot,
    userHome,
    privateRoot: path.join(root, "private-a"),
    env: {},
  });
  const second = await bindRvsPrivateWorkspace({
    workspaceRoot,
    userHome,
    privateRoot: path.join(root, "private-b"),
    env: {},
  });
  expect(second.created).toBe(false);
  expect(second.binding.workspaceId).toBe(first.binding.workspaceId);
  expect(second.binding.privateRoot).toBe(path.resolve(root, "private-b"));
  const state = await inspectRvsPrivateWorkspaceState({ workspaceRoot, userHome, env: {} });
  expect(state.privateRootSource).toBe("durable-binding");
  expect(state.effectivePrivateRoot).toBe(path.resolve(root, "private-b"));
});

test("unbind removes durable workspace binding and restores workspace default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rvs-private-binding-"));
  const workspaceRoot = path.join(root, "repo");
  const userHome = path.join(root, "home");
  await bindRvsPrivateWorkspace({
    workspaceRoot,
    userHome,
    privateRoot: path.join(root, "external-private"),
    env: {},
  });
  const removed = await unbindRvsPrivateWorkspace({ workspaceRoot, userHome, env: {} });
  expect(removed.removed).toBe(true);
  const state = await inspectRvsPrivateWorkspaceState({ workspaceRoot, userHome, env: {} });
  expect(state.binding).toBeUndefined();
  expect(state.privateRootSource).toBe("workspace-default");
  expect(state.effectivePrivateRoot).toBe(path.join(path.resolve(workspaceRoot), ".private"));
});
