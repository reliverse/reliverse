import { describe, expect, test } from "bun:test";

import { createBuildSummary, createPublishSummary, formatBuildSummary, formatPublishSummary } from "./result-contract";

describe("dler result contract helpers", () => {
  test("creates and formats build summaries consistently", () => {
    const summary = createBuildSummary({
      planned: 3,
      skipped: [{ label: "packages/missing", reason: "missing" }],
      targets: [
        { cwd: ".", durationMs: 1, exitCode: 0, label: "a", ok: true, provider: "bun", stderr: "", stdout: "" },
        { cwd: ".", durationMs: 2, exitCode: 1, label: "b", ok: false, provider: "bun", stderr: "boom", stdout: "" },
      ],
    });

    expect(summary).toEqual({ failed: 1, planned: 3, skipped: 1, succeeded: 1 });
    expect(formatBuildSummary(summary)).toBe("Summary: 1 built, 1 failed, 1 skipped.");
  });

  test("creates and formats publish summaries consistently", () => {
    const summary = createPublishSummary({
      planned: 4,
      published: 2,
      skipped: [{ label: "packages/private", reason: "private" }],
    });

    expect(summary).toEqual({ failed: 0, planned: 4, published: 2, skipped: 1 });
    expect(formatPublishSummary(summary, true)).toBe("Summary: 2 prepared, 0 failed, 1 skipped.");
    expect(formatPublishSummary(summary, false)).toBe("Summary: 2 published, 0 failed, 1 skipped.");
  });
});
