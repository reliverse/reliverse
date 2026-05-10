import { describe, expect, test } from "bun:test";

import { defineCommand } from "./define-command";

describe("defineCommand aliases", () => {
  test("normalizes aliases for command segment resolution", () => {
    const command = defineCommand({
      meta: {
        name: "pub",
        aliases: [" publish ", "publish", "ship"],
      },
      async handler() {
        return undefined;
      },
    });

    expect(command.meta?.aliases).toEqual(["publish", "ship"]);
  });

  test("rejects invalid aliases early", () => {
    expect(() =>
      defineCommand({
        meta: { name: "pub", aliases: ["pub"] },
        async handler() {
          return undefined;
        },
      }),
    ).toThrow("must not duplicate the command name");

    expect(() =>
      defineCommand({
        meta: { name: "pub", aliases: ["publish now"] },
        async handler() {
          return undefined;
        },
      }),
    ).toThrow("must be a single command segment");
  });
});
