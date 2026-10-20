import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import type { RepoRqConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectDependencyPolicy } from "./policy";

export async function checkRepositoryDependencies(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  const config = context.config as Partial<RepoRqConfig> | null;
  return qualityResultFromPolicyReport(
    await inspectDependencyPolicy(repositoryRootFromContext(context), {
      moduleCycleExceptions: config?.dependencies?.moduleCycleExceptions,
      tools: config?.dependencies?.tools,
    }),
  );
}
