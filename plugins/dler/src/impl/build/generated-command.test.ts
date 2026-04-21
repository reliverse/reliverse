import { describe, expect, test } from "bun:test";

import { createGeneratedBuildCommand } from "./generated-command";

describe("generated build command", () => {
  test("creates the internal runner invocation", () => {
    const command = createGeneratedBuildCommand({ cwd: "/repo/packages/pkg", label: "packages/pkg" });

    expect(command.argv.slice(0, 2)).toEqual(["bun", expect.stringContaining("internal-runner.ts")]);
    expect(command.argv.slice(2)).toEqual(["--cwd", "/repo/packages/pkg", "--label", "packages/pkg"]);
    expect(command.display).toContain("internal-runner.ts");
  });
});
