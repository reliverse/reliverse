import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectAgentHarnessPolicy } from "./policy";

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test("reports missing agent harness efficiency invariants", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-agent-harness-"));
  await write(root, "package.json", '{"name":"fixture","workspaces":["packages/*"]}\n');
  const report = await inspectAgentHarnessPolicy(root);
  expect(report.findings.map((finding) => finding.ruleId)).toContain(
    "repo.agent-harness.bounded-output",
  );
  expect(report.findings.map((finding) => finding.ruleId)).toContain(
    "repo.agent-harness.runtime-integration",
  );
});
