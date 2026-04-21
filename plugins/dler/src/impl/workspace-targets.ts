import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { fileExists, type RequestedTarget } from "./shared-targets";

interface WorkspaceRootConfig {
  readonly packagePatterns: readonly string[];
  readonly rootDir: string;
}

async function readWorkspaceRootConfig(startDir: string): Promise<WorkspaceRootConfig | null> {
  let currentDir = resolve(startDir);

  while (true) {
    const manifestPath = resolve(currentDir, "package.json");
    if (await fileExists(manifestPath)) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          workspaces?: { packages?: unknown } | unknown;
        };
        const workspaces = manifest.workspaces;
        const packagePatterns = Array.isArray(workspaces)
          ? workspaces.filter((value): value is string => typeof value === "string")
          : workspaces && typeof workspaces === "object" && Array.isArray((workspaces as { packages?: unknown }).packages)
            ? (workspaces as { packages: unknown[] }).packages.filter(
                (value): value is string => typeof value === "string",
              )
            : [];

        if (packagePatterns.length > 0) {
          return { packagePatterns, rootDir: currentDir };
        }
      } catch {
        // ignore invalid manifests while walking upward
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export async function resolveWorkspaceRootFromCwd(cwd: string): Promise<string> {
  const workspace = await readWorkspaceRootConfig(cwd);
  if (!workspace) {
    throw new Error(`Could not find a monorepo workspace root from ${cwd}.`);
  }

  return workspace.rootDir;
}

async function discoverWorkspacePackageDirs(rootDir: string, packagePatterns: readonly string[]): Promise<string[]> {
  const dirs = new Set<string>();

  for (const pattern of packagePatterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/\/$/, "");
    const glob = new Bun.Glob(`${normalizedPattern}/package.json`);

    for await (const match of glob.scan({ cwd: rootDir, onlyFiles: true })) {
      dirs.add(resolve(rootDir, dirname(match)));
    }
  }

  return [...dirs].sort((left, right) => left.localeCompare(right));
}

function toTarget(rootDir: string, packageDir: string): RequestedTarget {
  const relativePath = relative(rootDir, packageDir);
  return {
    cwd: packageDir,
    label: relativePath.length > 0 ? relativePath.split(sep).join("/") : ".",
  };
}

export async function resolveWorkspaceTargetsFromCwd(cwd: string): Promise<{
  readonly rootDir: string;
  readonly targets: readonly RequestedTarget[];
}> {
  const workspace = await readWorkspaceRootConfig(cwd);
  if (!workspace) {
    throw new Error(`Could not find a monorepo workspace root from ${cwd}.`);
  }

  const packageDirs = await discoverWorkspacePackageDirs(workspace.rootDir, workspace.packagePatterns);
  if (packageDirs.length === 0) {
    throw new Error(`Workspace root ${workspace.rootDir} does not contain any discoverable workspace packages.`);
  }

  const normalizedCwd = resolve(cwd);
  const rootDir = workspace.rootDir;

  if (normalizedCwd === rootDir) {
    return {
      rootDir,
      targets: packageDirs.map((packageDir) => toTarget(rootDir, packageDir)),
    };
  }

  const matchedPackageDir = packageDirs.find((packageDir) => packageDir === normalizedCwd);
  if (matchedPackageDir) {
    return {
      rootDir,
      targets: [toTarget(rootDir, matchedPackageDir)],
    };
  }

  throw new Error(
    `Current directory ${cwd} is neither the workspace root ${rootDir} nor a discoverable workspace package.`,
  );
}
