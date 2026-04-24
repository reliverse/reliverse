import type { BuildTargetResult } from "./build/provider/types";
import type { SkippedTarget } from "./shared-targets";

export interface DlerBuildSummary {
  readonly failed: number;
  readonly planned: number;
  readonly skipped: number;
  readonly succeeded: number;
}

export interface DlerPublishSummary {
  readonly failed: number;
  readonly planned: number;
  readonly published: number;
  readonly skipped: number;
}

export function createBuildSummary(options: {
  readonly planned: number;
  readonly skipped: readonly SkippedTarget[];
  readonly targets: readonly BuildTargetResult[];
}): DlerBuildSummary {
  return {
    failed: options.targets.filter((target) => !target.ok).length,
    planned: options.planned,
    skipped: options.skipped.length,
    succeeded: options.targets.filter((target) => target.ok).length,
  };
}

export function createPublishSummary(options: {
  readonly planned: number;
  readonly published: number;
  readonly skipped: readonly SkippedTarget[];
  readonly failed?: number | undefined;
}): DlerPublishSummary {
  return {
    failed: options.failed ?? 0,
    planned: options.planned,
    published: options.published,
    skipped: options.skipped.length,
  };
}

export function formatBuildSummary(summary: DlerBuildSummary): string {
  return `Summary: ${summary.succeeded} built, ${summary.failed} failed, ${summary.skipped} skipped.`;
}

export function formatPublishSummary(summary: DlerPublishSummary, dryRun: boolean): string {
  return `Summary: ${summary.published} ${dryRun ? "prepared" : "published"}, ${summary.failed} failed, ${summary.skipped} skipped.`;
}

export function createPublishSummaryFromResults(options: {
  readonly planned: number;
  readonly resultsCount: number;
  readonly skipped: readonly SkippedTarget[];
}): DlerPublishSummary {
  return createPublishSummary({
    planned: options.planned,
    published: options.resultsCount,
    skipped: options.skipped,
  });
}
