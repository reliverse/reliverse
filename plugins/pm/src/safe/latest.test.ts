import { describe, expect, test } from "bun:test";

import { resolveSafeLatestFromMetadata, type SafeLatestPackageMetadata } from "./latest";

const nowMs = Date.parse("2026-05-12T00:00:00.000Z");

function metadata(input: {
  readonly latestVersion: string;
  readonly times: Readonly<Record<string, string>>;
  readonly versions: readonly string[];
  readonly versionMetadata?: SafeLatestPackageMetadata["versionMetadataByVersion"];
}): SafeLatestPackageMetadata {
  return {
    latestVersion: input.latestVersion,
    timeByVersion: input.times,
    versionMetadataByVersion: input.versionMetadata ?? {},
    versions: input.versions,
  };
}

describe("resolveSafeLatestFromMetadata", () => {
  test("selects the newest stable candidate that passes age, deprecated, and install-script gates", async () => {
    const result = await resolveSafeLatestFromMetadata({
      metadata: metadata({
        latestVersion: "1.4.0",
        times: {
          "1.1.0": "2026-04-20T00:00:00.000Z",
          "1.2.0": "2026-05-01T00:00:00.000Z",
          "1.3.0": "2026-05-02T00:00:00.000Z",
          "1.4.0": "2026-05-11T00:00:00.000Z",
        },
        versionMetadata: {
          "1.2.0": { scripts: { postinstall: "node postinstall.js" } },
          "1.3.0": { deprecated: "bad release" },
        },
        versions: ["1.1.0", "1.2.0", "1.3.0", "1.4.0"],
      }),
      nowMs,
      packageName: "demo-package",
      policy: { minimumReleaseAgeDays: 7 },
    });

    expect(result.version).toBe("1.1.0");
    expect(result.decision.selected).toBe("1.1.0");
    expect(result.decision.skipped).toEqual([
      { version: "1.4.0", reasons: ["recentlyPublished:1d<7d"] },
      { version: "1.3.0", reasons: ["deprecated"] },
      { version: "1.2.0", reasons: ["installScript"] },
    ]);
  });

  test("allows configured fresh scopes to bypass the release-age gate", async () => {
    const result = await resolveSafeLatestFromMetadata({
      metadata: metadata({
        latestVersion: "2.0.0",
        times: {
          "1.9.0": "2026-04-01T00:00:00.000Z",
          "2.0.0": "2026-05-11T00:00:00.000Z",
        },
        versions: ["1.9.0", "2.0.0"],
      }),
      nowMs,
      packageName: "@reliverse/toolkit",
      policy: { allowFreshScopes: ["@reliverse/*"], minimumReleaseAgeDays: 7 },
    });

    expect(result.version).toBe("2.0.0");
    expect(result.decision.skipped).toEqual([]);
  });

  test("ignores prereleases and respects max fallback depth", async () => {
    await expect(
      resolveSafeLatestFromMetadata({
        metadata: metadata({
          latestVersion: "3.0.0-beta.1",
          times: {
            "2.0.0": "2026-05-01T00:00:00.000Z",
            "3.0.0-beta.1": "2026-04-01T00:00:00.000Z",
          },
          versions: ["2.0.0", "3.0.0-beta.1"],
        }),
        nowMs,
        packageName: "demo-package",
        policy: { maxFallbackDepth: 1, minimumReleaseAgeDays: 20 },
      }),
    ).rejects.toThrow(/No safe-latest candidate found/);
  });

  test("blocks candidates with Socket shallow alerts at or above the configured threshold", async () => {
    const result = await resolveSafeLatestFromMetadata({
      metadata: metadata({
        latestVersion: "2.0.0",
        times: {
          "1.9.0": "2026-04-01T00:00:00.000Z",
          "2.0.0": "2026-04-01T00:00:00.000Z",
        },
        versions: ["1.9.0", "2.0.0"],
      }),
      nowMs,
      packageName: "demo-package",
      policy: { socket: { enabled: true, require: false, severityThreshold: "high" } },
      socketChecker: async ({ version }) => ({
        alerts:
          version === "2.0.0"
            ? [{ category: "malware", severity: "high", title: "Known malware" }]
            : [],
        ok: true,
      }),
    });

    expect(result.version).toBe("1.9.0");
    expect(result.decision.skipped).toEqual([
      { version: "2.0.0", reasons: ["socketAlert:high:malware:Known malware"] },
    ]);
    expect(result.decision.accepted?.reasons).toContain("socketShallowOk");
  });

  test("requires Socket when configured", async () => {
    await expect(
      resolveSafeLatestFromMetadata({
        metadata: metadata({
          latestVersion: "1.0.0",
          times: { "1.0.0": "2026-04-01T00:00:00.000Z" },
          versions: ["1.0.0"],
        }),
        nowMs,
        packageName: "demo-package",
        policy: { socket: { enabled: true, require: true, severityThreshold: "high" } },
        socketChecker: async () => ({
          alerts: [],
          ok: false,
          unavailableReason: "socket cli missing",
        }),
      }),
    ).rejects.toThrow(/socketUnavailable:socket cli missing/);
  });
});
