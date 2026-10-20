import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectBoundaryPolicy } from "./policy";

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("repo.boundaries reports invalid imports from generated Rempts composition profiles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-boundaries-profile-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    await write(root, "apps/host/package.json", JSON.stringify({ name: "@fixture/host" }));
    await write(root, "packages/plugin/package.json", JSON.stringify({ name: "@fixture/plugin" }));
    await write(root, "packages/plugin/src/cmd.ts", "export default {};\n");
    await write(
      root,
      "apps/host/src/rempts/generated-profile.mjs",
      'import command from "../../../../packages/plugin/src/cmd.ts";\n',
    );
    await write(
      root,
      "apps/host/src/hand-authored.ts",
      'import command from "../../../packages/plugin/src/cmd.ts";\n',
    );

    const report = await inspectBoundaryPolicy(root);
    expect(report.findings).toHaveLength(4);
    expect(report.findings.map(({ path: importer, ruleId }) => [importer, ruleId])).toEqual([
      ["apps/host/src/hand-authored.ts", "repo.boundaries.relative-workspace-import"],
      ["apps/host/src/hand-authored.ts", "repo.boundaries.typescript-extension"],
      ["apps/host/src/rempts/generated-profile.mjs", "repo.boundaries.relative-workspace-import"],
      ["apps/host/src/rempts/generated-profile.mjs", "repo.boundaries.typescript-extension"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.boundaries keeps identical import occurrences as separate located findings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-boundaries-occurrences-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }),
    );
    await write(root, "apps/host/package.json", JSON.stringify({ name: "@fixture/host" }));
    await write(root, "packages/plugin/package.json", JSON.stringify({ name: "@fixture/plugin" }));
    await write(root, "packages/plugin/src/value.ts", "export const value = 1;\n");
    await write(
      root,
      "apps/host/src/host.ts",
      [
        'import type { Value } from "../../../packages/plugin/src/value";',
        'import { value } from "../../../packages/plugin/src/value";',
      ].join("\n"),
    );

    const report = await inspectBoundaryPolicy(root);
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((finding) => finding.range?.start.line)).toEqual([1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.boundaries still reports TypeScript-only suffixes in repository tooling", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-boundaries-tooling-"));
  try {
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["scripts", "packages/*"] }),
    );
    await write(root, "scripts/package.json", JSON.stringify({ name: "@fixture/scripts" }));
    await write(root, "packages/plugin/package.json", JSON.stringify({ name: "@fixture/plugin" }));
    await write(root, "packages/plugin/src/cmd.ts", "export default {};");
    await write(
      root,
      "scripts/run.ts",
      [
        'import extensionless from "../packages/plugin/src/cmd";',
        'import typed from "../packages/plugin/src/cmd.ts";',
      ].join("\n"),
    );

    const report = await inspectBoundaryPolicy(root);
    expect(report.findings).toHaveLength(1);
    expect(report.findings).toMatchObject([
      {
        path: "scripts/run.ts",
        range: { start: { line: 2 } },
        ruleId: "repo.boundaries.typescript-extension",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
