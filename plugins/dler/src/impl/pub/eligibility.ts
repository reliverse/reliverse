export function getIneligibilityReason(pkg: Record<string, unknown>): string | null {
  if (pkg.private === true) {
    return 'package.json has "private": true (npm publish is blocked)';
  }

  if (pkg.type !== "module") {
    return 'package.json must have "type": "module"';
  }

  const publishConfig = pkg.publishConfig;
  if (
    !publishConfig ||
    typeof publishConfig !== "object" ||
    (publishConfig as { access?: unknown }).access !== "public"
  ) {
    return 'package.json must set publishConfig.access to "public"';
  }

  return null;
}
