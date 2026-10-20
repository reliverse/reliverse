import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { REPO_RQ_CONFIG_DEFAULTS } from "../config";
import { inspectPublicSurfaceHygienePolicy } from "./policy";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rq-public-surface-other-repo-"));
  roots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"@example/not-reliverse","private":true,"workspaces":["packages/*"]}\n',
  );
  await Promise.all(
    Object.entries(files).map(async ([name, source]) => {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }),
  );
  return root;
}

describe("repo.public-surface-hygiene policy", () => {
  test("works for a non-Reliverse repository and accepts role-based paths", async () => {
    const root = await fixture({
      "README.md": "Use /home/user/project or /home/deploy/service.\n",
      "docs/guide.md": "The public contract is example.receipt.v0.\n",
    });
    const report = await inspectPublicSurfaceHygienePolicy(
      root,
      REPO_RQ_CONFIG_DEFAULTS.publicSurfaceHygiene,
    );
    expect(report.findings).toEqual([]);
  });

  test("root manifest and lockfile are public-surface baseline inputs too", async () => {
    const root = await fixture({
      "package.json":
        '{"name":"fixture","private":true,"workspaces":["packages/*"],"description":"/home/alice/project"}\n',
      "bun.lock": '"/home/alice/cache"\n',
    });
    const report = await inspectPublicSurfaceHygienePolicy(
      root,
      REPO_RQ_CONFIG_DEFAULTS.publicSurfaceHygiene,
    );
    expect(
      report.findings
        .filter((f) => f.ruleId === "repo.public-surface-hygiene.owner-local-path")
        .map((f) => f.path)
        .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["bun.lock", "package.json"]);
  });

  test("finds owner paths and private or release-like transition labels", async () => {
    const root = await fixture({
      "docs/guide.md": "Clone /home/alice/project. Release grt_000123 is current.\n",
      ".private/evidence.md": "Ignore /home/alice/private and grt_999999.\n",
    });
    const report = await inspectPublicSurfaceHygienePolicy(
      root,
      REPO_RQ_CONFIG_DEFAULTS.publicSurfaceHygiene,
    );
    expect(report.findings.map((finding) => finding.ruleId)).toEqual([
      "repo.public-surface-hygiene.misleading-release-label",
      "repo.public-surface-hygiene.owner-local-path",
      "repo.public-surface-hygiene.private-transition-label",
    ]);
  });
});
