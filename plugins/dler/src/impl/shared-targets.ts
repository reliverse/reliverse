import { access, constants, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveWorkspaceTargetsFromCwd } from "./workspace-targets";

export interface RequestedTarget {
  readonly cwd: string;
  readonly label: string;
}

export interface SkippedTarget {
  readonly label: string;
  readonly reason: string;
}

export interface ResolvedTargetsResult {
  readonly resolved: readonly RequestedTarget[];
  readonly skipped: readonly SkippedTarget[];
}

export interface RequestedTargetsResolution {
  readonly labels: readonly string[];
  readonly resolution: ResolvedTargetsResult;
}

export function parseTargetsOption(targets: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const rawTarget of targets.split(",")) {
    const label = rawTarget.trim();
    if (label.length === 0 || seen.has(label)) {
      continue;
    }

    seen.add(label);
    labels.push(label);
  }

  return labels;
}

export async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    return entry.isDirectory();
  } catch {
    return false;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDirectoryTargets(cwd: string, labels: readonly string[]): Promise<ResolvedTargetsResult> {
  const resolved: RequestedTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const label of labels) {
    const targetCwd = resolve(cwd, label);
    if (!(await pathIsDirectory(targetCwd))) {
      skipped.push({ label, reason: `not a directory: ${targetCwd}` });
      continue;
    }

    resolved.push({ cwd: targetCwd, label });
  }

  return { resolved, skipped };
}

export async function resolveRequestedTargets(options: {
  readonly cwd: string;
  readonly rawTargets: string | undefined;
}): Promise<RequestedTargetsResolution> {
  const explicitTargets = options.rawTargets?.trim();

  if (explicitTargets && explicitTargets.length > 0) {
    const labels = parseTargetsOption(explicitTargets);
    return {
      labels,
      resolution: await resolveDirectoryTargets(options.cwd, labels),
    };
  }

  const autoTargets = await resolveWorkspaceTargetsFromCwd(options.cwd);
  return {
    labels: autoTargets.targets.map((target) => target.label),
    resolution: { resolved: autoTargets.targets, skipped: [] },
  };
}
