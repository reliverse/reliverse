import { afterAll, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runRequiredGrGit, withGrGitRuntime, type GrGitRuntime } from "./git";
import { withGrSnapshotIndexes } from "./git-index";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
async function fixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), "gr-git-runtime-"));
  roots.push(root);
  const executable = path.join(root, "git-fixture");
  const marker = path.join(root, "executed");
  await writeFile(
    executable,
    "#!" +
      process.execPath +
      "\n" +
      "await Bun.write(" +
      JSON.stringify(marker) +
      ", 'executed'); console.log(JSON.stringify({secret:process.env.GR_FIXTURE_SECRET??null, path:process.env.PATH, scope:process.env.GR_FIXTURE_SCOPE, authority:process.env.RELIVERSE_GR_GIT_AUTHORITY??null}));\n",
  );
  await chmod(executable, 0o755);
  let checks = 0;
  const runtime: GrGitRuntime = {
    root,
    executable,
    closureFingerprint: "fixture-only-closure:" + label,
    env: { PATH: "/fixture-not-ambient", GR_FIXTURE_SCOPE: label },
    assertCurrent: async () => {
      checks++;
    },
  };
  return { root, runtime, marker, checks: () => checks };
}
test("protected Git pins executable/environment and retains only permitted per-operation overrides", async () => {
  const f = await fixture("a");
  const before = process.env.GR_FIXTURE_SECRET;
  process.env.GR_FIXTURE_SECRET = "fixture-only-not-a-real-secret";
  try {
    const result = await withGrGitRuntime(f.runtime, () =>
      runRequiredGrGit(f.root, ["status"], { env: { RELIVERSE_GR_GIT_AUTHORITY: "gr" } }),
    );
    expect(JSON.parse(result)).toEqual({
      secret: null,
      path: "/fixture-not-ambient",
      scope: "a",
      authority: "gr",
    });
    expect(f.checks()).toBe(1);
  } finally {
    if (before === undefined) delete process.env.GR_FIXTURE_SECRET;
    else process.env.GR_FIXTURE_SECRET = before;
  }
});
test("protected Git rejects changed root, environment escalation and revoked custody before spawn", async () => {
  const f = await fixture("b");
  await expect(
    withGrGitRuntime(f.runtime, () => runRequiredGrGit("/", ["status"])),
  ).rejects.toThrow("root changed");
  for (const key of [
    "PATH",
    "HOME",
    "GIT_SSH_COMMAND",
    "GIT_CONFIG_COUNT",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_EDITOR",
    "LD_PRELOAD",
  ])
    await expect(
      withGrGitRuntime(f.runtime, () =>
        runRequiredGrGit(f.root, ["status"], { env: { [key]: "untrusted" } }),
      ),
    ).rejects.toThrow("environment overrides");
  await expect(
    withGrGitRuntime(
      {
        ...f.runtime,
        assertCurrent: async () => {
          throw Error("fixture-revoked");
        },
      },
      () => runRequiredGrGit(f.root, ["status"]),
    ),
  ).rejects.toThrow("fixture-revoked");
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: "ENOENT" });
});
test("only backend-owned temporary indexes are allowed within their repository and lifetime", async () => {
  const f = await fixture("index");
  let retained = "";
  await withGrGitRuntime(f.runtime, () =>
    withGrSnapshotIndexes(f.root, async (directory) => {
      retained = path.join(directory, "index-state");
      await runRequiredGrGit(f.root, ["status"], {
        env: { GIT_INDEX_FILE: retained, GIT_EDITOR: "true" },
      });
      await expect(
        runRequiredGrGit(f.root, ["status"], {
          env: { GIT_INDEX_FILE: path.join(directory, "caller-selected") },
        }),
      ).rejects.toThrow("environment overrides");
      await expect(
        runRequiredGrGit(f.root, ["status"], {
          env: { GIT_INDEX_FILE: retained, HOME: "/untrusted" },
        }),
      ).rejects.toThrow("environment overrides");
    }),
  );
  await expect(
    withGrGitRuntime(f.runtime, () =>
      runRequiredGrGit(f.root, ["status"], { env: { GIT_INDEX_FILE: retained } }),
    ),
  ).rejects.toThrow("environment overrides");
});

test("concurrent protected Git contexts keep separate executable/environment identities", async () => {
  const [a, b] = await Promise.all([fixture("a"), fixture("b")]);
  const results = await Promise.all(
    [a, b].map((f) =>
      withGrGitRuntime(f.runtime, async () => {
        await Promise.resolve();
        return JSON.parse(await runRequiredGrGit(f.root, ["status"]));
      }),
    ),
  );
  expect(results.map((r) => r.scope)).toEqual(["a", "b"]);
});
