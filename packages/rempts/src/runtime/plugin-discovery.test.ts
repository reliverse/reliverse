import { describe, expect, test } from "bun:test";

import { RemptsUsageError } from "./errors";
import { readGlobalRemptsConfig } from "./global-plugin-config";
import { matchConflictPriorityRule, matchesAnyGlob, resolveDiscoveredPlugins } from "./plugin-discovery";

describe("plugin discovery helpers", () => {
  test("matches simple allowlist globs predictably", () => {
    expect(matchesAnyGlob("@reliverse/dler-rse-plugin", ["@reliverse/*-rse-plugin"])).toBe(true);
    expect(matchesAnyGlob("@reliverse/dler-rse-plugin", ["@other/*"])).toBe(false);
  });

  test("supports exact package override before broader pattern priority", () => {
    expect(
      matchConflictPriorityRule("@bleverse/dler-rse-plugin", [
        "@reliverse/dler-rse-plugin",
        "@bleverse/dler-rse-plugin",
        "@reliverse/*-rse-plugin",
        "@bleverse/*-rse-plugin",
      ]),
    ).toEqual({ index: 1, kind: "exact-package", rule: "@bleverse/dler-rse-plugin" });

    expect(
      matchConflictPriorityRule("@bleverse/extra-rse-plugin", [
        "@reliverse/dler-rse-plugin",
        "@bleverse/dler-rse-plugin",
        "@reliverse/*-rse-plugin",
        "@bleverse/*-rse-plugin",
      ]),
    ).toEqual({ index: 3, kind: "pattern", rule: "@bleverse/*-rse-plugin" });
  });

  test("rejects discovery config when allowedPatterns is empty", async () => {
    await expect(
      resolveDiscoveredPlugins({
        allowedPatterns: [],
        cliName: "rse",
        cwd: "/tmp/nope",
        entryDirectory: "/tmp/nope",
        entryFilePath: "/tmp/nope/cli.ts",
      }),
    ).rejects.toBeInstanceOf(RemptsUsageError);
  });

  test("returns no plugins when no host package root exists", async () => {
    const result = await resolveDiscoveredPlugins({
      allowedPatterns: ["@reliverse/*-rse-plugin"],
      cliName: "rse",
      cwd: "/tmp/rempts-no-host-root",
      entryDirectory: "/tmp/rempts-no-host-root",
      entryFilePath: "/tmp/rempts-no-host-root/cli.ts",
    });

    expect(result).toEqual([]);
  });
});

describe("global plugin config", () => {
  test("ignores invalid config payloads safely", async () => {
    const config = await readGlobalRemptsConfig("/tmp/definitely-missing-rempts-config.json");
    expect(config).toBeNull();
  });
});
