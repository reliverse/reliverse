import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = new URL("../", import.meta.url).pathname;
const workspaceRoots = ["apps", "packages", "plugins"] as const;

interface PackageJson {
  readonly scripts?: Record<string, string>;
}

async function listPackageDirs(root: string): Promise<string[]> {
  const entries = await readdir(join(repoRoot, root), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(repoRoot, root, entry.name));
}

async function hasTypecheckScript(dir: string): Promise<boolean> {
  try {
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageJson;
    return typeof packageJson.scripts?.typecheck === "string";
  } catch {
    return false;
  }
}

const workspaces = (
  await Promise.all(workspaceRoots.map(async (root) => await listPackageDirs(root)))
).flat();

for (const workspace of workspaces) {
  if (!(await hasTypecheckScript(workspace))) {
    continue;
  }

  console.log(`=== ${workspace.replace(`${repoRoot}/`, "")} ===`);
  const proc = Bun.spawn(["bun", "typecheck"], {
    cwd: workspace,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
