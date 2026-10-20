import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { REPO_RQ_CONFIG_DEFAULTS, type RepoRqConfig, type RepoRqSpecsConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectSpecsPolicy } from "./policy";

function resolveSpecsConfig(context: QualityCheckContext): RepoRqSpecsConfig {
  const config = context.config as Partial<RepoRqConfig> | null;
  return Object.freeze({
    ...REPO_RQ_CONFIG_DEFAULTS.specs,
    ...(config?.specs ?? {}),
  });
}

export async function checkRepositorySpecs(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectSpecsPolicy(repositoryRootFromContext(context), resolveSpecsConfig(context)),
  );
}
