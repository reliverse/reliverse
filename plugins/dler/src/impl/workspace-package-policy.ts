export function getWorkspacePackageIgnoreReason(pkg: Record<string, unknown>): string | null {
  const packageName = pkg.name;
  if (typeof packageName === "string" && packageName.startsWith("@repo/")) {
    return `package ${packageName} is ignored by workspace policy`;
  }

  return null;
}
