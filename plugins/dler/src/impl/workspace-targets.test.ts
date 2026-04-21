import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveWorkspaceTargetsFromCwd } from "./workspace-targets";

async function createWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dler-workspace-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, workspaces: { packages: ["packages/*", "plugins/*"] } }),
    "utf8",
  );
  await mkdir(join(root, "packages", "alpha"), { recursive: true });
  await mkdir(join(root, "plugins", "beta"), { recursive: true });
  await writeFile(join(root, "packages", "alpha", "package.json"), '{"name":"alpha"}\n', "utf8");
  await writeFile(join(root, "plugins", "beta", "package.json"), '{"name":"beta"}\n', "utf8");
  return root;
}

describe("workspace target discovery", () => {
  test("discovers all workspace packages when cwd is the monorepo root", async () => {
    const root = await createWorkspaceRoot();
    const result = await resolveWorkspaceTargetsFromCwd(root);

    expect(result.rootDir).toBe(root);
    expect(result.targets.map((target) => target.label)).toEqual(["packages/alpha", "plugins/beta"]);
  });

  test("discovers only the current package when cwd is a workspace package", async () => {
    const root = await createWorkspaceRoot();
    const cwd = join(root, "plugins", "beta");
    const result = await resolveWorkspaceTargetsFromCwd(cwd);

    expect(result.rootDir).toBe(root);
    expect(result.targets.map((target) => target.label)).toEqual(["plugins/beta"]);
  });
});
