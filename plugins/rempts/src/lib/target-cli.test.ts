import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectTargetCliResolution, resolveTargetCli } from "./target-cli";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const cliCwd = join(repoRoot, "apps", "cli", "src");

describe("resolveTargetCli", () => {
  test("resolves local workspace CLI by bin name", async () => {
    const resolved = await resolveTargetCli(cliCwd, { cli: "rse" });

    expect(resolved).not.toBeNull();
    expect(resolved?.binName).toBe("rse");
    expect(resolved?.mode).toBe("local");
    expect(resolved?.packageName).toBe("@reliverse/rse");
  });

  test("resolves local workspace CLI by package name", async () => {
    const resolved = await resolveTargetCli(cliCwd, { cli: "@reliverse/rse" });

    expect(resolved).not.toBeNull();
    expect(resolved?.binName).toBe("rse");
    expect(resolved?.mode).toBe("local");
    expect(resolved?.packageName).toBe("@reliverse/rse");
  });

  test("strict-global policy does not fall back to local workspace resolution", async () => {
    const report = await inspectTargetCliResolution(cliCwd, { cli: "rse", strictGlobal: true });

    expect(report.resolutionPolicy).toBe("strict-global");
    expect(report.resolved).toBeNull();
    expect(report.attempts.some((entry) => entry.kind === "global-bin")).toBe(true);
    expect(report.attempts.some((entry) => entry.kind === "local-workspace")).toBe(false);
  });
});
