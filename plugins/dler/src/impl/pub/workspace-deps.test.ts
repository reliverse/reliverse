import { describe, expect, test } from "bun:test";

import { findUnsafeDependencySpecifiers } from "./workspace-deps";

describe("publish workspace dependency detection", () => {
  test("finds workspace and catalog-like specifiers conservatively", () => {
    expect(
      findUnsafeDependencySpecifiers({
        dependencies: {
          a: "workspace:*",
          b: "catalog:",
          c: "^1.0.0",
        },
        peerDependencies: {
          d: "file:../local",
        },
      }),
    ).toEqual([
      { field: "dependencies", name: "a", specifier: "workspace:*" },
      { field: "dependencies", name: "b", specifier: "catalog:" },
      { field: "peerDependencies", name: "d", specifier: "file:../local" },
    ]);
  });
});
