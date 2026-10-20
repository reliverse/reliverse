import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { inspectRemptsPolicy } from "./policy";

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function fixture(commandSource: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rempts-interactive-"));
  await write(root, "package.json", JSON.stringify({ private: true, workspaces: ["apps/*/*"] }));
  await write(
    root,
    "apps/cli/rse/package.json",
    JSON.stringify({
      name: "@reliverse/rse-cli",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
  );
  await write(
    root,
    "apps/cli/rse/src/cli.ts",
    'import { defineCLI } from "@reliverse/rempts";\ndefineCLI({ entry: import.meta.url });\n',
  );
  await write(root, "apps/cli/rse/src/cmds/auth/add/cmd.ts", commandSource);
  return root;
}

test("repo.rempts accepts command-owned semantic prompt primitives", async () => {
  const root = await fixture(
    'import { defineCommand } from "@reliverse/rempts";\nexport default defineCommand({ async handler(ctx) { await ctx.prompt.secret({ message: "Token" }); } });\n',
  );
  try {
    expect((await inspectRemptsPolicy(root)).findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rempts rejects direct terminal input mechanics inside command modules", async () => {
  const root = await fixture(
    'import { defineCommand } from "@reliverse/rempts";\nexport default defineCommand({ async handler() { process.stdin.setRawMode(true); } });\n',
  );
  try {
    expect((await inspectRemptsPolicy(root)).findings).toContainEqual(
      expect.objectContaining({ ruleId: "repo.rempts.interactive-surface-ownership" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo.rempts accepts standalone file-discovered RVS commands without an Rse plugin", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rq-rempts-standalone-rvs-"));
  await write(root, "package.json", JSON.stringify({ private: true, workspaces: ["apps/*/*"] }));
  await write(
    root,
    "apps/cli/rvs/package.json",
    JSON.stringify({
      name: "@reliverse/rvs-cli",
      dependencies: { "@reliverse/rempts": "workspace:*" },
    }),
  );
  await write(
    root,
    "apps/cli/rvs/src/cli.ts",
    'import { defineCLI } from "@reliverse/rempts";\ndefineCLI({ entry: import.meta.url });\n',
  );
  await write(
    root,
    "apps/cli/rvs/src/cmds/mint-local/guided/inspect/cmd.ts",
    'import { defineCommand } from "@reliverse/rempts";\nexport default defineCommand({ async handler(ctx) { ctx.output.result({ ready: true }); } });\n',
  );
  try {
    expect((await inspectRemptsPolicy(root)).findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
