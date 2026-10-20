import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectComplexityPolicy } from "./policy";

const config = {
  profile: "indie-first",
  maxRootScripts: 64,
  rootScriptBudgetSeverity: "info",
} as const;

describe("repo complexity after retired supply cleanup", () => {
  test("does not require the retired supply package or CLI", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rq-nc-retired-"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { rpr: "bun apps/cli/rpr/src/cli.ts", gr: "bun apps/cli/gr/src/cli.ts" },
      }),
    );
    const report = await inspectComplexityPolicy(root, config);
    expect(report.findings.some((finding) => finding.ruleId.includes("capsule"))).toBe(false);
  });
});
