import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createGeneratedBuildCommand, type BuildCommandInvocation } from "./generated-command";
import { explainMissingPackageBuildCommand, resolvePackageBuildCommand } from "./package-build-command";
import { fileExists, type RequestedTarget, type SkippedTarget } from "../shared-targets";
import { getWorkspacePackageIgnoreReason } from "../workspace-package-policy";

export interface BuildableTarget extends RequestedTarget {
  readonly orchestratorCommand: BuildCommandInvocation;
  readonly packageCommand: BuildCommandInvocation;
  readonly manifestPath: string;
}

export async function resolveBuildableTargets(options: {
  readonly targets: readonly RequestedTarget[];
}): Promise<{ readonly buildable: readonly BuildableTarget[]; readonly skipped: readonly SkippedTarget[] }> {
  const buildable: BuildableTarget[] = [];
  const skipped: SkippedTarget[] = [];

  for (const target of options.targets) {
    const manifestPath = resolve(target.cwd, "package.json");
    if (!(await fileExists(manifestPath))) {
      skipped.push({ label: target.label, reason: "missing package.json" });
      continue;
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      skipped.push({ label: target.label, reason: "invalid package.json" });
      continue;
    }

    const ignored = getWorkspacePackageIgnoreReason(pkg);
    if (ignored) {
      skipped.push({ label: target.label, reason: ignored });
      continue;
    }

    const packageCommand = await resolvePackageBuildCommand(target);
    if (!packageCommand) {
      skipped.push({ label: target.label, reason: await explainMissingPackageBuildCommand(target) });
      continue;
    }

    buildable.push({
      orchestratorCommand: createGeneratedBuildCommand(target),
      cwd: target.cwd,
      packageCommand,
      label: target.label,
      manifestPath,
    });
  }

  return { buildable, skipped };
}
