import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commitGrCampaignStep,
  createGrCampaignPlan,
  freezeGrCampaignPlan,
  pushGrCampaign,
} from "./campaign";
import {
  exportGrCampaignPublicBase,
  prepareGrCampaignPublicationSource,
  readGrCampaignRetainedPrefix,
  GR_PUBLICATION_BASE_BUNDLE,
  GR_PUBLICATION_SOURCE_MANIFEST,
  GR_PUBLICATION_SOURCE_PROOF,
} from "./campaign-publication";
import {
  readGrCampaignReviewSource,
  readGrCampaignReviewTreeProof,
} from "./campaign-review-source";
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const effects = [
  "filesystem.read",
  "filesystem.write",
  "git.read",
  "git.write",
  "network.write",
] as const;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function repo(bare = false) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-successor-"));
  roots.push(root);
  const command = (...args: string[]) =>
    Bun.spawnSync(
      [
        "/usr/bin/git",
        "--no-pager",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgSign=false",
        ...args,
      ],
      { cwd: root, env: { ...process.env, GIT_EDITOR: "true" } },
    );
  const git = (...args: string[]) => {
    const p = command(...args);
    if (p.exitCode !== 0) throw Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main", "--template=", ...(bare ? ["--bare"] : []));
  return { root, git, command };
}
async function fixture() {
  const source = await repo();
  await writeFile(path.join(source.root, "base.txt"), "public\n");
  source.git("add", ".");
  source.git("commit", "-qm", "base");
  const baseCommit = source.git("rev-parse", "HEAD"),
    baseTree = source.git("rev-parse", "HEAD^{tree}");
  const bundle = await exportGrCampaignPublicBase({
    root: source.root,
    baseCommit,
    baseTree,
    grantedEffects: effects,
  });
  await writeFile(path.join(source.root, "rq.txt"), "reviewed rq\n");
  source.git("add", "rq.txt");
  source.git("commit", "-qm", "rq source");
  const retainedPrefix = {
    commitId: "rq-source",
    commit: source.git("rev-parse", "HEAD"),
    tree: source.git("rev-parse", "HEAD^{tree}"),
    title: "rq source",
    contentBase64: source.command("cat-file", "commit", "HEAD").stdout.toString("base64"),
  };
  await mkdir(path.join(source.root, "docs"));
  await writeFile(path.join(source.root, "docs/private.md"), "not reviewed\n");
  await writeFile(path.join(source.root, "gr.txt"), "reviewed gr\n");
  source.git("add", ".");
  source.git("commit", "-qm", "old gr with docs");
  const excluded = source.git("rev-parse", "HEAD"),
    excludedBlob = source.git("rev-parse", "HEAD:docs/private.md");
  // Independent disposable candidate; the historical source is never rewound.
  const candidate = await repo();
  await writeFile(
    path.join(candidate.root, "base.bundle"),
    Buffer.from(bundle.contentBase64, "base64"),
  );
  candidate.git("fetch", "./base.bundle", "HEAD");
  candidate.git("update-ref", "refs/heads/main", baseCommit);
  candidate.git("read-tree", baseCommit);
  await writeFile(path.join(candidate.root, "base.txt"), "public\n");
  for (const [name, value] of [
    ["rq.txt", "reviewed rq\n"],
    ["gr.txt", "reviewed gr\n"],
    ["runtime.txt", "runtime\n"],
  ])
    await writeFile(path.join(candidate.root, name!), value!);
  const paths = ["gr.txt", "rq.txt", "runtime.txt"];
  const commits = [
    { id: "rq-source", title: "rq source", paths: ["rq.txt"] },
    { id: "gr-source", title: "gr source", paths: ["gr.txt"] },
    { id: "gr-runtime-cli", title: "runtime source", paths: ["runtime.txt"] },
  ];
  const plan = await freezeGrCampaignPlan({
    root: candidate.root,
    plan: await createGrCampaignPlan({
      root: candidate.root,
      campaignId: "fixture-successor",
      baseRevision: baseCommit,
      paths,
      commits,
      grantedEffects: effects,
    }),
    grantedEffects: effects,
  });
  const exported = await readGrCampaignReviewSource({
    root: candidate.root,
    plan,
    grantedEffects: effects,
  });
  const inventory = {
    schema: "rvs.campaign-review-corpus.v0",
    campaignFingerprint: exported.campaignFingerprint,
    candidateTree: exported.candidateTree,
    scope: exported.scope,
    files: exported.files.map(({ contentBase64: _, ...f }) => f),
  };
  const proof = await readGrCampaignReviewTreeProof({
    root: candidate.root,
    inventory,
    grantedEffects: effects,
  });
  const target = await repo();
  for (const f of exported.files) {
    await mkdir(path.dirname(path.join(target.root, f.path)), { recursive: true });
    await writeFile(path.join(target.root, f.path), Buffer.from(f.contentBase64, "base64"), {
      mode: 0o600,
    });
  }
  const mb = Buffer.from(JSON.stringify(inventory)),
    pb = Buffer.from(JSON.stringify(proof));
  await writeFile(
    path.join(target.root, GR_PUBLICATION_BASE_BUNDLE),
    Buffer.from(bundle.contentBase64, "base64"),
    { mode: 0o600 },
  );
  await writeFile(path.join(target.root, GR_PUBLICATION_SOURCE_MANIFEST), mb, { mode: 0o600 });
  await writeFile(path.join(target.root, GR_PUBLICATION_SOURCE_PROOF), pb, { mode: 0o600 });
  return {
    source,
    target,
    excluded,
    excludedBlob,
    baseCommit,
    retainedPrefix,
    input: {
      root: target.root,
      campaignId: "fixture-successor",
      baseCommit,
      baseTree,
      baseBundleDigest: bundle.digest,
      sourceManifestDigest: digest(mb),
      sourceTreeProofDigest: digest(pb),
      expectedCandidateTree: plan.frozen!.candidateTree.oid,
      paths,
      commits,
      retainedPrefix,
      grantedEffects: effects,
    },
  };
}
test("retained exact prefix, two fresh commits and CAS push exclude old docs history without touching source", async () => {
  const f = await fixture(),
    before = await readFile(path.join(f.source.root, ".git/index"));
  const { contentBase64: _, ...prefix } = f.retainedPrefix;
  expect(
    await readGrCampaignRetainedPrefix({
      root: f.source.root,
      baseCommit: f.baseCommit,
      expectedHead: f.excluded,
      prefix,
      grantedEffects: effects,
    }),
  ).toEqual(f.retainedPrefix);
  await expect(
    readGrCampaignRetainedPrefix({
      root: f.source.root,
      baseCommit: f.baseCommit,
      expectedHead: f.retainedPrefix.commit,
      prefix,
      grantedEffects: effects,
    }),
  ).rejects.toThrow("RETAINED_SOURCE_HEAD_CHANGED");
  const result = await prepareGrCampaignPublicationSource(f.input);
  expect(result.retainedPrefix).toEqual(f.retainedPrefix);
  expect(f.target.git("rev-parse", "HEAD")).toBe(f.retainedPrefix.commit);
  expect(result.plan.base.commit.oid).toBe(f.baseCommit);
  expect(result.commitPerformed).toBe(false);
  await expect(
    commitGrCampaignStep({
      root: f.target.root,
      plan: result.plan,
      commitId: "rq-source",
      grantedEffects: effects,
    }),
  ).rejects.toThrow();
  const second = await commitGrCampaignStep({
    root: f.target.root,
    plan: result.plan,
    commitId: "gr-source",
    expectedBeforeCommit: f.retainedPrefix.commit,
    grantedEffects: effects,
  });
  expect(second.stagedPaths).toEqual(["gr.txt"]);
  expect(f.target.git("rev-parse", "HEAD^")).toBe(f.retainedPrefix.commit);
  await expect(
    commitGrCampaignStep({
      root: f.target.root,
      plan: result.plan,
      commitId: "gr-runtime-cli",
      expectedBeforeCommit: f.excluded,
      grantedEffects: effects,
    }),
  ).rejects.toThrow();
  const third = await commitGrCampaignStep({
    root: f.target.root,
    plan: result.plan,
    commitId: "gr-runtime-cli",
    expectedBeforeCommit: second.afterCommit,
    grantedEffects: effects,
  });
  expect(third.stagedPaths).toEqual(["runtime.txt"]);
  expect(f.target.git("ls-tree", "-r", "HEAD", "--", "docs/")).toBe("");
  expect(f.target.git("diff", "--name-only", f.retainedPrefix.commit, "HEAD", "--", "docs/")).toBe(
    "",
  );
  expect(f.target.command("cat-file", "-e", f.excluded).exitCode).not.toBe(0);
  expect(f.target.command("cat-file", "-e", f.excludedBlob).exitCode).not.toBe(0);
  const remote = await repo(true);
  f.source.git("push", remote.root, `${f.baseCommit}:refs/heads/main`);
  f.target.git("remote", "add", "origin", remote.root);
  const push = await pushGrCampaign({
    root: f.target.root,
    plan: result.plan,
    expectedHead: third.afterCommit,
    expectedRemoteUrl: remote.root,
    grantedEffects: effects,
  });
  expect(push.expectedRemoteBase).toBe(f.baseCommit);
  expect(remote.git("rev-parse", "refs/heads/main")).toBe(third.afterCommit);
  expect(remote.git("for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  expect(remote.command("cat-file", "-e", f.excluded).exitCode).not.toBe(0);
  expect(remote.command("cat-file", "-e", f.excludedBlob).exitCode).not.toBe(0);
  expect(f.source.git("rev-parse", "HEAD")).toBe(f.excluded);
  expect(await readFile(path.join(f.source.root, ".git/index"))).toEqual(before);
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow();
});
for (const mutation of ["bytes", "tree", "title", "id", "parent"] as const)
  test(`retained prefix rejects changed ${mutation} without advancing to retained HEAD`, async () => {
    const f = await fixture();
    if (mutation === "bytes")
      f.input.retainedPrefix.contentBase64 = Buffer.from("forged").toString("base64");
    if (mutation === "tree") f.input.retainedPrefix.tree = "a".repeat(40);
    if (mutation === "title") f.input.retainedPrefix.title = "other";
    if (mutation === "id") f.input.retainedPrefix.commitId = "other";
    if (mutation === "parent") {
      const raw = Buffer.from(f.retainedPrefix.contentBase64, "base64")
        .toString()
        .replace(`parent ${f.baseCommit}`, `parent ${f.excluded}`);
      f.input.retainedPrefix.contentBase64 = Buffer.from(raw).toString("base64");
      f.input.retainedPrefix.commit = createHash("sha1")
        .update(`commit ${Buffer.byteLength(raw)}\0`)
        .update(raw)
        .digest("hex");
    }
    await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow();
    expect(f.target.command("rev-parse", "HEAD").stdout.toString().trim()).not.toBe(
      f.input.retainedPrefix.commit,
    );
    await expect(
      readFile(path.join(f.target.root, ".git/gr-publication-preparation/completed.json")),
    ).rejects.toThrow();
  });
