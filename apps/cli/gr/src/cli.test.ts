import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../../../..");
const cliPath = path.join(repositoryRoot, "apps/cli/gr/src/cli.ts");
const temporaryRoots = new Set<string>();

async function runGr(args: readonly string[], cwd = repositoryRoot) {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function git(root: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(["git", "-c", "color.ui=false", ...args], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", PAGER: "cat" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "reliverse-gr-cli-"));
  temporaryRoots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "gr-cli@reliverse.local"]);
  await git(root, ["config", "user.name", "GR CLI Fixture"]);
  await writeFile(path.join(root, ".gitignore"), "/.private/\n");
  await writeFile(path.join(root, "tracked.txt"), "tracked\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "Initialize fixture"]);
  return root;
}

afterAll(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
});

describe("GR Rempts CLI", () => {
  test("source-only planning requires explicit policy data for any campaign and never implies authority", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, "tracked.txt"), "reviewed change\n");
    const before = await Bun.file(path.join(root, ".git/index")).bytes();
    const args = ["campaign", "plan", "tracked.txt", "--id", "fixture-source", "--base", "HEAD"];
    const missing = await runGr([...args, "--source-only"], root);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain("--publication-policy");
    const publication = {
      mode: "source-only",
      installability: "not-claimed",
      exceptionRef: "fixture-policy:reviewed-source",
    };
    await writeFile(path.join(root, "publication.json"), JSON.stringify(publication));
    const options = ["--source-only", "--publication-policy", "publication.json"];
    const preview = await runGr([...args, ...options, "--json"], root);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).data.policy.publication).toEqual(publication);
    const human = await runGr([...args, ...options], root);
    expect(human.exitCode, human.stderr).toBe(0);
    expect(human.stdout).toContain("Campaign: fixture-source");
    expect(human.stdout.trimStart().startsWith("{")).toBe(false);
    const orphan = await runGr([...args, "--publication-policy", "publication.json"], root);
    expect(orphan.exitCode).not.toBe(0);
    for (const invalid of [
      null,
      {},
      { ...publication, exceptionRef: "" },
      { ...publication, installability: "claimed" },
      { ...publication, authorityGranted: true },
    ]) {
      await writeFile(path.join(root, "publication.json"), JSON.stringify(invalid));
      const result = await runGr([...args, ...options], root);
      expect(result.exitCode).not.toBe(0);
    }
    expect(await Bun.file(path.join(root, ".git/index")).bytes()).toEqual(before);
    expect(
      await Bun.file(
        path.join(root, ".private/reliverse/gr/campaigns/fixture-source/plan.json"),
      ).exists(),
    ).toBe(false);
  });

  test("discovers the complete standalone command surface", async () => {
    const result = await runGr(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("GR CLI");
    for (const command of [
      "status",
      "version",
      "bundle",
      "snapshot",
      "diff",
      "patch",
      "recovery",
      "restore",
      "sandbox",
      "campaign",
      "push",
      "hooks",
    ]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("commit previews missing admission and legacy campaign apply cannot self-grant a commit", async () => {
    const root = await createRepository();
    const index = await Bun.file(path.join(root, ".git/index")).bytes();
    const preview = await runGr(["commit", "--json"], root);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).data).toMatchObject({
      reason: "GR_OWNER_COMMIT_HOST_NOT_ADMITTED",
      capOperation: "repo.commit",
    });
    const blocked = await runGr(["commit", "--interactive", "--apply", "--json"], root);
    expect(blocked.exitCode).not.toBe(0);
    const legacy = await runGr(
      ["campaign", "commit", "not-a-grant.json", "--id", "step", "--apply", "--json"],
      root,
    );
    expect(legacy.exitCode).not.toBe(0);
    expect(legacy.stderr).toContain("GR_CAMPAIGN_GOVERNED_COMMIT_REQUIRED");
    expect(await Bun.file(path.join(root, ".git/index")).bytes()).toEqual(index);
  });

  test("owner push is discoverable, previews missing admission and rejects apply/legacy bypass", async () => {
    const root = await createRepository();
    const preview = await runGr(["push", "--json"], root);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout).data).toMatchObject({
      status: "blocked",
      reason: "GR_OWNER_PUSH_HOST_NOT_ADMITTED",
    });
    const apply = await runGr(["push", "--interactive", "--apply", "--json"], root);
    expect(apply.exitCode).not.toBe(0);
    expect(apply.stdout + apply.stderr).toContain("HOST_NOT_ADMITTED");
    const legacy = await runGr(["campaign", "push", "not-read.json", "--apply"], root);
    expect(legacy.exitCode).not.toBe(0);
    expect(legacy.stdout + legacy.stderr).toContain("GOVERNED_PUSH_REQUIRED");
    const substituted = await runGr(["push", "untrusted-plan.json", "--apply"], root);
    expect(substituted.exitCode).not.toBe(0);
    expect(substituted.stdout + substituted.stderr).toContain("accepts no plan");
  });

  test("reports normalized workspace state as JSON", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, "tracked.txt"), "changed\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked\n");

    const result = await runGr(["status", "--root", root, "--json"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "gr status",
      data: {
        operation: "gr.workspace.inspect",
        summary: { dirty: true, staged: 0, unstaged: 1, untracked: 1 },
      },
      ok: true,
    });
  });

  test("projects release metadata and the next private transition artifact", async () => {
    const root = await createRepository();
    await writeFile(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "@repo/demo-root", version: "0.0.7", private: true }, null, 2)}\n`,
    );
    const result = await runGr(["version", "--root", root, "--json"], root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "gr version",
      data: {
        current: { artifactName: "demo", version: "0.0.7" },
        nextTransition: {
          transitionId: "grt_000000008",
          sequence: 8,
          repository: { version: "0.0.7" },
        },
        nextPatchArtifact: "demo-grt_000000008.patch",
      },
      ok: true,
    });
  });

  test("plans a campaign while allowing dirty work outside its scope", async () => {
    const root = await createRepository();
    await writeFile(path.join(root, "tracked.txt"), "changed\n");
    await writeFile(path.join(root, "outside.txt"), "outside\n");
    const result = await runGr(
      [
        "campaign",
        "plan",
        "tracked.txt",
        "--id",
        "oss-001",
        "--base",
        "HEAD",
        "--root",
        root,
        "--json",
      ],
      root,
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: { campaignId: "oss-001", workspace: { cleanliness: "campaign-dirty" } },
      ok: true,
    });
  });

  test("installs GR mutation guard hooks and blocks direct git commit", async () => {
    const root = await createRepository();
    const install = await runGr(["hooks", "install", "--root", root, "--apply", "--json"], root);
    expect(install.exitCode).toBe(0);
    await writeFile(path.join(root, "tracked.txt"), "guarded\n");
    await git(root, ["add", "tracked.txt"]);
    const child = Bun.spawn(["git", "commit", "-m", "should fail"], {
      cwd: root,
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("GR_GIT_MUTATION_DENIED");
  });

  test("previews snapshot creation without writing repository artifacts", async () => {
    const root = await createRepository();

    const result = await runGr(["snapshot", "--root", root, "--role", "baseline", "--json"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "gr snapshot preview",
      data: {
        dirtyPolicy: "reject",
        operation: "gr.workspace.snapshot",
        role: "baseline",
      },
      ok: true,
    });
    expect(await Bun.file(path.join(root, ".private")).exists()).toBe(false);
  });
  test("previews private continuation restore as an explicit apply-gated bundle operation", async () => {
    const root = await createRepository();
    const bundleRoot = path.join(root, "bundle-root");
    await mkdir(bundleRoot, { recursive: true });
    const result = await runGr(
      ["bundle", "restore-continuation", bundleRoot, "--root", root, "--json"],
      root,
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.data.operation).toBe("gr.repository.bundle.continuation.restore");
    expect(payload.data.applyRequired).toBe(true);
  });
});

test("Work Turn CLI previews without mutation and renders bounded human or opt-in JSON evidence", async () => {
  const root = await createRepository();
  expect((await runGr(["wt", "begin", "--id", "fixture-wt1"], root)).exitCode).toBe(0);
  const empty = await runGr(["wt", "status", "--json"], root);
  expect(JSON.parse(empty.stdout).data.state).toBe("none");
  const begin = await runGr(["wt", "begin", "--id", "fixture-wt1", "--apply"], root);
  expect(begin.exitCode).toBe(0);
  expect(begin.stdout).toContain("Work Turn: fixture-wt1 (active)");
  expect(begin.stdout).not.toContain('"worktreeTree"');
  await writeFile(path.join(root, "tracked.txt"), "owned edit\n");
  const finish = await runGr(["wt", "finish", "--apply", "--json"], root);
  expect(finish.exitCode).toBe(0);
  expect(JSON.parse(finish.stdout).data).toMatchObject({
    state: "completed",
    artifacts: { changedPaths: 1 },
  });
});

test("bundle accepts a repository path as the human-first target and an output directory", async () => {
  const root = await createRepository();
  const out = path.join(root, "bundle-output");
  const result = await runGr(
    ["bundle", root, "--profile", "handoff", "--out", out, "--apply", "--json"],
    path.dirname(root),
  );
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.data.archive.path.startsWith(out)).toBe(true);
  expect(payload.data.archive.path.endsWith(".tar.zst")).toBe(true);
  expect(payload.data.manifest.profile).toBe("handoff");
  expect(await Bun.file(payload.data.installerPath).exists()).toBe(true);
});

test("offline bundle preview resolves the User RPR common composition without requiring --tooling", async () => {
  const root = await createRepository();
  const result = await runGr(
    ["bundle", root, "--profile", "offline", "--dry-run", "--json"],
    path.dirname(root),
  );
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.data.tooling).toMatchObject({ source: "user-rpr-common", required: true });
  expect(payload.data.rprRoot).toContain(".reliverse/rpr");
});

test("global Handoff gr bundle creates one transfer archive for the active primary repository plus coordination truth", async () => {
  const primary = await createRepository();
  const handoff = await createRepository();
  await mkdir(path.join(handoff, "stages"), { recursive: true });
  await mkdir(path.join(handoff, ".config"), { recursive: true });
  await mkdir(path.join(handoff, "registry"), { recursive: true });
  await writeFile(
    path.join(handoff, "stages", "dogfood.md"),
    '<!-- handoff {"status":"active","sequence":1} -->\n# Dogfood\n\nPrimary repository: `reliverse`\n',
  );
  await writeFile(
    path.join(handoff, ".config", "handoff.json"),
    `${JSON.stringify(
      {
        lifecycle: "linear",
        global: true,
        handoffId: "fixture-global",
        registry: { repositories: "registry/repos.json" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(handoff, "registry", "repos.json"),
    `${JSON.stringify({ repositories: [{ id: "reliverse", path: primary }] }, null, 2)}\n`,
  );
  await git(handoff, ["add", "-A"]);
  await git(handoff, ["commit", "-qm", "Add Global Handoff fixture"]);

  const result = await runGr(["bundle", "--profile", "source", "--json"], handoff);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const payload = JSON.parse(result.stdout);
  expect(payload.command).toBe("gr global handoff bundle");
  expect(payload.data.kind).toBe("global-handoff");
  expect(payload.data.manifest.handoff).toMatchObject({
    activeStageId: "dogfood",
    activeStageOrder: 1,
  });
  expect(payload.data.manifest.members.map((member: any) => member.id).sort()).toEqual([
    "global-handoff",
    "reliverse",
  ]);
  expect(payload.data.manifest.sharedFiles).toHaveLength(0);
  expect(await Bun.file(payload.data.archive.path).exists()).toBe(true);

  const verify = await runGr(["bundle", "verify", payload.data.archive.path, "--json"], handoff);
  expect(verify.exitCode).toBe(0);
  expect(JSON.parse(verify.stdout)).toMatchObject({ data: { recognized: true, ok: true } });
});
