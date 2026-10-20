import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createGrCampaignPlan, freezeGrCampaignPlan } from "./campaign";
import {
  exportGrCampaignPublicBase,
  prepareGrCampaignPublicationSource,
  GR_PUBLICATION_BASE_BUNDLE,
  GR_PUBLICATION_SOURCE_MANIFEST,
  GR_PUBLICATION_SOURCE_PROOF,
} from "./campaign-publication";
import {
  readGrCampaignReviewSource,
  readGrCampaignReviewTreeProof,
} from "./campaign-review-source";
import { withGrGitRuntime } from "./git";
const roots: string[] = [];
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});
const effects = ["filesystem.read", "filesystem.write", "git.read", "git.write"] as const;
async function repo() {
  const root = await mkdtemp(path.join(tmpdir(), "gr-publication-"));
  roots.push(root);
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(
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
    if (p.exitCode !== 0) throw Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main", "--template=");
  return { root, git };
}
async function fixture() {
  const source = await repo();
  await writeFile(path.join(source.root, "scope.txt"), "base\n");
  await writeFile(path.join(source.root, "outside.txt"), "public baseline\n");
  source.git("add", "scope.txt", "outside.txt");
  source.git("commit", "-qm", "public base");
  const baseCommit = source.git("rev-parse", "HEAD"),
    baseTree = source.git("rev-parse", "HEAD^{tree}");
  // An unaccepted branch/blob must never travel with the public base.
  source.git("checkout", "-qb", "private-fixture");
  await writeFile(path.join(source.root, "not-public.txt"), "fixture-not-a-real-secret\n");
  source.git("add", "not-public.txt");
  source.git("commit", "-qm", "unaccepted fixture");
  const privateBlob = source.git("rev-parse", "HEAD:not-public.txt");
  source.git("checkout", "-q", "main");
  await writeFile(path.join(source.root, "scope.txt"), "candidate\r\n");
  const paths = ["scope.txt"],
    commits = [{ id: "source", title: "fixture source", paths }];
  const original = await freezeGrCampaignPlan({
    root: source.root,
    plan: await createGrCampaignPlan({
      root: source.root,
      campaignId: "fixture",
      baseRevision: baseCommit,
      paths,
      commits,
      grantedEffects: effects,
    }),
    grantedEffects: effects,
  });
  const indexBefore = await readFile(path.join(source.root, ".git/index"));
  const bundle = await exportGrCampaignPublicBase({
    root: source.root,
    baseCommit,
    baseTree,
    grantedEffects: effects,
  });
  expect(await readFile(path.join(source.root, ".git/index"))).toEqual(indexBefore);
  const target = await repo();
  await writeFile(
    path.join(target.root, GR_PUBLICATION_BASE_BUNDLE),
    Buffer.from(bundle.contentBase64, "base64"),
    { mode: 0o600 },
  );
  await writeFile(path.join(target.root, "scope.txt"), "candidate\r\n", { mode: 0o600 });
  const exported = await readGrCampaignReviewSource({
    root: source.root,
    plan: original,
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
    root: source.root,
    inventory,
    grantedEffects: effects,
  });
  const manifestBytes = Buffer.from(JSON.stringify(inventory) + "\n"),
    proofBytes = Buffer.from(JSON.stringify(proof) + "\n");
  const hash = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
  await writeFile(path.join(target.root, GR_PUBLICATION_SOURCE_MANIFEST), manifestBytes, {
    mode: 0o600,
  });
  await writeFile(path.join(target.root, GR_PUBLICATION_SOURCE_PROOF), proofBytes, { mode: 0o600 });
  return {
    source,
    target,
    bundle,
    original,
    privateBlob,
    input: {
      root: target.root,
      campaignId: "fixture",
      baseCommit,
      baseTree,
      baseBundleDigest: bundle.digest,
      sourceManifestDigest: hash(manifestBytes),
      sourceTreeProofDigest: hash(proofBytes),
      expectedCandidateTree: original.frozen!.candidateTree.oid,
      paths,
      commits,
      grantedEffects: effects,
    },
  };
}

test("protected preparation imports only public base, freezes exact scoped bytes and preserves outside base entries", async () => {
  const f = await fixture();
  let guards = 0;
  const result = await withGrGitRuntime(
    {
      root: f.target.root,
      executable: "/usr/bin/git",
      closureFingerprint: "fixture-closure",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      assertCurrent: async () => {
        guards++;
      },
    },
    () =>
      prepareGrCampaignPublicationSource({
        ...f.input,
        campaignId: "fixture-source-only",
        publication: {
          mode: "source-only",
          installability: "not-claimed",
          exceptionRef: "fixture-policy:source-only",
        },
      }),
  );
  expect(result.plan.policy.publication).toEqual({
    mode: "source-only",
    installability: "not-claimed",
    exceptionRef: "fixture-policy:source-only",
  });
  expect(result.outcome).toBe("completed");
  expect(result.plan.repository.root).toBe(f.target.root);
  expect(result.plan.repository.fingerprint).not.toBe(f.original.repository.fingerprint);
  expect(result.plan.campaignFingerprint).not.toBe(f.original.campaignFingerprint);
  expect(result.plan.frozen!.candidateTree).toEqual(f.original.frozen!.candidateTree);
  expect(result.commitPerformed).toBe(false);
  expect(result.pushPerformed).toBe(false);
  expect(f.target.git("rev-parse", "HEAD")).toBe(f.input.baseCommit);
  expect(f.target.git("show", result.plan.frozen!.candidateTree.oid + ":outside.txt")).toBe(
    "public baseline",
  );
  const probe = Bun.spawnSync(["/usr/bin/git", "--no-pager", "cat-file", "-e", f.privateBlob], {
    cwd: f.target.root,
  });
  expect(probe.exitCode).not.toBe(0);
  expect(f.target.git("for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  expect(guards).toBeGreaterThan(10);
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow();
});
test("candidate mismatch remains held without completion or automatic resume", async () => {
  const f = await fixture();
  f.target.git("config", "core.autocrlf", "true");
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow("CANDIDATE_CHANGED");
  expect(
    JSON.parse(
      await readFile(
        path.join(f.target.root, ".git/gr-publication-preparation/reservation.json"),
        "utf8",
      ),
    ).outcome,
  ).toBe("outcome-unknown");
  await expect(
    readFile(path.join(f.target.root, ".git/gr-publication-preparation/completed.json")),
  ).rejects.toThrow();
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow();
});
test("transferred source bytes are independently verified before importing public history", async () => {
  const f = await fixture();
  await writeFile(path.join(f.target.root, "scope.txt"), "tampered!\r\n", { mode: 0o600 });
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow("SOURCE_CHANGED");
  expect(f.target.git("for-each-ref", "--format=%(refname)")).toBe("");
  await expect(
    readFile(path.join(f.target.root, ".git/gr-publication-preparation/completed.json")),
  ).rejects.toThrow();
  await expect(prepareGrCampaignPublicationSource(f.input)).rejects.toThrow();
});
test("a checksum-bound but incomplete transferred tree proof cannot authorize preparation", async () => {
  const f = await fixture();
  const file = path.join(f.target.root, GR_PUBLICATION_SOURCE_PROOF);
  const proof = JSON.parse(await readFile(file, "utf8"));
  proof.trees = [];
  const bytes = Buffer.from(JSON.stringify(proof) + "\n");
  await writeFile(file, bytes);
  await expect(
    prepareGrCampaignPublicationSource({
      ...f.input,
      sourceTreeProofDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    }),
  ).rejects.toThrow("Review tree membership/completeness proof is invalid");
  expect(f.target.git("for-each-ref", "--format=%(refname)")).toBe("");
});
test("wrong base bundle hash refuses before importing objects or creating a baseline ref", async () => {
  const f = await fixture();
  await expect(
    prepareGrCampaignPublicationSource({
      ...f.input,
      baseBundleDigest: "sha256:" + "0".repeat(64),
    }),
  ).rejects.toThrow("BUNDLE_CHANGED");
  expect(f.target.git("for-each-ref", "--format=%(refname)")).toBe("");
  expect(f.source.git("rev-parse", "HEAD")).toBe(f.input.baseCommit);
});
