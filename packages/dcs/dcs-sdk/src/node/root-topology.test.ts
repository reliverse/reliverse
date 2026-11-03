import path from "node:path";
import { expect, test } from "bun:test";

import {
  dcsPrivateProductRoot,
  dcsUserProductRoot,
  resolveDcsRootTopology,
} from "./root-topology";

test("defaults private root to workspace .private and user root to ~/.reliverse", () => {
  const topology = resolveDcsRootTopology({
    workspaceRoot: "/work/repo",
    userHome: "/home/tester",
    env: {},
  });
  expect(topology.privateRoot).toBe(path.resolve("/work/repo/.private"));
  expect(topology.reliverseHome).toBe(path.resolve("/home/tester/.reliverse"));
  expect(topology.sources.privateRoot).toBe("workspace-default");
  expect(dcsPrivateProductRoot(topology, "rse")).toBe(path.resolve("/work/repo/.private/reliverse/rse"));
  expect(dcsUserProductRoot(topology, "rse")).toBe(path.resolve("/home/tester/.reliverse/rse"));
});

test("relocates private root through bootstrap-safe environment binding", () => {
  const topology = resolveDcsRootTopology({
    workspaceRoot: "/work/repo",
    userHome: "/home/tester",
    env: {
      RELIVERSE_PRIVATE_ROOT: "/mnt/private/repo-a",
      RELIVERSE_HOME: "/srv/reliverse-home",
      RELIVERSE_OPERATOR_HOME: "/home/deploy/.reliverse",
    },
  });
  expect(topology.privateRoot).toBe(path.resolve("/mnt/private/repo-a"));
  expect(topology.reliverseHome).toBe(path.resolve("/srv/reliverse-home"));
  expect(topology.operatorHome).toBe(path.resolve("/home/deploy/.reliverse"));
  expect(topology.sources.privateRoot).toBe("env");
  expect(topology.sources.operatorHome).toBe("env");
});

test("explicit bindings win over environment bindings", () => {
  const topology = resolveDcsRootTopology({
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
  expect(topology.sources.privateRoot).toBe("explicit");
  expect(topology.sources.reliverseHome).toBe("explicit");
  expect(topology.sources.operatorHome).toBe("explicit");
});
