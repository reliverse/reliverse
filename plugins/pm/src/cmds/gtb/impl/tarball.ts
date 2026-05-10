import { join } from "node:path";

export function npmTarballFilename(packageName: string, version: string): string {
  return `${tarballNamePrefix(packageName)}-${version}.tgz`;
}

export function npmTarballPath(outputDir: string, packageName: string, version: string): string {
  return join(outputDir, npmTarballFilename(packageName, version));
}

function tarballNamePrefix(packageName: string): string {
  if (packageName.startsWith("@")) {
    return packageName.slice(1).replaceAll("/", "-");
  }

  return packageName.replaceAll("/", "-");
}
