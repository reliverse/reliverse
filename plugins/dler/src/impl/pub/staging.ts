import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function mergeFilesField(files: unknown, publishFrom: string): string[] {
  const existing: string[] = Array.isArray(files)
    ? files.filter((item): item is string => typeof item === "string")
    : [];

  return [...new Set([...existing, "package.json", publishFrom])];
}

export interface PublishStagingHandle {
  readonly stagingDir: string;
  cleanup(): Promise<void>;
}

/**
 * Writes a temporary package root: adjusted package.json (merged `files`) plus a copy of `publishFrom`.
 */
export async function createPublishStaging(
  packageRoot: string,
  publishFrom: string,
): Promise<PublishStagingHandle> {
  const packageJsonPath = join(packageRoot, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const stagedPkg = {
    ...pkg,
    files: mergeFilesField(pkg.files, publishFrom),
  };
  const stagingDir = await mkdtemp(join(tmpdir(), "rse-publish-"));
  await writeFile(
    join(stagingDir, "package.json"),
    `${JSON.stringify(stagedPkg, null, 2)}\n`,
    "utf8",
  );
  const sourceArtifactDir = join(packageRoot, publishFrom);
  const destArtifactDir = join(stagingDir, publishFrom);
  await cp(sourceArtifactDir, destArtifactDir, { recursive: true });

  return {
    stagingDir,
    async cleanup() {
      await rm(stagingDir, { recursive: true, force: true });
    },
  };
}
