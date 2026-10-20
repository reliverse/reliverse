import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import type { RepoRqConfig } from "../config";
import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { DEFAULT_PACKAGE_FAMILY_ROOTS, inspectPackagePolicy } from "./policy";

export async function checkRepositoryPackages(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  const config = context.config as Partial<RepoRqConfig> | null;
  return qualityResultFromPolicyReport(
    await inspectPackagePolicy(repositoryRootFromContext(context), {
      familyRoots: config?.packages?.familyRoots ?? DEFAULT_PACKAGE_FAMILY_ROOTS,
    }),
  );
}
