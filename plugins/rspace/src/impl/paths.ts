import path from "node:path";

import { CUSTOM_IMPORTS_DIR, DEFAULT_RSPACE_EXTENSION, TEAMS_DIR } from "./constants";

export function resolveUserPath(input: string, cwd: string): string {
  const expanded = expandHome(input);

  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }

  return path.resolve(cwd, expanded);
}

export function expandHome(input: string): string {
  if (input === "~") {
    return process.env.HOME ?? input;
  }

  if (input.startsWith("~/")) {
    const home = process.env.HOME;
    return home ? path.join(home, input.slice(2)) : input;
  }

  return input;
}

export function toSafeName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "rse";
}

export function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function getDirectoryName(inputPath: string): string {
  return path.basename(path.resolve(inputPath));
}

export function createDefaultOutputPath(input: { cwd: string; name: string }): string {
  return path.resolve(input.cwd, `./${toSafeName(input.name)}${DEFAULT_RSPACE_EXTENSION}`);
}

export function createTeamTargetPath(input: { team: string; name: string }): string {
  return toPosixPath(path.posix.join(TEAMS_DIR, toSafeName(input.team), toSafeName(input.name)));
}

export function createDefaultCustomTargetPath(name: string): string {
  return toPosixPath(path.posix.join(CUSTOM_IMPORTS_DIR, toSafeName(name)));
}

export function normalizeRelativeRspacePath(input: string, label: string): string {
  const normalized = input.replaceAll("\\", "/").replaceAll(/\/+/g, "/").trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }

  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`${label} must be a relative path inside the Rspace.`);
  }

  const parts = normalized.split("/");

  if (parts.some((part) => part === "..")) {
    throw new Error(`${label} cannot contain ".." path segments.`);
  }

  return normalized.replaceAll(/^\.\//g, "");
}

export function normalizeArchivePath(outputPath: string): string {
  if (outputPath.endsWith(".tar.gz") || outputPath.endsWith(".tgz")) {
    return outputPath;
  }

  return `${outputPath}.tar.gz`;
}

export function isTarGzPath(inputPath: string): boolean {
  return inputPath.endsWith(".tar.gz") || inputPath.endsWith(".tgz");
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));

  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
