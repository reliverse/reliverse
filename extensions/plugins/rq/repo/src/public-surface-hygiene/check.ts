import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import {
  REPO_RQ_CONFIG_DEFAULTS,
  type RepoRqConfig,
  type RepoRqPublicSurfaceHygieneConfig,
} from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectPublicSurfaceHygienePolicy } from "./policy";

function resolveConfig(context: QualityCheckContext): RepoRqPublicSurfaceHygieneConfig {
  const config = context.config as Partial<RepoRqConfig> | null;
  return Object.freeze({
    ...REPO_RQ_CONFIG_DEFAULTS.publicSurfaceHygiene,
    ...(config?.publicSurfaceHygiene ?? {}),
  });
}

export async function checkRepositoryPublicSurfaceHygiene(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectPublicSurfaceHygienePolicy(
      repositoryRootFromContext(context),
      resolveConfig(context),
    ),
  );
}
