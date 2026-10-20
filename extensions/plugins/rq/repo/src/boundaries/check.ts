import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectBoundaryPolicy } from "./policy";

export async function checkRepositoryBoundaries(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectBoundaryPolicy(repositoryRootFromContext(context)),
  );
}
