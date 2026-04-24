import type { BuildTargetResult } from "./build/provider/types";
import type { SkippedTarget } from "./shared-targets";

export interface PlannedTarget {
  readonly cwd: string;
  readonly label: string;
}

export interface ExecutedTarget {
  readonly cwd?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly label: string;
  readonly ok?: boolean | undefined;
}

export interface DlerReportTargetSets {
  readonly executedTargets: readonly ExecutedTarget[];
  readonly plannedTargets: readonly PlannedTarget[];
  readonly skippedTargets: readonly SkippedTarget[];
}

export interface PublishExecutionResultLike {
  readonly cwd: string;
  readonly label: string;
  readonly npm: {
    readonly exitCode: number;
  };
}

export function createTargetSets(options: {
  readonly executedTargets?: readonly BuildTargetResult[] | readonly ExecutedTarget[] | undefined;
  readonly plannedTargets: readonly PlannedTarget[];
  readonly skippedTargets: readonly SkippedTarget[];
}): DlerReportTargetSets {
  return {
    executedTargets: (options.executedTargets ?? []).map((target) => ({
      cwd: target.cwd,
      exitCode: target.exitCode,
      label: target.label,
      ok: target.ok,
    })),
    plannedTargets: options.plannedTargets.map((target) => ({
      cwd: target.cwd,
      label: target.label,
    })),
    skippedTargets: options.skippedTargets.map((target) => ({
      label: target.label,
      reason: target.reason,
    })),
  };
}

export function formatSkippedMessages(skippedTargets: readonly SkippedTarget[]): string[] {
  return skippedTargets.map((target) => `Skipped: ${target.label}: ${target.reason}`);
}

export function createPublishExecutedTargets(results: readonly PublishExecutionResultLike[]): ExecutedTarget[] {
  return results.map((result) => ({
    cwd: result.cwd,
    exitCode: result.npm.exitCode,
    label: result.label,
    ok: result.npm.exitCode === 0,
  }));
}
