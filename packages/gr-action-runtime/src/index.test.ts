import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  executeGrActionTool,
  GR_REPOSITORY_PATCH_APPLY_TOOL,
  preflightGrActionTool,
  previewGrRepositoryPatch,
} from "./index";

let root = "";
afterEach(async () => root && (await rm(root, { recursive: true, force: true })));

async function git(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: "ignore" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git exited ${code}`))));
    child.on("error", reject);
  });
}

test("projects bounded repository patch application under GR identity", async () => {
  root = await mkdtemp(path.join(tmpdir(), "gr-action-"));
  await writeFile(path.join(root, "notes.txt"), "before\n");
  await git(["init"]);
  await git(["add", "notes.txt"]);

  const patch = [
    "diff --git a/notes.txt b/notes.txt",
    "--- a/notes.txt",
    "+++ b/notes.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n");
  const workspace = { rootPath: root };

  expect(previewGrRepositoryPatch({ operation: "apply", patch })).toMatchObject({
    owner: "gr",
    rollback: { tool: GR_REPOSITORY_PATCH_APPLY_TOOL },
  });

  expect(
    await preflightGrActionTool({
      input: { operation: "apply", patch },
      tool: GR_REPOSITORY_PATCH_APPLY_TOOL,
      workspace,
    }),
  ).toMatchObject({
    kind: "reliverse.gr.repository.patch.preview.v0",
    owner: "gr",
    rollback: { tool: GR_REPOSITORY_PATCH_APPLY_TOOL },
  });

  expect(
    await executeGrActionTool({
      input: { operation: "apply", patch },
      tool: GR_REPOSITORY_PATCH_APPLY_TOOL,
      workspace,
    }),
  ).toMatchObject({
    kind: "reliverse.gr.repository.patch.receipt.v0",
    owner: "gr",
    backend: "git",
    rollback: { tool: GR_REPOSITORY_PATCH_APPLY_TOOL },
  });
  expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("after\n");
  await executeGrActionTool({
    input: { operation: "rollback", patch },
    tool: GR_REPOSITORY_PATCH_APPLY_TOOL,
    workspace,
  });
  expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("before\n");
  await executeGrActionTool({
    input: { operation: "apply", patch },
    tool: GR_REPOSITORY_PATCH_APPLY_TOOL,
    workspace,
  });
  expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("after\n");
});
