import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commitGrCampaignStep,
  createGrCampaignPlan,
  freezeGrCampaignPlan,
  pushGrCampaign,
  verifyGrCampaignRemoteBase,
} from "./campaign";
import {
  readGrCampaignReviewSource,
  readGrCampaignReviewTreeProof,
  verifyGrCampaignReviewTreeProof,
  type GrCampaignReviewTreeProof,
} from "./campaign-review-source";
import {
  assertGrGitInvocationAuthorized,
  classifyGrGitInvocation,
  GR_GIT_AUTHORITY_ENV,
  GR_GIT_AUTHORITY_VALUE,
  installGrGitAuthorityHooks,
} from "./hooks";
import { fingerprintGrJson } from "./json";

const roots = new Set<string>();
async function git(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, Bun.readableStreamToText(child.stderr)]);
  if (code !== 0) throw new Error(stderr);
}
async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-campaign-"));
  roots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(root, ".gitignore"), "/.private/\n");
  await writeFile(path.join(root, "core.txt"), "base\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-qm", "base"]);
  return root;
}
afterAll(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

test("scoped campaigns pin unchanged root manifest and lockfile without manufacturing changes", async () => {
  const root = await repo();
  const manifest = '{"name":"fixture","private":true}\n';
  await writeFile(path.join(root, "package.json"), manifest);
  await writeFile(path.join(root, "bun.lock"), '{"workspaces":{"":{"name":"fixture"}}}\n');
  await git(root, ["add", "package.json", "bun.lock"]);
  await git(root, ["commit", "-qm", "metadata base"]);
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "metadata-fixture",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    commits: [{ id: "core", title: "core", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(plan.scope.paths).toEqual(["bun.lock", "core.txt", "package.json"]);
  expect(plan.baselineInputs?.map((f) => f.path)).toEqual(["bun.lock", "package.json"]);
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const source = await readGrCampaignReviewSource({
    root,
    plan: frozen,
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(
    Buffer.from(
      source.files.find((f) => f.path === "package.json")!.contentBase64,
      "base64",
    ).toString(),
  ).toBe(manifest);
  expect(await readFile(path.join(root, "package.json"), "utf8")).toBe(manifest);
  const { baselineInputs: _inputs, campaignFingerprint: _fingerprint, ...legacySemantic } = frozen;
  const legacy = {
    ...legacySemantic,
    campaignFingerprint: fingerprintGrJson(legacySemantic, "gr.campaign-plan.v0"),
  };
  await expect(
    commitGrCampaignStep({
      root,
      plan: legacy,
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("legacy plans");
  const committed = await commitGrCampaignStep({
    root,
    plan: frozen,
    commitId: "core",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  expect(committed.stagedPaths).toEqual(["core.txt"]);
  await writeFile(path.join(root, "package.json"), '{"name":"later"}\n');
  const retained = await readGrCampaignReviewSource({
    root,
    plan: frozen,
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(retained.files.find((f) => f.path === "package.json")!.sha256).toBe(
    source.files.find((f) => f.path === "package.json")!.sha256,
  );
});

test("dirty root metadata needs explicit scope and cannot drift between plan and freeze", async () => {
  const root = await repo();
  await writeFile(path.join(root, "package.json"), '{"name":"base"}\n');
  await writeFile(path.join(root, "bun.lock"), "base lock\n");
  await git(root, ["add", "package.json", "bun.lock"]);
  await git(root, ["commit", "-qm", "metadata base"]);
  const input = {
    root,
    campaignId: "metadata-ownership",
    baseRevision: "HEAD",
    grantedEffects: ["filesystem.read", "git.read"] as const,
  };
  const planned = await createGrCampaignPlan({ ...input, paths: ["core.txt"] });
  await writeFile(path.join(root, "package.json"), '{"name":"reviewed"}\n');
  await expect(createGrCampaignPlan({ ...input, paths: ["core.txt"] })).rejects.toThrow(
    "explicit Campaign scope",
  );
  await expect(
    freezeGrCampaignPlan({
      root,
      plan: planned,
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("replan/review");
  await writeFile(path.join(root, "bun.lock"), "changed lock\n");
  await expect(
    createGrCampaignPlan({ ...input, paths: ["core.txt", "package.json"] }),
  ).rejects.toThrow("bun.lock");
  const accepted = await createGrCampaignPlan({
    ...input,
    paths: ["package.json", "bun.lock"],
    commits: [{ id: "metadata", title: "metadata", paths: ["package.json", "bun.lock"] }],
  });
  const before = await readFile(path.join(root, ".git/index"));
  const frozen = await freezeGrCampaignPlan({
    root,
    plan: accepted,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  expect(frozen.baselineInputs).toEqual(accepted.baselineInputs);
  expect(await readFile(path.join(root, ".git/index"))).toEqual(before);
});

test("a campaign cannot silently delete an existing root package manifest", async () => {
  const root = await repo();
  await writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  await git(root, ["add", "package.json"]);
  await git(root, ["commit", "-qm", "metadata base"]);
  await rm(path.join(root, "package.json"));
  await expect(
    createGrCampaignPlan({
      root,
      campaignId: "missing-root",
      baseRevision: "HEAD",
      paths: ["core.txt"],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
  ).rejects.toThrow("cannot omit");
});

test("review source reads frozen scoped blobs and rejects forged plans or undeclared effects", async () => {
  const root = await repo();
  const plan = await freezeGrCampaignPlan({
    root,
    plan: await createGrCampaignPlan({
      root,
      campaignId: "review-fixture",
      baseRevision: "HEAD",
      paths: ["core.txt"],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
    grantedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
  });
  await writeFile(path.join(root, "core.txt"), "not frozen\n");
  const result = await readGrCampaignReviewSource({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(result.files.map((f) => f.path)).toEqual(["core.txt"]);
  expect(Buffer.from(result.files[0]!.contentBase64, "base64").toString()).toBe("base\n");
  expect(result.authorityGranted).toBe(false);
  expect(result.protectedCustody).toBe(false);
  const proof = await readGrCampaignReviewTreeProof({
    root,
    inventory: result,
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(verifyGrCampaignReviewTreeProof(proof, result)).toMatchObject({
    files: 1,
    scopedCompletenessVerified: true,
    authorityGranted: false,
  });
  await expect(readGrCampaignReviewTreeProof({ root, inventory: result })).rejects.toMatchObject({
    code: "GR_NOT_AUTHORIZED",
  });
  await expect(readGrCampaignReviewSource({ root, plan })).rejects.toMatchObject({
    code: "GR_NOT_AUTHORIZED",
  });
  await expect(
    readGrCampaignReviewSource({
      root,
      plan: { ...plan, campaignFingerprint: "0".repeat(64) },
      grantedEffects: ["filesystem.read", "git.read"],
    }),
  ).rejects.toThrow();
});

test("tree proof reconstructs root membership and refuses omitted files, subtrees, modes and foreign roots in both verifiers", () => {
  type Entry = GrCampaignReviewTreeProof["trees"][number]["entries"][number];
  const node = (entries: readonly Entry[]) => {
    const raw = Buffer.concat(
      entries.flatMap((e) => [
        Buffer.from(e.mode + " " + e.name + "\0"),
        Buffer.from(e.oid, "hex"),
      ]),
    );
    return {
      oid: createHash("sha1").update(`tree ${raw.length}\0`).update(raw).digest("hex"),
      entries,
    };
  };
  const child = node([
    { mode: "100644", name: "a.ts", oid: "a".repeat(40) },
    { mode: "100755", name: "b.ts", oid: "b".repeat(40) },
  ]);
  const root = node([
    { mode: "40000", name: ".private", oid: "c".repeat(40) },
    { mode: "40000", name: "src", oid: child.oid },
  ]);
  const proof: GrCampaignReviewTreeProof = {
    schema: "gr.campaign-review-tree-proof.v0",
    candidateTree: root.oid,
    trees: [root, child],
  };
  const inventory = {
    candidateTree: root.oid,
    scope: ["src"],
    files: [
      { path: "src/a.ts", gitBlob: "a".repeat(40), executable: false },
      { path: "src/b.ts", gitBlob: "b".repeat(40), executable: true },
    ],
  };
  expect(verifyGrCampaignReviewTreeProof(proof, inventory)).toMatchObject({
    files: 2,
    treeObjects: 2,
  });
  const variants = [
    { proof, inventory: { ...inventory, files: inventory.files.slice(0, 1) } },
    { proof: { ...proof, trees: [root] }, inventory },
    {
      proof: { ...proof, trees: [root, { ...child, entries: child.entries.slice(0, 1) }] },
      inventory,
    },
    { proof: { ...proof, trees: [root, child, child] }, inventory },
    { proof, inventory: { ...inventory, files: [...inventory.files, inventory.files[0]!] } },
    {
      proof,
      inventory: { ...inventory, files: inventory.files.map((f) => ({ ...f, executable: false })) },
    },
    { proof, inventory: { ...inventory, candidateTree: "d".repeat(40) } },
    { proof, inventory: { ...inventory, scope: [".private"] } },
    { proof, inventory: { ...inventory, scope: ["src", "missing"] } },
  ];
  for (const v of variants)
    expect(() => verifyGrCampaignReviewTreeProof(v.proof, v.inventory)).toThrow();
  const python = Bun.spawnSync(
    [
      "/usr/bin/python3",
      "-I",
      "-S",
      "-c",
      `import runpy,json,sys
ns=runpy.run_path(sys.argv[1]); d=json.loads(sys.stdin.read()); assert ns['verify_tree_proof'](d['proof'],d['inventory'])['files']==2
for v in d['variants']:
    try: ns['verify_tree_proof'](v['proof'],v['inventory']); raise AssertionError('bad proof accepted')
    except RuntimeError: pass
print('independent tree verifier passed')`,
      new URL(
        "../../rvs/rvs-systemd-ubuntu/src/campaign-reviewer-account-bootstrap.py",
        import.meta.url,
      ).pathname,
    ],
    { stdin: Buffer.from(JSON.stringify({ proof, inventory, variants })), timeout: 10000 },
  );
  expect(python.exitCode).toBe(0);
  expect(python.stderr.toString()).toBe("");
  expect(python.stdout.toString()).toContain("independent tree verifier passed");
});

test("review source refuses non-text and oversized frozen blobs", async () => {
  for (const content of [Buffer.from([0xff, 0xfe]), Buffer.alloc(2 * 1024 ** 2 + 1, 65)]) {
    const root = await repo();
    await writeFile(path.join(root, "core.txt"), content);
    await git(root, ["add", "core.txt"]);
    await git(root, ["commit", "-qm", "binary fixture baseline"]);
    const plan = await freezeGrCampaignPlan({
      root,
      plan: await createGrCampaignPlan({
        root,
        campaignId: "review-fixture",
        baseRevision: "HEAD",
        paths: ["core.txt"],

        grantedEffects: ["filesystem.read", "git.read"],
      }),
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    });
    await expect(
      readGrCampaignReviewSource({ root, plan, grantedEffects: ["filesystem.read", "git.read"] }),
    ).rejects.toMatchObject({ code: "GR_INVALID_ARTIFACT" });
  }
});

test("GR campaign allows unrelated workspace dirt outside its scope", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "changed\n");
  await writeFile(path.join(root, "outside.txt"), "outside\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-001",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  expect(plan.workspace.cleanliness).toBe("campaign-dirty");
  expect(plan.workspace.inScope.map((entry) => entry.path)).toEqual(["core.txt"]);
  expect(plan.workspace.outsideScope.map((entry) => entry.path)).toEqual(["outside.txt"]);
  expect(plan.policy.workspaceOutsideCampaign).toBe("allowed");
});

test("GR campaign hard-denies private scope", async () => {
  const root = await repo();
  await expect(
    createGrCampaignPlan({
      root,
      campaignId: "oss-001",
      baseRevision: "HEAD",
      paths: [".private/gr/note.md"],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
  ).rejects.toMatchObject({ code: "GR_PRIVATE_PATH_FORBIDDEN" });
});

test("GR campaign remote base verification fails closed on drift", () => {
  expect(() =>
    verifyGrCampaignRemoteBase({
      campaignId: "oss-001",
      expectedCommit: "aaa",
      observedCommit: "bbb",
      remote: "origin",
      ref: "refs/heads/main",
    }),
  ).toThrow();
  expect(
    verifyGrCampaignRemoteBase({
      campaignId: "oss-001",
      expectedCommit: "aaa",
      observedCommit: "aaa",
      remote: "origin",
      ref: "refs/heads/main",
    }).status,
  ).toBe("matched");
});

test("GR Hooks classifies direct Git mutations including add", () => {
  expect(classifyGrGitInvocation(["status"]).authorityRequired).toBe(false);
  expect(classifyGrGitInvocation(["add", "."]).authorityRequired).toBe(true);
  expect(classifyGrGitInvocation(["commit", "-m", "x"]).authorityRequired).toBe(true);
  expect(classifyGrGitInvocation(["push", "origin", "main"]).authorityRequired).toBe(true);
  expect(classifyGrGitInvocation(["-c", "user.name=Agent", "add", "."]).authorityRequired).toBe(
    true,
  );
  expect(
    classifyGrGitInvocation(["-C", "/tmp/repo", "push", "origin", "main"]).authorityRequired,
  ).toBe(true);
});

test("GR Hooks refuse to shadow existing Git hooks", async () => {
  const root = await repo();
  const gitDir = await (async () => {
    const child = Bun.spawn(["git", "rev-parse", "--git-dir"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout] = await Promise.all([
      child.exited,
      Bun.readableStreamToText(child.stdout),
    ]);
    if (code !== 0) throw new Error("git-dir");
    return stdout.trim();
  })();
  const hookDir = path.resolve(root, gitDir, "hooks");
  await mkdir(hookDir, { recursive: true });
  await writeFile(path.join(hookDir, "pre-commit"), "#!/bin/sh\nexit 0\n");
  await expect(
    installGrGitAuthorityHooks({
      root,
      grantedEffects: ["filesystem.read", "filesystem.write", "git.read", "git.write"],
    }),
  ).rejects.toMatchObject({ code: "GR_HOOKS_PATH_CONFLICT" });
});

test("GR campaign commit stages only declared paths and leaves outside dirt untouched", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "changed\n");
  await writeFile(path.join(root, "outside.txt"), "outside\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-001",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    commits: [{ id: "core", title: "feat(core): change core", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const receipt = await commitGrCampaignStep({
    root,
    plan,
    commitId: "core",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  expect(receipt.stagedPaths).toEqual(["core.txt"]);
  expect(receipt.afterCommit).not.toBe(receipt.beforeCommit);
  const statusChild = Bun.spawn(["git", "status", "--short"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, status] = await Promise.all([
    statusChild.exited,
    Bun.readableStreamToText(statusChild.stdout),
  ]);
  expect(code).toBe(0);
  expect(status).toContain("?? outside.txt");
});

test("frozen campaign preserves staged baseline while freezing exact bytes and rejects candidate drift", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  await git(root, ["add", "core.txt"]);
  const index = await readFile(path.join(root, ".git/index"));
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-frozen",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    commits: [{ id: "core", title: "feat(core): frozen", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  expect(frozen.frozen?.steps[0]?.afterTree).toBe(frozen.frozen?.candidateTree.oid);
  await expect(
    commitGrCampaignStep({
      root,
      plan: frozen,
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("initially clean");
  await git(root, ["reset", "-q", "HEAD"]);
  await writeFile(path.join(root, "core.txt"), "different bytes with same Git status\n");
  await expect(
    commitGrCampaignStep({
      root,
      plan: frozen,
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("candidate content changed");
});

test("frozen ordered semantic commits reach only the exact candidate and cannot replay", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  await writeFile(path.join(root, "added.txt"), "new file\n");
  await writeFile(path.join(root, "outside.txt"), "not in campaign\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-ordered",
    baseRevision: "HEAD",
    paths: ["core.txt", "added.txt"],
    commits: [
      { id: "core", title: "feat(core): frozen core", paths: ["core.txt"] },
      { id: "add", title: "feat(core): add file", paths: ["added.txt"] },
    ],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const execute = (commitId: string, expectedBeforeCommit?: string) =>
    commitGrCampaignStep({
      root,
      plan: frozen,
      commitId,
      expectedBeforeCommit,
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    });
  await expect(execute("add")).rejects.toThrow("commit order changed");
  const first = await execute("core");
  await expect(execute("core")).rejects.toThrow("commit order changed");
  await expect(execute("add")).rejects.toThrow("receipt pin is missing");
  const second = await execute("add", first.afterCommit);
  expect(second.beforeCommit).toBe(first.afterCommit);
  expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe("not in campaign\n");
  await expect(
    pushGrCampaign({
      root,
      plan: frozen,
      grantedEffects: ["git.read", "git.write", "network.write"],
    }),
  ).rejects.toThrow("exact final commit receipt");
  await expect(
    commitGrCampaignStep({
      root,
      plan: { ...frozen, campaignId: "tampered" },
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("fingerprint");
});

test("freeze refuses duplicate, overlapping and incomplete assignments", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  await writeFile(path.join(root, "added.txt"), "candidate addition\n");
  for (const commits of [
    [{ id: "one", title: "one", paths: ["core.txt"] }],
    [
      { id: "same", title: "one", paths: ["core.txt"] },
      { id: "same", title: "two", paths: ["added.txt"] },
    ],
    [
      { id: "one", title: "one", paths: ["core.txt"] },
      { id: "two", title: "two", paths: ["core.txt", "added.txt"] },
    ],
  ]) {
    const plan = await createGrCampaignPlan({
      root,
      campaignId: "oss-invalid",
      baseRevision: "HEAD",
      paths: ["core.txt", "added.txt"],
      commits,
      grantedEffects: ["filesystem.read", "git.read"],
    });
    await expect(
      freezeGrCampaignPlan({
        root,
        plan,
        grantedEffects: ["filesystem.read", "git.read", "git.write"],
      }),
    ).rejects.toThrow();
  }
});

test("switching local branches at the same HEAD cannot reuse a frozen commit plan", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-branch-pin",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    commits: [{ id: "core", title: "feat(core): candidate", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  await git(root, ["checkout", "-qb", "unreviewed-branch"]);
  const index = await readFile(path.join(root, ".git/index"));
  await expect(
    commitGrCampaignStep({
      root,
      plan: frozen,
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toThrow("local branch changed");
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
});

test("a failed commit retains staged work instead of resetting the real index", async () => {
  const root = await repo();
  await writeFile(path.join(root, "core.txt"), "candidate\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-hook-refusal",
    baseRevision: "HEAD",
    paths: ["core.txt"],
    commits: [{ id: "core", title: "feat(core): candidate", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const hook = path.join(root, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  await expect(
    commitGrCampaignStep({
      root,
      plan: frozen,
      commitId: "core",
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    }),
  ).rejects.toMatchObject({ code: "GR_GIT_FAILED", details: { outcome: "uncertain" } });
  const staged = Bun.spawn(["git", "diff", "--cached", "--name-only"], {
    cwd: root,
    stdout: "pipe",
  });
  expect(await new Response(staged.stdout).text()).toBe("core.txt\n");
  expect(await staged.exited).toBe(0);
  expect(await readFile(path.join(root, "core.txt"), "utf8")).toBe("candidate\n");
});

test("actual commit tree and message drift caused by hooks cannot receive a success receipt", async () => {
  for (const mode of ["tree", "message"] as const) {
    const root = await repo();
    await writeFile(path.join(root, "core.txt"), "candidate\n");
    const plan = await createGrCampaignPlan({
      root,
      campaignId: "oss-hook-drift",
      baseRevision: "HEAD",
      paths: ["core.txt"],
      commits: [{ id: "core", title: "feat(core): candidate", paths: ["core.txt"] }],
      grantedEffects: ["filesystem.read", "git.read"],
    });
    const frozen = await freezeGrCampaignPlan({
      root,
      plan,
      grantedEffects: ["filesystem.read", "git.read", "git.write"],
    });
    const hook = path.join(root, ".git/hooks", mode === "tree" ? "pre-commit" : "commit-msg");
    await writeFile(
      hook,
      mode === "tree"
        ? "#!/bin/sh\nprintf 'hook-modified bytes\\n' > core.txt\ngit add core.txt\n"
        : "#!/bin/sh\nprintf 'unreviewed message\\n' > \"$1\"\n",
    );
    await chmod(hook, 0o755);
    await expect(
      commitGrCampaignStep({
        root,
        plan: frozen,
        commitId: "core",
        grantedEffects: ["filesystem.read", "git.read", "git.write"],
      }),
    ).rejects.toMatchObject({ code: "GR_STALE_STATE", details: { outcome: "uncertain" } });
    const head = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" });
    expect((await new Response(head.stdout).text()).trim()).not.toBe(plan.base.commit.oid);
    expect(await head.exited).toBe(0);
    // Reconciliation must preserve the unexpected commit, not reset or fabricate success.
    await expect(
      commitGrCampaignStep({
        root,
        plan: frozen,
        commitId: "core",
        grantedEffects: ["filesystem.read", "git.read", "git.write"],
      }),
    ).rejects.toThrow();
  }
});

test("GR campaign push verifies the frozen remote base and performs a normal push", async () => {
  const root = await repo();
  const base = await (async () => {
    const child = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: root, stdout: "pipe" });
    await child.exited;
    return (await Bun.readableStreamToText(child.stdout)).trim();
  })();
  const remote = await mkdtemp(path.join(tmpdir(), "gr-campaign-remote-"));
  roots.add(remote);
  await git(remote, ["init", "--bare", "-q"]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  await writeFile(path.join(root, "core.txt"), "changed\n");
  const plan = await createGrCampaignPlan({
    root,
    campaignId: "oss-001",
    baseRevision: base,
    paths: ["core.txt"],
    commits: [{ id: "core", title: "feat(core): change core", paths: ["core.txt"] }],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  const frozen = await freezeGrCampaignPlan({
    root,
    plan,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const committed = await commitGrCampaignStep({
    root,
    plan: frozen,
    commitId: "core",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const receipt = await pushGrCampaign({
    root,
    plan: frozen,
    expectedHead: committed.afterCommit,
    remote: "origin",
    ref: "main",
    grantedEffects: ["git.read", "git.write", "network.write"],
  });
  expect(receipt.status).toBe("pushed");
  expect(receipt.expectedRemoteBase).toBe(base);
  expect(receipt.pushedCommit).not.toBe(base);
});
