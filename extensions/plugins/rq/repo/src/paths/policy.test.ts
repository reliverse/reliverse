import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectTrackedPathPolicy } from "./policy";
import { REPO_PATHS_RULE_IDS } from "./rules";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function git(root: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", "-c", "color.ui=false", "-c", "core.pager=cat", ...args], {
    cwd: root,
    env: {
      ...globalThis.process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      PAGER: "cat",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    Bun.readableStreamToText(child.stdout),
    Bun.readableStreamToText(child.stderr),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
}

async function createGitFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "repo-rq-tracked-paths-"));
  temporaryRoots.push(root);
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "rq@example.invalid"]);
  await git(root, ["config", "user.name", "RQ Fixture"]);
  await writeFile(path.join(root, ".gitignore"), "/!handoff/\n/.agents/rse/\n");
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"@fixture/repository","private":true}\n',
  );
  await mkdir(path.join(root, "!handoff"), { recursive: true });
  await writeFile(path.join(root, "!handoff/context.md"), "temporary context\n");
  await git(root, ["add", ".gitignore", "package.json"]);
  return root;
}

function ruleIds(report: Awaited<ReturnType<typeof inspectTrackedPathPolicy>>): readonly string[] {
  return report.findings.map((finding) => finding.ruleId);
}

describe("tracked transient path policy", () => {
  test("allows ignored untracked handoff content", async () => {
    const root = await createGitFixture();
    const report = await inspectTrackedPathPolicy(root);

    expect(report.findings).toEqual([]);
    expect(report.metadata).toMatchObject({ trackedPathInspection: "passed" });
  });

  test("rejects staged and committed handoff content", async () => {
    const root = await createGitFixture();
    await git(root, ["add", "--force", "!handoff/context.md"]);

    const staged = await inspectTrackedPathPolicy(root);
    expect(ruleIds(staged)).toEqual([REPO_PATHS_RULE_IDS.forbiddenTrackedPath]);
    expect(staged.findings[0]).toMatchObject({ path: "!handoff/context.md" });

    await git(root, ["commit", "--quiet", "-m", "fixture"]);
    const committed = await inspectTrackedPathPolicy(root);
    expect(ruleIds(committed)).toEqual([REPO_PATHS_RULE_IDS.forbiddenTrackedPath]);
  });

  test("rejects tracked Rse private state", async () => {
    const root = await createGitFixture();
    await mkdir(path.join(root, ".agents/rse"), { recursive: true });
    await writeFile(path.join(root, ".agents/rse/project.json"), "{}\n");
    await git(root, ["add", "--force", ".agents/rse/project.json"]);

    const report = await inspectTrackedPathPolicy(root);
    expect(ruleIds(report)).toEqual([REPO_PATHS_RULE_IDS.forbiddenTrackedPath]);
    expect(report.findings[0]).toMatchObject({ path: ".agents/rse/project.json" });
  });

  test("passes after a handoff file is removed from the index", async () => {
    const root = await createGitFixture();
    await git(root, ["add", "--force", "!handoff/context.md"]);
    await git(root, ["rm", "--cached", "--quiet", "!handoff/context.md"]);

    const report = await inspectTrackedPathPolicy(root);
    expect(report.findings).toEqual([]);
  });

  test("fails closed when Git tracked state cannot be inspected", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "repo-rq-no-git-"));
    temporaryRoots.push(root);

    const report = await inspectTrackedPathPolicy(root);
    expect(ruleIds(report)).toEqual([REPO_PATHS_RULE_IDS.trackedPathInspection]);
    expect(report.findings[0]).toMatchObject({ path: ".git" });
  });
});
