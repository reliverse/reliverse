export function parseTargetsOption(targets: string): string[] {
  return targets
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
}
