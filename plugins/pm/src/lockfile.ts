import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, relative } from "node:path";

const FORBIDDEN_LOCKFILE_NAMES = new Set([
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isIgnoredLockfilePath(path: string): boolean {
  return path.includes("/node_modules/") || path.includes("/.git/");
}

export async function assertSupportedBunLockfileProject(projectDir: string): Promise<void> {
  if (!(await pathExists(join(projectDir, "bun.lock")))) {
    throw new Error(
      `Unsupported package-manager project at "${projectDir}": expected bun.lock. Rse pm add/update supports only modern Bun projects with bun.lock.`,
    );
  }

  const forbiddenLockfiles: string[] = [];
  const glob = new Bun.Glob("**/{bun.lockb,package-lock.json,pnpm-lock.yaml,yarn.lock}");

  for await (const match of glob.scan({
    absolute: true,
    cwd: projectDir,
    dot: true,
  })) {
    if (isIgnoredLockfilePath(match)) {
      continue;
    }

    const name = match.slice(match.lastIndexOf("/") + 1);

    if (FORBIDDEN_LOCKFILE_NAMES.has(name)) {
      forbiddenLockfiles.push(relative(projectDir, match));
    }
  }

  if (forbiddenLockfiles.length > 0) {
    throw new Error(
      `Unsupported package-manager project at "${projectDir}": found non-bun.lock lockfile(s): ${forbiddenLockfiles.sort((left, right) => left.localeCompare(right)).join(", ")}. Rse pm add/update supports only bun.lock.`,
    );
  }
}

export function getBunLockfilePath(projectDir: string): string {
  return join(projectDir, "bun.lock");
}
