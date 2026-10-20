import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { REPO_RQ_CONFIG_DEFAULTS, type RepoRqComplexityConfig, type RepoRqConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectComplexityPolicy } from "./policy";

function resolveComplexityConfig(context: QualityCheckContext): RepoRqComplexityConfig {
  const config = context.config as Partial<RepoRqConfig> | null;
  return Object.freeze({
    ...REPO_RQ_CONFIG_DEFAULTS.complexity,
    ...(config?.complexity ?? {}),
  });
}

export async function checkRepositoryComplexity(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectComplexityPolicy(
      repositoryRootFromContext(context),
      resolveComplexityConfig(context),
    ),
  );
}
