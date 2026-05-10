import type { RequestedTarget, SkippedTarget } from "../shared-targets";
import type { DlerDeclarationStrategy } from "./declaration-layer";
import type { BunBundleStrategy } from "./package-build-command";
import type { BuildTarget } from "./provider/types";
import { resolveBuildableTargets, type BuildableTarget } from "./validation";

export interface PlannedBuildTarget {
  readonly cwd: string;
  readonly label: string;
  readonly manifestPath: string;
  readonly packageCommand: BuildableTarget["packageCommand"];
}

export interface DlerBuildPlan {
  readonly executionTargets: readonly BuildTarget[];
  readonly plannedTargets: readonly PlannedBuildTarget[];
  readonly provider: string;
  readonly skippedTargets: readonly SkippedTarget[];
}

function toExecutionTarget(
  target: PlannedBuildTarget,
  declarationStrategy: DlerDeclarationStrategy,
): BuildTarget {
  return {
    command: target.packageCommand.argv,
    cwd: target.cwd,
    declarationStrategy,
    displayCommand: target.packageCommand.display,
    label: target.label,
    runDeclarations: declarationStrategy !== "off",
  };
}

export async function createBuildPlan(options: {
  readonly bundleStrategy?: BunBundleStrategy | undefined;
  readonly declarationStrategy?: DlerDeclarationStrategy | undefined;
  readonly provider: string;
  readonly targets: readonly RequestedTarget[];
}): Promise<DlerBuildPlan> {
  const declarationStrategy = options.declarationStrategy ?? "emit";
  const validation = await resolveBuildableTargets({
    bundleStrategy: options.bundleStrategy,
    targets: options.targets,
  });
  const plannedTargets: PlannedBuildTarget[] = validation.buildable.map((target) => ({
    cwd: target.cwd,
    label: target.label,
    manifestPath: target.manifestPath,
    packageCommand: target.packageCommand,
  }));

  return {
    executionTargets: plannedTargets.map((target) =>
      toExecutionTarget(target, declarationStrategy),
    ),
    plannedTargets,
    provider: options.provider,
    skippedTargets: validation.skipped,
  };
}
