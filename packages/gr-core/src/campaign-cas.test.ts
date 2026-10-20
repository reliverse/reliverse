import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commitGrCampaignStep,
  createGrCampaignPlan,
  freezeGrCampaignPlan,
  pushGrCampaign,
} from "./campaign";

const roots: string[] = [];
const actualGit = Bun.which("git")!;
const grants = ["git.read", "git.write", "network.write"] as const;
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function directory(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(
    [
      actualGit,
      "--no-pager",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { cwd: root, env: { ...process.env, GIT_EDITOR: "true" }, stdout: "pipe", stderr: "pipe" },
  );
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code) throw new Error(err);
  return out.trim();
}
async function fixture() {
  const root = await directory("gr-cas-source-"),
    remote = await directory("gr-cas-remote-");
  await git(root, "init", "-q");
  await git(remote, "init", "--bare", "-q");
  await writeFile(path.join(root, "core.txt"), "base\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", "base");
  const base = await git(root, "rev-parse", "HEAD");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-q", "origin", "HEAD:refs/heads/main");
  await writeFile(path.join(root, "core.txt"), "first candidate\n");
  await writeFile(path.join(root, "second.txt"), "second candidate\n");
  const plan = await freezeGrCampaignPlan({
    root,
    plan: await createGrCampaignPlan({
      root,
      campaignId: "cas-fixture",
      baseRevision: base,
      paths: ["core.txt", "second.txt"],
      commits: [
        { id: "first", title: "feat(core): first", paths: ["core.txt"] },
        { id: "second", title: "feat(core): second", paths: ["second.txt"] },
      ],
      grantedEffects: ["filesystem.read", "git.read"],
    }),
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const first = await commitGrCampaignStep({
    root,
    plan,
    commitId: "first",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const second = await commitGrCampaignStep({
    root,
    plan,
    commitId: "second",
    expectedBeforeCommit: first.afterCommit,
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  return { root, remote, base, middle: first.afterCommit, head: second.afterCommit, plan };
}
async function intercepted(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: "race" | "readback",
  operation: () => Promise<unknown>,
) {
  const shim = await directory("gr-cas-shim-");
  const marker = path.join(shim, "attempted");
  const script =
    "#!" +
    process.execPath +
    "\n" +
    "const real=" +
    JSON.stringify(actualGit) +
    ", root=" +
    JSON.stringify(f.root) +
    ", remote=" +
    JSON.stringify(f.remote) +
    ", marker=" +
    JSON.stringify(marker) +
    ";\n" +
    "const args=process.argv.slice(2); const own=process.cwd()===root;\n" +
    "if(own && args.includes('push')) {\n" +
    (mode === "race"
      ? "const race=Bun.spawnSync([real,'--git-dir',remote,'update-ref','refs/heads/main'," +
        JSON.stringify(f.middle) +
        "]); if(race.exitCode) process.exit(race.exitCode);\n"
      : "") +
    "await Bun.write(marker,(await Bun.file(marker).exists()?await Bun.file(marker).text():'')+'one push\\n'); }\n" +
    (mode === "readback"
      ? "if(own && args.includes('ls-remote') && await Bun.file(marker).exists()) process.exit(7);\n"
      : "") +
    "const child=Bun.spawn([real,...args],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(await child.exited);\n";
  await writeFile(path.join(shim, "git"), script);
  await chmod(path.join(shim, "git"), 0o755);
  const previous = process.env.PATH;
  try {
    process.env.PATH = shim + path.delimiter + previous;
    await operation();
  } finally {
    process.env.PATH = previous;
  }
  return marker;
}

test("atomic lease rejects a remote update between preflight and push advertisement", async () => {
  const f = await fixture();
  await git(f.remote, "fetch", "-q", f.root, f.middle);
  const marker = await intercepted(f, "race", async () => {
    await expect(
      pushGrCampaign({
        root: f.root,
        plan: f.plan,
        remote: "origin",
        ref: "refs/heads/main",
        expectedHead: f.head,
        expectedRemoteUrl: f.remote,
        grantedEffects: grants,
      }),
    ).rejects.toMatchObject({ details: { outcome: "uncertain" } });
  });
  expect(await git(f.remote, "rev-parse", "refs/heads/main")).toBe(f.middle);
  expect(await readFile(marker, "utf8")).toBe("one push\n");
});

test("stale expectedOld refuses before publication and invalid refs cannot widen scope", async () => {
  const f = await fixture();
  await git(f.remote, "fetch", "-q", f.root, f.middle);
  await git(f.remote, "update-ref", "refs/heads/main", f.middle);
  await expect(
    pushGrCampaign({ root: f.root, plan: f.plan, expectedHead: f.head, grantedEffects: grants }),
  ).rejects.toMatchObject({ code: "GR_REMOTE_BASE_DRIFT" });
  for (const ref of [
    "refs/tags/unauthorized",
    "refs/heads/*",
    "refs/heads/main:refs/heads/other",
  ]) {
    await expect(
      pushGrCampaign({
        root: f.root,
        plan: f.plan,
        expectedHead: f.head,
        ref,
        grantedEffects: grants,
      }),
    ).rejects.toThrow();
  }
  expect(await git(f.remote, "rev-parse", "refs/heads/main")).toBe(f.middle);
});

test("a non-fast-forward candidate cannot use exact lease as rewrite authority", async () => {
  const f = await fixture();
  await git(f.root, "checkout", "--orphan", "unrelated");
  await git(f.root, "rm", "-rf", ".");
  await writeFile(path.join(f.root, "different.txt"), "unrelated history\n");
  await git(f.root, "add", "-A");
  await git(f.root, "commit", "-qm", "unrelated");
  const plan = await createGrCampaignPlan({
    root: f.root,
    campaignId: "nonff-fixture",
    baseRevision: f.base,
    paths: ["different.txt"],
    grantedEffects: ["filesystem.read", "git.read"],
  });
  await expect(
    pushGrCampaign({
      root: f.root,
      plan,
      expectedHead: await git(f.root, "rev-parse", "HEAD"),
      grantedEffects: grants,
    }),
  ).rejects.toThrow();
  expect(await git(f.remote, "rev-parse", "refs/heads/main")).toBe(f.base);
});

test("successful CAS with failed readback stays uncertain, without an automatic second push", async () => {
  const f = await fixture();
  const marker = await intercepted(f, "readback", async () => {
    await expect(
      pushGrCampaign({ root: f.root, plan: f.plan, expectedHead: f.head, grantedEffects: grants }),
    ).rejects.toMatchObject({ details: { outcome: "uncertain" } });
  });
  expect(await git(f.remote, "rev-parse", "refs/heads/main")).toBe(f.head);
  expect(await readFile(marker, "utf8")).toBe("one push\n");
});

test("follow-tags and configured mirror cannot publish additional refs", async () => {
  const f = await fixture();
  await git(f.root, "tag", "-a", "unapproved-tag", "-m", "fixture");
  await git(f.root, "config", "push.followTags", "true");
  await git(f.root, "config", "remote.origin.mirror", "true");
  const receipt = await pushGrCampaign({
    root: f.root,
    plan: f.plan,
    expectedHead: f.head,
    expectedRemoteUrl: f.remote,
    grantedEffects: grants,
  });
  expect(receipt.ref).toBe("refs/heads/main");
  expect(receipt.remoteUrl).toBe(f.remote);
  expect(await git(f.remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
});
