import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { REPO_RQ_CONFIG_DEFAULTS, type RepoRqConfig, type RepoRqSchemasConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectSchemasPolicy } from "./policy";

function resolveSchemasConfig(context: QualityCheckContext): RepoRqSchemasConfig {
  const config = context.config as Partial<RepoRqConfig> | null;
  return Object.freeze({
    ...REPO_RQ_CONFIG_DEFAULTS.schemas,
    ...(config?.schemas ?? {}),
  });
}

export async function checkRepositorySchemas(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectSchemasPolicy(repositoryRootFromContext(context), resolveSchemasConfig(context)),
  );
}
