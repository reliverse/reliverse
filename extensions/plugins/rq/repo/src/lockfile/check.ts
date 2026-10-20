import type { QualityCheckContext, QualityCheckHandlerResult } from "@reliverse/quality";

import { qualityResultFromPolicyReport } from "../shared/diagnostics";
import { repositoryRootFromContext } from "../shared/repository-target";
import { inspectLockfilePolicy } from "./policy";

export async function checkRepositoryLockfile(
  context: QualityCheckContext,
): Promise<QualityCheckHandlerResult> {
  return qualityResultFromPolicyReport(
    await inspectLockfilePolicy(repositoryRootFromContext(context)),
  );
}
