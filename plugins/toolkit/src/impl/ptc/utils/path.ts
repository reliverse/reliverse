import path from "node:path";

export function normalizePathForDisplay(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function resolveUserPath(userPath: string): string {
  return path.normalize(path.resolve(process.cwd(), userPath));
}

export function isSamePath(leftPath: string, rightPath: string): boolean {
  return path.normalize(path.resolve(leftPath)) === path.normalize(path.resolve(rightPath));
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = path.relative(parentPath, childPath);
  return Boolean(relPath) && !relPath.startsWith("..") && !path.isAbsolute(relPath);
}