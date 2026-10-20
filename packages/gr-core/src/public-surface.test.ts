import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createGrPatch } from "./patch";
import { assertGrPublicPath, isGrHardPrivatePath } from "./public-surface";
import { createGrSnapshot } from "./snapshot";

const roots = new Set<string>();
async function git(root: string, args: readonly string[]) {
  const p = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([p.exited, Bun.readableStreamToText(p.stderr)]);
  if (code !== 0) throw new Error(stderr);
}
afterAll(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

test("GR public patch bytes and semantic diff hard-exclude .private", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gr-private-patch-"));
  roots.add(root);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await mkdir(path.join(root, ".private"), { recursive: true });
  await writeFile(path.join(root, "public.txt"), "one\n");
  await writeFile(path.join(root, ".private", "secret.md"), "secret-one\n");
  await git(root, ["add", "-f", ".private/secret.md"]);
  await git(root, ["add", "public.txt"]);
  await git(root, ["commit", "-qm", "base"]);
  const before = await createGrSnapshot({
    root,
    role: "baseline",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  await writeFile(path.join(root, "public.txt"), "two\n");
  await writeFile(path.join(root, ".private", "secret.md"), "secret-two\n");
  const result = await createGrSnapshot({
    root,
    role: "result",
    dirtyPolicy: "capture",
    grantedEffects: ["filesystem.read", "git.read", "git.write"],
  });
  const patch = await createGrPatch(before, result, { grantedEffects: ["git.read"] });
  expect(patch.diff.files.map((file) => file.path)).toEqual(["public.txt"]);
  expect(patch.forward.content).toContain("public.txt");
  expect(patch.forward.content).not.toContain(".private");
  expect(patch.forward.content).not.toContain("secret-two");
});

test("GR public path guard rejects nested .private path segments", () => {
  expect(isGrHardPrivatePath("extensions/demo/.private/receipt.json")).toBe(true);
  expect(isGrHardPrivatePath("extensions/demo/public/receipt.json")).toBe(false);
  expect(() => assertGrPublicPath("extensions/demo/.private/receipt.json")).toThrow(
    "GR_PRIVATE_PATH_FORBIDDEN",
  );
});
