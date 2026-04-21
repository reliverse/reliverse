import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { fileExists, pathIsDirectory, type RequestedTarget, type SkippedTarget } from "../shared-targets";
import { getWorkspacePackageIgnoreReason } from "../workspace-package-policy";
import { getIneligibilityReason } from "./eligibility";

export interface PublishableTarget extends RequestedTarget {
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly packageRecord: Record<string, unknown>;
  readonly packageName: string;
}

function resolvePackageName(pkg: Record<string, unknown>, fallbackLabel: string): string {
  return typeof pkg.name === "string" && pkg.name.trim().length > 0 ? pkg.name.trim() : fallbackLabel;
}

export async function resolvePublishableTargets(options: {
  readonly requireArtifactDir?: boolean | undefined;
  readonly publishFrom: string;
  readonly targets: readonly RequestedTarget[];
}): Promise<{ readonly publishable: readonly PublishableTarget[]; readonly skipped: readonly SkippedTarget[] }> {
  const publishable: PublishableTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const target of options.targets) {
    const manifestPath = resolve(target.cwd, "package.json");
    if (!(await fileExists(manifestPath))) {
      skipped.push({ label: target.label, reason: "missing package.json" });
      continue;
    }

    let packageRecord: Record<string, unknown>;
    try {
      packageRecord = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      skipped.push({ label: target.label, reason: "invalid package.json" });
      continue;
    }

    const ignored = getWorkspacePackageIgnoreReason(packageRecord);
    if (ignored) {
      skipped.push({ label: target.label, reason: ignored });
      continue;
    }

    const ineligible = getIneligibilityReason(packageRecord);
    if (ineligible) {
      skipped.push({ label: target.label, reason: ineligible });
      continue;
    }

    const artifactDir = resolve(target.cwd, options.publishFrom);
    if (options.requireArtifactDir !== false) {
      if (!(await pathIsDirectory(artifactDir))) {
        skipped.push({
          label: target.label,
          reason: `missing publish directory: ${artifactDir}`,
        });
        continue;
      }
    }

    publishable.push({
      artifactDir,
      cwd: target.cwd,
      label: target.label,
      manifestPath,
      packageName: resolvePackageName(packageRecord, target.label),
      packageRecord,
    });
  }

  return { publishable, skipped };
}
