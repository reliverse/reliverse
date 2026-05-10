import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SyncPackageJsonVersionResult {
  readonly packageJsonPath: string;
  readonly previousVersion: string | undefined;
  readonly updated: boolean;
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function syncPackageJsonVersion(
  packageRoot: string,
  version: string,
): Promise<SyncPackageJsonVersionResult> {
  const packageJsonPath = join(packageRoot, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const manifest = JSON.parse(raw) as unknown;

  if (!isRecord(manifest)) {
    throw new Error(`Expected ${packageJsonPath} to contain a JSON object.`);
  }

  const previousVersion = typeof manifest.version === "string" ? manifest.version : undefined;
  if (previousVersion === version) {
    return { packageJsonPath, previousVersion, updated: false, version };
  }

  manifest.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { packageJsonPath, previousVersion, updated: true, version };
}
