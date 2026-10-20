export const GR_HARD_PRIVATE_PATHS = [".private/**", "**/.private/**"] as const;
export const GR_HARD_BUNDLE_EXCLUDES = [".private/**", "**/.private/**", ".git/**"] as const;

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

export function isGrHardPrivatePath(value: string): boolean {
  const path = normalize(value);
  return path.split("/").includes(".private");
}

export function assertGrPublicPath(value: string): string {
  const path = normalize(value);
  if (isGrHardPrivatePath(path)) {
    throw new Error(`GR_PRIVATE_PATH_FORBIDDEN: ${value}`);
  }
  return path;
}

export function grPublicGitPathspec(): readonly string[] {
  return [
    "--",
    ".",
    ":(exclude).private",
    ":(exclude).private/**",
    ":(glob,exclude)**/.private",
    ":(glob,exclude)**/.private/**",
  ] as const;
}
