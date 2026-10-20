import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import type { RepoRqConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import {
  DEFAULT_TSCONFIG_EXTENDS,
  DEFAULT_TYPESCRIPT_DEV_DEPENDENCIES,
  inspectTsconfigPolicy,
} from "./policy";

export async function checkRepositoryTsconfig(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  const config = context.config as Partial<RepoRqConfig> | null;
  return qualityResultFromPolicyReport(
    await inspectTsconfigPolicy(repositoryRootFromContext(context), {
      allowedExtends: config?.tsconfig?.allowedExtends ?? DEFAULT_TSCONFIG_EXTENDS,
      familyRoots: config?.packages?.familyRoots,
      requiredDevDependencies:
        config?.tsconfig?.requiredDevDependencies ?? DEFAULT_TYPESCRIPT_DEV_DEPENDENCIES,
    }),
  );
}
