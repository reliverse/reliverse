import { describe, expect, test } from "bun:test";

import {
  findUnsafeDependencySpecifiers,
  normalizePublishDependencySpecifiers,
} from "./workspace-deps";

describe("publish workspace dependency detection", () => {
  test("finds unsafe runtime publish specifiers and ignores devDependencies", () => {
    expect(
      findUnsafeDependencySpecifiers({
        dependencies: {
          a: "workspace:*",
          b: "catalog:",
          c: "^1.0.0",
        },
        devDependencies: {
          ignored: "workspace:*",
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

  test("normalizes workspace and catalog specifiers for publish metadata", () => {
    expect(
      normalizePublishDependencySpecifiers(
        {
          dependencies: {
            a: "workspace:*",
            b: "workspace:~",
            c: "catalog:",
            d: "^1.0.0",
          },
          devDependencies: {
            ignored: "workspace:*",
          },
        },
        {
          catalog: new Map([["c", "^3.0.0"]]),
          workspaceVersions: new Map([
            ["a", "1.2.3"],
            ["b", "2.3.4"],
          ]),
        },
      ),
    ).toEqual({
      dependencies: {
        a: "^1.2.3",
        b: "~2.3.4",
        c: "^3.0.0",
        d: "^1.0.0",
      },
      devDependencies: {
        ignored: "workspace:*",
      },
    });
  });
});
