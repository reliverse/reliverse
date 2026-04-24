import { describe, expect, test } from "bun:test";

import { createPublishExecutedTargets, createTargetSets, formatSkippedMessages } from "./report-helpers";

describe("dler report helpers", () => {
  test("creates symmetric target-set payloads", () => {
    const payload = createTargetSets({
      executedTargets: [{ cwd: "/repo/a", exitCode: 0, label: "a", ok: true }],
      plannedTargets: [{ cwd: "/repo/a", label: "a" }, { cwd: "/repo/b", label: "b" }],
      skippedTargets: [{ label: "b", reason: "missing package.json" }],
    });

    expect(payload).toEqual({
      executedTargets: [{ cwd: "/repo/a", exitCode: 0, label: "a", ok: true }],
      plannedTargets: [{ cwd: "/repo/a", label: "a" }, { cwd: "/repo/b", label: "b" }],
      skippedTargets: [{ label: "b", reason: "missing package.json" }],
    });
  });

  test("formats skipped messages consistently", () => {
    expect(formatSkippedMessages([{ label: "pkg", reason: "private" }])).toEqual([
      "Skipped: pkg: private",
    ]);
  });

  test("creates executed targets from publish results consistently", () => {
    expect(createPublishExecutedTargets([
      { cwd: "/repo/a", label: "a", npm: { exitCode: 0 } },
      { cwd: "/repo/b", label: "b", npm: { exitCode: 1 } },
    ])).toEqual([
      { cwd: "/repo/a", exitCode: 0, label: "a", ok: true },
      { cwd: "/repo/b", exitCode: 1, label: "b", ok: false },
    ]);
  });
});
