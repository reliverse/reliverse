import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const example = path.join(import.meta.dir, "inspect.ts");

test("source inspection needs only Bun/Git and preserves staged, unstaged and untracked bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gr-public-inspect-"));
  const root = path.join(directory, "repository"), home = path.join(directory, "home");
  await mkdir(root);
  await mkdir(home);
  const env = { PATH: process.env.PATH!, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const run = async (args: string[], cwd = root) => {
    const child = Bun.spawn(args, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  };
  try {
    expect((await run(["git", "init", "-q", "--initial-branch=main"])).code).toBe(0);
    await writeFile(path.join(root, "note.txt"), "staged version\n");
    expect((await run(["git", "add", "--", "note.txt"])).code).toBe(0);
    await writeFile(path.join(root, "note.txt"), "unstaged version\n");
    await writeFile(path.join(root, "untracked.txt"), "untracked version\n");
    const index = await readFile(path.join(root, ".git/index"));
    const head = await readFile(path.join(root, ".git/HEAD"));
    const result = await run([process.execPath, "--no-install", "--no-env-file", example, root]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("GR source inspection (read-only)\nHEAD: unborn\nWorkspace: dirty\nChanges: 1 staged, 1 unstaged, 1 untracked, 0 conflicted\n");
    expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
    expect(await readFile(path.join(root, ".git/HEAD"))).toEqual(head);
    expect((await run(["git", "rev-parse", "--verify", "HEAD"])).code).not.toBe(0);
    expect(await readFile(path.join(root, "note.txt"), "utf8")).toBe("unstaged version\n");
    expect(await readFile(path.join(root, "untracked.txt"), "utf8")).toBe("untracked version\n");
    const refused = await run([process.execPath, "--no-install", "--no-env-file", example, home]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("not a Git worktree root");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
