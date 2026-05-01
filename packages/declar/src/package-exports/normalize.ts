import type { DeclarEntrypointKind } from "../types";

export function normalizeExportPath(exportPath: string): string {
  if (exportPath === ".") return ".";
  return exportPath.startsWith("./") ? exportPath : `./${exportPath}`;
}

export function getEntrypointKind(exportPath: string): DeclarEntrypointKind {
  if (exportPath === ".") return "root";
  return exportPath.includes("*") ? "pattern" : "subpath";
}

export function isRelativePackageTarget(targetPath: string): boolean {
  return targetPath.startsWith("./");
}
