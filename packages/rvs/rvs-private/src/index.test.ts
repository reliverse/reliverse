import { expect, test } from "bun:test";
import path from "node:path";

import {
  rvsPrivateControlRoot,
  rvsPrivateProductRoot,
  rvsPrivateUserProductRoot,
  rvsPrivateWorkspaceBindingPath,
  resolveRvsPrivateRootTopology,
} from "./index";

test("defaults private root to workspace .private and user root to ~/.reliverse", () => {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: "/work/repo",
    userHome: "/home/user",
    env: {},
  });
  expect(topology.privateRoot).toBe(path.resolve("/work/repo/.private"));
  expect(topology.reliverseHome).toBe(path.resolve("/home/user/.reliverse"));
  expect(rvsPrivateProductRoot(topology, "rse")).toBe(
    path.resolve("/work/repo/.private/reliverse/rse"),
  );
  expect(rvsPrivateControlRoot(topology)).toBe(path.resolve("/home/user/.reliverse/rvs/private"));
});

test("product and workspace identifiers cannot escape their resolved roots", () => {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: "/repo",
    userHome: "/fixture",
    env: {},
  });
  expect(rvsPrivateUserProductRoot(topology, "rse-config")).toBe(
    path.join(topology.reliverseHome, "rse-config"),
  );
  for (const id of [
    "",
    ".",
    "..",
    "../../outside",
    "nested/product",
    "nested\\\\product",
    "/absolute",
    "C:relative",
    "product name",
    "product" + String.fromCharCode(0),
    "product" + String.fromCharCode(10),
  ]) {
    expect(() => rvsPrivateProductRoot(topology, id)).toThrow("RVS_PRIVATE_PRODUCT_ID_INVALID");
    expect(() => rvsPrivateUserProductRoot(topology, id)).toThrow("RVS_PRIVATE_PRODUCT_ID_INVALID");
    expect(() => rvsPrivateWorkspaceBindingPath(topology, id)).toThrow(
      "RVS_PRIVATE_WORKSPACE_ID_INVALID",
    );
  }
});

test("relocates private root through bootstrap-safe environment binding", () => {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: "/work/repo",
    userHome: "/home/user",
    env: {
      RELIVERSE_PRIVATE_ROOT: "/mnt/private/repo",
      RELIVERSE_HOME: "/srv/user-reliverse",
      RELIVERSE_OPERATOR_HOME: "/home/deploy/.reliverse",
    },
  });
  expect(topology.privateRoot).toBe(path.resolve("/mnt/private/repo"));
  expect(topology.reliverseHome).toBe(path.resolve("/srv/user-reliverse"));
  expect(topology.operatorHome).toBe(path.resolve("/home/deploy/.reliverse"));
  expect(topology.sources).toEqual({
    privateRoot: "env",
    reliverseHome: "env",
    operatorHome: "env",
  });
});

test("explicit bindings win over environment bindings", () => {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: "/work/repo",
    privateRoot: "/explicit/private",
    reliverseHome: "/explicit/home",
    operatorHome: "/explicit/operator",
    env: {
      RELIVERSE_PRIVATE_ROOT: "/env/private",
      RELIVERSE_HOME: "/env/home",
      RELIVERSE_OPERATOR_HOME: "/env/operator",
    },
  });
  expect(topology.privateRoot).toBe(path.resolve("/explicit/private"));
  expect(topology.reliverseHome).toBe(path.resolve("/explicit/home"));
  expect(topology.operatorHome).toBe(path.resolve("/explicit/operator"));
  expect(topology.sources).toEqual({
    privateRoot: "explicit",
    reliverseHome: "explicit",
    operatorHome: "explicit",
  });
});

test("workspace binding control state lives under ~/.reliverse/rvs/private", () => {
  const topology = resolveRvsPrivateRootTopology({
    workspaceRoot: "/repo",
    userHome: "/home/user",
    env: {},
  });
  expect(rvsPrivateWorkspaceBindingPath(topology, "wsp_123")).toBe(
    path.resolve("/home/user/.reliverse/rvs/private/workspaces/wsp_123/config.json"),
  );
  expect(() => rvsPrivateWorkspaceBindingPath(topology, "../escape")).toThrow(
    "RVS_PRIVATE_WORKSPACE_ID_INVALID",
  );
});
