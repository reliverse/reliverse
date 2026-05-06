import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ignoredPublishArtifactSegments = [".test.", ".spec.", ".bench.", ".fixture."] as const;
const declarationArtifactExtensions = [".d.ts", ".d.mts", ".d.cts"] as const;

function mergeFilesField(files: unknown, publishFrom: string): string[] {
  const existing: string[] = Array.isArray(files)
    ? files.filter((item): item is string => typeof item === "string")
    : [];

  return [...new Set([...existing, "package.json", publishFrom])];
}

function isIgnoredDeclarationArtifact(filename: string): boolean {
  return (
    ignoredPublishArtifactSegments.some((segment) => filename.includes(segment)) &&
    declarationArtifactExtensions.some((extension) => filename.endsWith(extension))
  );
}

async function pruneIgnoredPublishArtifacts(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        await pruneIgnoredPublishArtifacts(path);
        return;
      }

      if (entry.isFile() && isIgnoredDeclarationArtifact(entry.name)) {
        await rm(path, { force: true });
      }
    }),
  );
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
  packageJson?: Record<string, unknown> | undefined,
): Promise<PublishStagingHandle> {
  const packageJsonPath = join(packageRoot, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = packageJson ?? (JSON.parse(raw) as Record<string, unknown>);
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
  await pruneIgnoredPublishArtifacts(destArtifactDir);

  return {
    stagingDir,
    async cleanup() {
      await rm(stagingDir, { recursive: true, force: true });
    },
  };
}
