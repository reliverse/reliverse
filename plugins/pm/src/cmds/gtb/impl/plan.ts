import { packageSpec, readNpmPackageInfo } from "./npm";
import { isPlatformOptionalDependency } from "./platform";
import { npmTarballFilename, npmTarballPath } from "./tarball";
import type { GtbNpmPackageInfo, GtbOptions, GtbPackagePlanItem } from "./types";

export async function buildGtbPlan(options: GtbOptions): Promise<{
  requestedSpec: string;
  resolvedRoot: GtbNpmPackageInfo;
  plan: GtbPackagePlanItem[];
  skipped: Array<{ name: string; reason: string }>;
}> {
  const requestedSpec = packageSpec(options.packageName, options.version ?? options.tag);
  const resolvedRoot = await readNpmPackageInfo(options.npmBin, requestedSpec);
  const rootExactSpec = packageSpec(resolvedRoot.name, resolvedRoot.version);

  const plan: GtbPackagePlanItem[] = [
    {
      kind: "root",
      name: resolvedRoot.name,
      requestedSpec,
      resolvedSpec: rootExactSpec,
      version: resolvedRoot.version,
      outputFilename: npmTarballFilename(resolvedRoot.name, resolvedRoot.version),
      outputPath: npmTarballPath(options.outputDir, resolvedRoot.name, resolvedRoot.version),
    },
  ];

  const skipped: Array<{ name: string; reason: string }> = [];

  if (options.optionalMode === "none") {
    return {
      requestedSpec,
      resolvedRoot,
      plan,
      skipped,
    };
  }

  const optionalEntries = Object.entries(resolvedRoot.optionalDependencies);

  for (const [dependencyName, dependencyRange] of optionalEntries) {
    const matchedPlatform = isPlatformOptionalDependency(dependencyName, options.os, options.arch);

    if (options.optionalMode === "matching" && !matchedPlatform) {
      skipped.push({
        name: dependencyName,
        reason: `optional dependency does not match ${options.os}-${options.arch}`,
      });
      continue;
    }

    const dependencyInfo = await resolveOptionalDependencyInfo({
      npmBin: options.npmBin,
      dependencyName,
      dependencyRange,
    });

    plan.push({
      kind: "optional",
      name: dependencyInfo.name,
      requestedSpec: packageSpec(dependencyName, dependencyRange),
      resolvedSpec: packageSpec(dependencyInfo.name, dependencyInfo.version),
      version: dependencyInfo.version,
      optionalDependencyRange: dependencyRange,
      outputFilename: npmTarballFilename(dependencyInfo.name, dependencyInfo.version),
      outputPath: npmTarballPath(options.outputDir, dependencyInfo.name, dependencyInfo.version),
      matchedPlatform,
    });
  }

  return {
    requestedSpec,
    resolvedRoot,
    plan,
    skipped,
  };
}

async function resolveOptionalDependencyInfo(input: {
  npmBin: string;
  dependencyName: string;
  dependencyRange: string;
}): Promise<GtbNpmPackageInfo> {
  const exactVersion = toExactVersion(input.dependencyRange);

  if (exactVersion) {
    return {
      name: input.dependencyName,
      version: exactVersion,
      optionalDependencies: {},
    };
  }

  return readNpmPackageInfo(input.npmBin, packageSpec(input.dependencyName, input.dependencyRange));
}

function toExactVersion(range: string): string | undefined {
  const trimmed = range.trim();

  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}
