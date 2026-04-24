import type { RequestedTarget, SkippedTarget } from "../shared-targets";

import { resolveBuildableTargets, type BuildableTarget } from "./validation";
import type { BuildTarget } from "./provider/types";

export interface PlannedBuildTarget {
  readonly cwd: string;
  readonly label: string;
  readonly manifestPath: string;
  readonly orchestratorCommand: BuildableTarget["orchestratorCommand"];
  readonly packageCommand: BuildableTarget["packageCommand"];
}

export interface DlerBuildPlan {
  readonly executionTargets: readonly BuildTarget[];
  readonly plannedTargets: readonly PlannedBuildTarget[];
  readonly provider: string;
  readonly skippedTargets: readonly SkippedTarget[];
}

function toExecutionTarget(target: PlannedBuildTarget): BuildTarget {
  return {
    command: target.orchestratorCommand.argv,
    cwd: target.cwd,
    displayCommand: target.orchestratorCommand.display,
    label: target.label,
  };
}

export async function createBuildPlan(options: {
  readonly provider: string;
  readonly targets: readonly RequestedTarget[];
}): Promise<DlerBuildPlan> {
  const validation = await resolveBuildableTargets({ targets: options.targets });
  const plannedTargets: PlannedBuildTarget[] = validation.buildable.map((target) => ({
    cwd: target.cwd,
    label: target.label,
    manifestPath: target.manifestPath,
    orchestratorCommand: target.orchestratorCommand,
    packageCommand: target.packageCommand,
  }));

  return {
    executionTargets: plannedTargets.map(toExecutionTarget),
    plannedTargets,
    provider: options.provider,
    skippedTargets: validation.skipped,
  };
}
