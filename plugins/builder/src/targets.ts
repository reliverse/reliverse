export const DEFAULT_RSE_BUILD_TARGETS = [
  "plugins/pm",
  "plugins/builder",
  "apps/cli",
] as const;

export function parseTargetsOption(targets: string): string[] {
  return targets
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
}
